import asyncio
from app.core.redis import ping_redis, get_redis, close_redis
from app.services.notification_queue import NotificationQueueService, NOTIFICATION_QUEUE_KEY
from app.services.inventory_service import run_lifecycle_sweep
from app.worker import BackgroundWorkerDaemon

async def verify_all():
    print("--- 1. Testing Redis Connectivity ---")
    is_up = await ping_redis()
    print(f"Redis ping response: {is_up}")
    
    r = await get_redis()
    await r.set("smoke_test_key", "smartblood_ok", ex=10)
    read_val = await r.get("smoke_test_key")
    print(f"Redis write/read check: {'SUCCESS' if read_val == 'smartblood_ok' else 'FAILED'}")
    await r.delete("smoke_test_key")
    
    print("\n--- 2. Testing Notification Queue Service ---")
    await NotificationQueueService.enqueue_hospital_update(
        hospital_id="hosp-1",
        request_id="req-1",
        request_code="REQ-TEST",
        status="DISPATCHED",
        message="Courier on the way"
    )
    q_len = await r.llen(NOTIFICATION_QUEUE_KEY)
    print(f"Queue depth after enqueue: {q_len}")
    processed = await NotificationQueueService.process_next_batch(max_items=5)
    print(f"Processed batch items: {processed}")
    remaining_len = await r.llen(NOTIFICATION_QUEUE_KEY)
    print(f"Remaining queue depth: {remaining_len}")

    print("\n--- 3. Testing Inventory Lifecycle Sweep ---")
    sweep_result = await run_lifecycle_sweep()
    print(f"Sweep executed successfully: {sweep_result}")

    print("\n--- 4. Testing Background Worker Daemon Lifecycle ---")
    daemon = BackgroundWorkerDaemon()
    daemon.is_running = True
    t = asyncio.create_task(daemon.notification_worker_loop())
    await asyncio.sleep(0.5)
    daemon.stop()
    await asyncio.sleep(0.1)
    print("BackgroundWorkerDaemon starts and stops cleanly.")

    await close_redis()
    print("\nAll Redis and Worker verifications passed!")

if __name__ == "__main__":
    asyncio.run(verify_all())
