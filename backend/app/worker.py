"""
SmartBlood Enterprise Background Worker Daemon.

Runs detached from HTTP API servers to process decoupled tasks:
1. Push notifications delivery queue (FCM, SMS, APNs) with Dead-Letter Queue (DLQ).
2. Redis keyspace expiry event monitoring for automatic geofence escalation.
3. Cold-chain inventory expiration sweeps and T-24h near-expiry proactive alerts.
"""

import asyncio
import logging
import signal
from app.core.config import settings
from app.core.redis import close_redis
from app.services.notification_queue import NotificationQueueService
from app.services.event_sweeper import redis_keyspace_listener
from app.services.inventory_service import run_lifecycle_sweep, check_near_expiry_units

logger = logging.getLogger("bloodline.worker")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Worker] %(message)s",
)

QUEUE_POLL_INTERVAL = 1.0  # seconds
SWEEP_INTERVAL = 300.0  # 5 minutes


class BackgroundWorkerDaemon:
    def __init__(self):
        self.is_running = True
        self.tasks: list[asyncio.Task] = []

    async def notification_worker_loop(self):
        logger.info("Notification Queue Consumer started...")
        while self.is_running:
            try:
                processed = await NotificationQueueService.process_next_batch(max_items=25)
                if processed > 0:
                    logger.info(f"Processed {processed} notifications from queue.")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in notification worker loop: {e}")
            await asyncio.sleep(QUEUE_POLL_INTERVAL)

    async def inventory_sweep_loop(self):
        logger.info("Inventory Lifecycle Sweeper loop started...")
        while self.is_running:
            try:
                sweep_res = await run_lifecycle_sweep()
                if sweep_res.get("expired_units"):
                    logger.info(f"Inventory sweep completed: {sweep_res}")

                near_res = await check_near_expiry_units(hours_ahead=24)
                if near_res.get("units_alerted"):
                    logger.info(f"Near-expiry units alerted: {near_res}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in inventory sweep loop: {e}")
            await asyncio.sleep(SWEEP_INTERVAL)

    async def start(self):
        logger.info(f"Starting Bloodline Background Worker Daemon [{settings.PROJECT_NAME}]")
        self.tasks.append(asyncio.create_task(self.notification_worker_loop()))
        self.tasks.append(asyncio.create_task(self.inventory_sweep_loop()))
        self.tasks.append(asyncio.create_task(redis_keyspace_listener()))

        try:
            await asyncio.gather(*self.tasks)
        except asyncio.CancelledError:
            logger.info("Worker daemon tasks cancelled.")

    def stop(self):
        logger.info("Shutting down worker daemon gracefully...")
        self.is_running = False
        for t in self.tasks:
            t.cancel()


async def main():
    daemon = BackgroundWorkerDaemon()

    def handle_signal():
        daemon.stop()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal)
        except NotImplementedError:
            # Signal handlers on Windows may not be implemented for loop.add_signal_handler
            pass

    try:
        await daemon.start()
    finally:
        await close_redis()
        logger.info("Worker daemon successfully stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Worker daemon terminated by operator.")
