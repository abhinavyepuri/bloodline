import asyncio
import pytest
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from app.services.notification_queue import (
    NotificationQueueService,
    NOTIFICATION_QUEUE_KEY,
    DEAD_LETTER_QUEUE_KEY,
)
from app.core.redis import ConcurrencyLockManager
from tests.conftest import auth



class FakeRedis:
    def __init__(self):
        self.lists = {}
        self.data = {}
        self.sets = {}

    async def rpush(self, key, value):
        self.lists.setdefault(key, []).append(value)
        return len(self.lists[key])

    async def lpop(self, key):
        if key in self.lists and self.lists[key]:
            return self.lists[key].pop(0)
        return None

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def get(self, key):
        return self.data.get(key)

    async def delete(self, *keys):
        count = 0
        for k in keys:
            if k in self.data:
                del self.data[k]
                count += 1
            if k in self.lists:
                del self.lists[k]
                count += 1
        return count

    async def exists(self, key):
        return 1 if (key in self.data or key in self.lists or key in self.sets) else 0

    async def scan_iter(self, match=None):
        for k in list(self.data.keys()):
            if match and match.endswith("*") and k.startswith(match[:-1]):
                yield k


@pytest.mark.asyncio
async def test_notification_queue_enqueue_and_batch_process(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.services.notification_queue.get_redis", AsyncMock(return_value=fake_redis))

    # Enqueue a donor alert
    success = await NotificationQueueService.enqueue_donor_alert(
        donor_ids=["donor-1", "donor-2"],
        request_id="req-uuid-1",
        request_code="REQ-1001",
        blood_group="O-",
        urgency_score=95.0,
        deadline_minutes=25,
        hospital_name="Apollo Hospital",
    )
    assert success is True
    assert len(fake_redis.lists[NOTIFICATION_QUEUE_KEY]) == 1

    payload = json.loads(fake_redis.lists[NOTIFICATION_QUEUE_KEY][0])
    assert payload["type"] == "EMERGENCY_DONOR_ALERT"
    assert payload["request_code"] == "REQ-1001"
    assert payload["donor_ids"] == ["donor-1", "donor-2"]

    # Process next batch
    processed = await NotificationQueueService.process_next_batch(max_items=10)
    assert processed == 1
    assert len(fake_redis.lists[NOTIFICATION_QUEUE_KEY]) == 0


@pytest.mark.asyncio
async def test_notification_queue_dead_letter_fallback(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("app.services.notification_queue.get_redis", AsyncMock(return_value=fake_redis))

    # Push corrupt item
    await fake_redis.rpush(NOTIFICATION_QUEUE_KEY, "invalid-non-json-content")

    processed = await NotificationQueueService.process_next_batch(max_items=10)
    assert processed == 0
    assert len(fake_redis.lists[NOTIFICATION_QUEUE_KEY]) == 0
    assert len(fake_redis.lists[DEAD_LETTER_QUEUE_KEY]) == 1


@pytest.mark.asyncio
async def test_alert_timeout_scheduling_and_cancellation():
    fake_redis = FakeRedis()
    lock_mgr = ConcurrencyLockManager(fake_redis)

    req_id = "test-req-timeout-123"

    # Initially no timeout active
    assert await lock_mgr.is_alert_timeout_pending(req_id) is False

    # Schedule 180s countdown
    await lock_mgr.schedule_alert_timeout(req_id, timeout_seconds=180)
    assert await lock_mgr.is_alert_timeout_pending(req_id) is True

    # Cancel timeout when fulfilled
    await lock_mgr.cancel_alert_timeout(req_id)
    assert await lock_mgr.is_alert_timeout_pending(req_id) is False


@pytest.mark.asyncio
async def test_release_request_locks_clears_timeout():
    fake_redis = FakeRedis()
    lock_mgr = ConcurrencyLockManager(fake_redis)

    req_id = "test-req-full-release"
    await lock_mgr.schedule_alert_timeout(req_id, timeout_seconds=180)
    assert await lock_mgr.is_alert_timeout_pending(req_id) is True

    await lock_mgr.release_request_locks(req_id)
    assert await lock_mgr.is_alert_timeout_pending(req_id) is False


def _deadline(minutes: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


import uuid


@pytest.mark.asyncio
async def test_idempotency_middleware_replay(client, hospital_token):
    """Submitting the same Idempotency-Key returns cached response without duplicate creation."""
    unique_key = f"test-idempotent-key-{uuid.uuid4()}"
    headers = {
        **auth(hospital_token),
        "Idempotency-Key": unique_key,
    }
    payload = {
        "patient_id_token": f"IDEM-TEST-{uuid.uuid4().hex[:6]}",
        "required_blood_group": "O-",
        "component_type": "PRBC",
        "units_requested": 1,
        "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
        "deadline_at": _deadline(30),
    }

    # First request: initial creation, cache MISS
    resp1 = await client.post("/api/v1/requests", headers=headers, json=payload)
    assert resp1.status_code == 201, resp1.text
    assert resp1.headers.get("x-cache-lookup") == "MISS"
    data1 = resp1.json()

    # Second request with identical key: served from Redis cache, cache HIT
    resp2 = await client.post("/api/v1/requests", headers=headers, json=payload)
    assert resp2.status_code == 201
    assert resp2.headers.get("x-cache-lookup") == "HIT"
    assert resp2.headers.get("idempotent-replay") == "true"
    data2 = resp2.json()

    assert data1["id"] == data2["id"]
    assert data1["code"] == data2["code"]


@pytest.mark.asyncio
async def test_worker_daemon_lifecycle(monkeypatch):
    """Worker daemon starts subtasks and stops gracefully."""
    from app.worker import BackgroundWorkerDaemon
    daemon = BackgroundWorkerDaemon()

    # Mock loops to prevent long-running tasks
    daemon.notification_worker_loop = AsyncMock()
    daemon.inventory_sweep_loop = AsyncMock()

    task = asyncio.create_task(daemon.start())
    await asyncio.sleep(0.05)
    assert len(daemon.tasks) == 3
    assert daemon.is_running is True

    daemon.stop()
    assert daemon.is_running is False
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass


