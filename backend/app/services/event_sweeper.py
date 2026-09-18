import asyncio
import logging
from typing import Optional
from app.core.redis import get_redis
from app.core.database import AsyncSessionLocal

logger = logging.getLogger("smartblood.sweeper")

_sweeper_task: Optional[asyncio.Task] = None


async def trigger_timeout_escalation(request_id: str) -> None:
    """Escalates a request whose 180s donor response window expired."""
    try:
        from app.services.allocation_service import AllocationService
        async with AsyncSessionLocal() as session:
            service = AllocationService(session)
            result = await service.handle_allocation_timeout(request_id)
            logger.info(f"[Sweeper] Handled timeout for request {request_id[:8]}: {result.get('status')}")
    except Exception as e:
        logger.error(f"[Sweeper] Failed to handle timeout for {request_id}: {e}")


def schedule_async_timeout(request_id: str, timeout_seconds: int = 180) -> asyncio.Task:
    """
    Schedules an in-process fallback timer for request_id timeout escalation.
    Ensures zero delay even if Redis keyspace pub/sub is disabled.
    """
    async def _timer():
        await asyncio.sleep(timeout_seconds)
        await trigger_timeout_escalation(request_id)

    return asyncio.create_task(_timer())


async def redis_keyspace_listener() -> None:
    """
    Subscribes to Redis keyspace expiration events (__keyevent@*__:expired).
    When alert:timeout:<id> or lock:soft:req:<id>:donors expires, immediately escalates.
    """
    while True:
        try:
            redis_client = await get_redis()
            # Attempt to ensure keyspace notifications are enabled on Redis
            try:
                await redis_client.config_set("notify-keyspace-events", "Ex")
            except Exception:
                pass

            pubsub = redis_client.pubsub()
            await pubsub.psubscribe("__keyevent@*__:expired")
            logger.info("[Sweeper] Redis keyspace expiry listener active.")

            async for message in pubsub.listen():
                if message and message.get("type") == "pmessage":
                    key = message.get("data")
                    if isinstance(key, bytes):
                        key = key.decode("utf-8")
                    if not isinstance(key, str):
                        continue

                    # Check if key is a timeout key
                    if key.startswith("alert:timeout:"):
                        request_id = key.split("alert:timeout:")[-1]
                        asyncio.create_task(trigger_timeout_escalation(request_id))
                    elif key.startswith("lock:soft:req:") and key.endswith(":donors"):
                        parts = key.split(":")
                        if len(parts) >= 4:
                            request_id = parts[3]
                            asyncio.create_task(trigger_timeout_escalation(request_id))

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"[Sweeper] Keyspace listener disconnected ({e}), reconnecting in 5s...")
            await asyncio.sleep(5)


def start_event_sweepers() -> None:
    global _sweeper_task
    if _sweeper_task is None or _sweeper_task.done():
        _sweeper_task = asyncio.create_task(redis_keyspace_listener())


def stop_event_sweepers() -> None:
    global _sweeper_task
    if _sweeper_task and not _sweeper_task.done():
        _sweeper_task.cancel()
