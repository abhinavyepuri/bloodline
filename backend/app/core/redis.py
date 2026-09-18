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
      an atomic SET NX across the free slots, so N units can be filled by N
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
        self, request_id: str, donor_ids: List[str], ttl_seconds: int = 180
    ) -> None:
        """Record which donors were alerted for this request (the soft-lock zone)."""
        if not donor_ids:
            return
        key = self._zone_key(request_id)
        pipe = self.redis.pipeline()
        pipe.sadd(key, *donor_ids)
        pipe.expire(key, ttl_seconds)
        await pipe.execute()

    async def get_alerted_donors(self, request_id: str) -> Set[str]:
        """Donor ids currently alerted for this request."""
        members = await self.redis.smembers(self._zone_key(request_id))
        return set(members or ())

    async def is_donor_alerted(self, request_id: str, donor_id: str) -> bool:
        """Whether this donor was actually alerted for this request."""
        return bool(await self.redis.sismember(self._zone_key(request_id), donor_id))

    async def remove_alerted_donor(self, request_id: str, donor_id: str) -> None:
        """Drop a single donor from a request's alert zone (used on decline)."""
        await self.redis.srem(self._zone_key(request_id), donor_id)

    async def alert_zone_ttl(self, request_id: str) -> Optional[int]:
        """
        Seconds left on this request's alert zone, or None when the zone has expired.

        Redis returns -2 for a missing key and -1 for a key with no expiry; both mean
        "no countdown to show".
        """
        ttl = await self.redis.ttl(self._zone_key(request_id))
        return ttl if isinstance(ttl, int) and ttl >= 0 else None

    # ------------------------------------------------------------ hard lock
    async def claim_unit_slot(
        self,
        request_id: str,
        donor_id: str,
        max_units: int,
        ttl_seconds: int = 3600,
    ) -> Optional[int]:
        """
        Atomically claim one free unit slot for this donor.

        Returns the claimed slot index, or None when every slot is already taken.
        Concurrent callers cannot claim the same slot: each SET NX is atomic.
        """
        for index in range(max(max_units, 1)):
            key = self._slot_key(request_id, index)
            if await self.redis.set(key, donor_id, nx=True, ex=ttl_seconds):
                return index
        return None

    async def donor_slot(self, request_id: str, donor_id: str, max_units: int) -> Optional[int]:
        """The slot index this donor already holds on this request, if any."""
        for index in range(max(max_units, 1)):
            if await self.redis.get(self._slot_key(request_id, index)) == donor_id:
                return index
        return None

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

    # -------------------------------------------------------------- release
    async def release_request_locks(self, request_id: str) -> None:
        """Drop every soft and hard lock belonging to a request."""
        keys: List[str] = [self._zone_key(request_id)]
        async for key in self.redis.scan_iter(match=f"lock:hard:req:{request_id}:unit:*"):
            keys.append(key)
        await self.redis.delete(*keys)
