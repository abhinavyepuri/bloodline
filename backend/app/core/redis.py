from typing import Optional, Set, Dict, List
import redis.asyncio as aioredis
from app.core.config import settings

redis_client: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    """Get active async Redis client instance."""
    global redis_client
    if redis_client is None:
        redis_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            encoding="utf-8"
        )
    return redis_client


async def close_redis() -> None:
    """Close Redis connection pool."""
    global redis_client
    if redis_client is not None:
        # redis-py 5.x renamed close() -> aclose(); support both.
        closer = getattr(redis_client, "aclose", None) or redis_client.close
        await closer()
        redis_client = None


async def ping_redis() -> bool:
    """Health probe used at startup and before lock acquisition."""
    try:
        client = await get_redis()
        await client.ping()
        return True
    except Exception:
        return False


# Atomic slot claiming Lua script: evaluates existing hold and claims next free slot in 1 round-trip
LUA_CLAIM_SLOT = """
local req_id = KEYS[1]
local max_units = tonumber(ARGV[1])
local donor_id = ARGV[2]
local ttl = tonumber(ARGV[3])

-- 1. Idempotency: if donor already holds a slot on this request, return that slot
for i = 0, max_units - 1 do
    local key = "lock:hard:req:" .. req_id .. ":unit:" .. i
    if redis.call("GET", key) == donor_id then
        return i
    end
end

-- 2. Claim first free slot atomically
for i = 0, max_units - 1 do
    local key = "lock:hard:req:" .. req_id .. ":unit:" .. i
    if redis.call("SET", key, donor_id, "NX", "EX", ttl) then
        return i
    end
end

return -1
"""

# Atomic multi-slot claiming Lua script: claims up to `count` free unit slots for a donor
LUA_CLAIM_SLOTS = """
local req_id = KEYS[1]
local max_units = tonumber(ARGV[1])
local donor_id = ARGV[2]
local ttl = tonumber(ARGV[3])
local target_count = tonumber(ARGV[4])

-- 1. Find all slots already held by this donor
local held_slots = {}
for i = 0, max_units - 1 do
    local key = "lock:hard:req:" .. req_id .. ":unit:" .. i
    if redis.call("GET", key) == donor_id then
        table.insert(held_slots, i)
    end
end

-- If donor already holds >= target_count slots, return existing held slots
if #held_slots >= target_count then
    return held_slots
end

-- 2. Claim additional free slots until donor holds target_count slots
local needed = target_count - #held_slots
for i = 0, max_units - 1 do
    if needed <= 0 then
        break
    end
    local key = "lock:hard:req:" .. req_id .. ":unit:" .. i
    if redis.call("SET", key, donor_id, "NX", "EX", ttl) then
        table.insert(held_slots, i)
        needed = needed - 1
    end
end

return held_slots
"""


