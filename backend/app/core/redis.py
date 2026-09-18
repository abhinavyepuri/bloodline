from typing import Optional
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
        await redis_client.close()
        redis_client = None


class ConcurrencyLockManager:
    """Distributed lock helper for atomic reserve/release operations."""

    def __init__(self, redis: aioredis.Redis):
        self.redis = redis

    async def acquire_soft_lock(self, resource_type: str, resource_id: str, request_id: str, ttl_seconds: int = 180) -> bool:
        """Place an optimistic soft-lock tag on a resource."""
        key = f"lock:soft:{resource_type}:{resource_id}"
        # Set if not exists or append to multi-request observer
        return bool(await self.redis.set(key, request_id, ex=ttl_seconds))

    async def acquire_hard_lock(self, request_id: str, winner_donor_id: str) -> bool:
        """Atomic compare-and-swap upgrade for first-acknowledging donor."""
        key = f"lock:hard:request:{request_id}"
        # SET NX ensures only the FIRST response claims the allocation
        acquired = await self.redis.set(key, winner_donor_id, nx=True, ex=3600)
        return bool(acquired)

    async def release_soft_locks_for_zone(self, resource_type: str, resource_ids: list[str]) -> None:
        """Release soft locks across all non-winning donors in a proximity zone."""
        if not resource_ids:
            return
        keys = [f"lock:soft:{resource_type}:{rid}" for rid in resource_ids]
        await self.redis.delete(*keys)

    async def release_hard_lock(self, request_id: str) -> None:
        """Release hard lock upon cancellation or fulfillment."""
        key = f"lock:hard:request:{request_id}"
        await self.redis.delete(key)