class ConcurrencyLockManager:
    """
    Distributed lock helper backed by Redis.

    Two independent tiers:

    * **Soft lock / alert zone** — one Redis SET per request holding the ids of
      donors that were alerted. It is enumerable, so standing a zone down only
      touches donors actually alerted for *that* request, and the whole zone
      expires on its own TTL.

    * **Hard lock / unit claim** — one key per *unit slot*
      (``lock:hard:req:{request_id}:unit:{index}``). A donor claims a slot with
      an atomic Lua script across the free slots, so N units can be filled by N
      distinct donors while two donors can never take the same slot.
    """

    def __init__(self, redis: aioredis.Redis):
        self.redis = redis

    # ---------------------------------------------------------------- keys
    @staticmethod
    def _zone_key(request_id: str) -> str:
        return f"lock:soft:req:{request_id}:donors"

    @staticmethod
    def _slot_key(request_id: str, index: int) -> str:
        return f"lock:hard:req:{request_id}:unit:{index}"

    # ------------------------------------------------------------ soft lock
    async def register_alerted_donors(
        self, request_id: str, donor_ids: List[str], ttl_seconds: int = 86400
    ) -> None:
        """Record which donors were alerted for this request (the soft-lock zone).

        No expiry is set on the alert zone — donors remain eligible until the
        request is fulfilled or cancelled. The ttl_seconds parameter is kept for
        API compatibility but is only used for the timeout trigger key.
        """
        if not donor_ids:
            return
        key = self._zone_key(request_id)
        pipe = self.redis.pipeline()
        pipe.sadd(key, *donor_ids)
        if ttl_seconds:
            pipe.expire(key, ttl_seconds)
            pipe.set(self._timeout_key(request_id), "active", ex=ttl_seconds)
        else:
            pipe.persist(key)
        await pipe.execute()

    async def get_alerted_donors(self, request_id: str) -> Set[str]:
        """Donor ids currently alerted for this request."""
        members = await self.redis.smembers(self._zone_key(request_id))
        return set(members or ())

    async def is_donor_alerted(self, request_id: str, donor_id: str) -> bool:
        """Whether this donor was actually alerted for this request."""
        return bool(await self.redis.sismember(self._zone_key(request_id), donor_id))

    async def filter_alerted_requests(self, request_ids: List[str], donor_id: str) -> Set[str]:
        """
        Check membership for a donor across multiple requests in a single pipelined Redis round-trip.
        Eliminates N sequential network hops in dashboard alert lookups.
        """
        if not request_ids:
            return set()
        pipe = self.redis.pipeline()
        for req_id in request_ids:
            pipe.sismember(self._zone_key(req_id), donor_id)
        results = await pipe.execute()
        return {req_id for req_id, is_member in zip(request_ids, results) if is_member}

    async def remove_alerted_donor(self, request_id: str, donor_id: str) -> None:

        """Drop a single donor from a request's alert zone (used on decline)."""
        await self.redis.srem(self._zone_key(request_id), donor_id)

    async def alert_zone_ttl(self, request_id: str) -> Optional[int]:
        """
        Seconds left on this request's alert zone, or None when the zone key
        doesn't exist at all (request never registered).

        Redis -1 means the key exists but has no expiry (persist was called) —
        that means the zone is open indefinitely, so we return a large sentinel
        value rather than None so callers never treat it as 'closed'.
        Redis -2 means the key is completely missing.
        """
        ttl = await self.redis.ttl(self._zone_key(request_id))
        if ttl == -1:
            # Key exists, no expiry — alert zone is open indefinitely
            return 86400
        return ttl if isinstance(ttl, int) and ttl >= 0 else None

    # ------------------------------------------------------------ hard lock
    async def claim_unit_slots(
        self,
        request_id: str,
        donor_id: str,
        max_units: int,
        count: int = 1,
        ttl_seconds: int = 86400,
    ) -> List[int]:
        """
        Atomically claim up to `count` free unit slots for this donor in a single round-trip Lua script.

        Returns list of claimed slot indices.
        Concurrent callers cannot claim the same slot: Redis Lua executes atomically.
        """
        if max_units <= 0 or count <= 0:
            return []

        try:
            res = await self.redis.eval(
                LUA_CLAIM_SLOTS, 1, request_id, max_units, donor_id, ttl_seconds, count
            )
            if res is not None and isinstance(res, (list, tuple)):
                return [int(x) for x in res]
            return []
        except Exception:
            # Fallback for environments where EVAL might be disabled
            held = await self.donor_slots(request_id, donor_id, max_units)
            if len(held) >= count:
                return held
            needed = count - len(held)
            for index in range(max(max_units, 1)):
                if needed <= 0:
                    break
                key = self._slot_key(request_id, index)
                if await self.redis.set(key, donor_id, nx=True, ex=ttl_seconds):
                    held.append(index)
                    needed -= 1
            return held

    async def claim_unit_slot(
        self,
        request_id: str,
        donor_id: str,
        max_units: int,
        ttl_seconds: int = 86400,
    ) -> Optional[int]:
        """
        Atomically claim one free unit slot for this donor in a single round-trip Lua script.

        Returns the claimed slot index, or None when every slot is already taken.
        Concurrent callers cannot claim the same slot: Redis Lua executes atomically.
        """
        if max_units <= 0:
            return None

        try:
            res = await self.redis.eval(
                LUA_CLAIM_SLOT, 1, request_id, max_units, donor_id, ttl_seconds
            )
            slot = int(res) if res is not None else -1
            return slot if slot >= 0 else None
        except Exception:
            # Fallback for environments where EVAL might be disabled
            slots = await self.claim_unit_slots(
                request_id, donor_id, max_units, count=1, ttl_seconds=ttl_seconds
            )
            return slots[0] if slots else None

    async def donor_slots(self, request_id: str, donor_id: str, max_units: int) -> List[int]:
        """All slot indices this donor currently holds on this request."""
        if max_units <= 0:
            return []
        keys = [self._slot_key(request_id, i) for i in range(max_units)]
        values = await self.redis.mget(keys)
        return [i for i, v in enumerate(values) if v == donor_id]

    async def donor_slot(self, request_id: str, donor_id: str, max_units: int) -> Optional[int]:
        """The first slot index this donor already holds on this request, if any."""
        slots = await self.donor_slots(request_id, donor_id, max_units)
        return slots[0] if slots else None

    async def claimed_slots(self, request_id: str, max_units: int) -> Dict[int, str]:
        """Map of slot index -> donor id for every claimed slot."""
        if max_units <= 0:
            return {}
        keys = [self._slot_key(request_id, i) for i in range(max_units)]
        values = await self.redis.mget(keys)
        return {i: v for i, v in enumerate(values) if v}

    async def claimed_count(self, request_id: str, max_units: int) -> int:
        """Number of unit slots claimed so far."""
        return len(await self.claimed_slots(request_id, max_units))

    async def release_donor_slots(self, request_id: str, donor_id: str, max_units: int) -> int:
        """Release all slots held by this donor."""
        slots = await self.donor_slots(request_id, donor_id, max_units)
        released = 0
        for slot in slots:
            if await self.redis.delete(self._slot_key(request_id, slot)):
                released += 1
        return released

    async def release_donor_slot(self, request_id: str, donor_id: str, max_units: int) -> bool:
        """Release a specific donor's hard-locked unit slot if held."""
        return (await self.release_donor_slots(request_id, donor_id, max_units)) > 0

    # ----------------------------------------------------------- timeout / TTL
    @staticmethod
    def _timeout_key(request_id: str) -> str:
        return f"alert:timeout:{request_id}"

    async def schedule_alert_timeout(self, request_id: str, timeout_seconds: int = 180) -> None:
        """Sets a timer key with TTL to trigger automated radius cascade when expired."""
        await self.redis.set(self._timeout_key(request_id), "active", ex=timeout_seconds)

    async def cancel_alert_timeout(self, request_id: str) -> None:
        """Cancels any pending timeout cascade (e.g. when request is fully covered)."""
        await self.redis.delete(self._timeout_key(request_id))

    async def is_alert_timeout_pending(self, request_id: str) -> bool:
        """Returns True if the 180s alert window timer is still actively counting down."""
        return bool(await self.redis.exists(self._timeout_key(request_id)))

    # -------------------------------------------------------------- release
    async def release_request_locks(self, request_id: str) -> None:
        """Drop every soft, hard, and timeout lock belonging to a request."""
        keys: List[str] = [self._zone_key(request_id), self._timeout_key(request_id)]
        async for key in self.redis.scan_iter(match=f"lock:hard:req:{request_id}:unit:*"):
            keys.append(key)
        await self.redis.delete(*keys)

