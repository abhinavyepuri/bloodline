import json
import logging
import asyncio
from typing import Any, Dict, List, Optional
from app.core.redis import get_redis

logger = logging.getLogger("smartblood.notifications")

NOTIFICATION_QUEUE_KEY = "queue:notifications:push"
DEAD_LETTER_QUEUE_KEY = "queue:notifications:dlq"


class NotificationQueueService:
    """
    Asynchronous, decoupled notification queue service.
    Pushes notification events to Redis queue to ensure HTTP request-response
    cycle remains sub-50ms during emergency triage broadcasts.
    """

    @classmethod
    async def enqueue_donor_alert(
        cls,
        donor_ids: List[str],
        request_id: str,
        request_code: str,
        blood_group: str,
        urgency_score: float,
        deadline_minutes: int,
        hospital_name: Optional[str] = None,
        distance_km_map: Optional[Dict[str, float]] = None,
    ) -> bool:
        """
        Enqueues an emergency broadcast job for background delivery (FCM, APNs, SMS).
        """
        payload = {
            "type": "EMERGENCY_DONOR_ALERT",
            "request_id": request_id,
            "request_code": request_code,
            "blood_group": blood_group,
            "urgency_score": urgency_score,
            "deadline_minutes": deadline_minutes,
            "hospital_name": hospital_name or "Emergency Hospital",
            "donor_ids": donor_ids,
            "distance_km_map": distance_km_map or {},
            "timestamp": asyncio.get_running_loop().time(),
        }
        return await cls._push_to_queue(payload)

    @classmethod
    async def enqueue_hospital_update(
        cls,
        hospital_id: str,
        request_id: str,
        request_code: str,
        status: str,
        message: str,
        meta: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Enqueues hospital status update notifications (e.g. Courier Dispatched, Unit Cross-matched).
        """
        payload = {
            "type": "HOSPITAL_STATUS_UPDATE",
            "hospital_id": hospital_id,
            "request_id": request_id,
            "request_code": request_code,
            "status": status,
            "message": message,
            "meta": meta or {},
            "timestamp": asyncio.get_running_loop().time(),
        }
        return await cls._push_to_queue(payload)

    @classmethod
    async def _push_to_queue(cls, payload: Dict[str, Any]) -> bool:
        try:
            redis_client = await get_redis()
            await redis_client.rpush(NOTIFICATION_QUEUE_KEY, json.dumps(payload))  # type: ignore[misc]
            logger.info(
                f"[NotificationQueue] Enqueued {payload.get('type')} for request {payload.get('request_code', payload.get('request_id'))}"
            )
            return True
        except Exception as e:
            logger.error(f"[NotificationQueue] Failed to enqueue notification: {e}")
            # Fallback gracefully without breaking the caller
            return False

    @classmethod
    async def process_next_batch(cls, max_items: int = 50) -> int:
        """
        Pulls up to `max_items` notifications from the queue and processes them in parallel.
        Used by background worker tasks.
        """
        processed_count = 0
        try:
            redis_client = await get_redis()
            for _ in range(max_items):
                raw_item = await redis_client.lpop(NOTIFICATION_QUEUE_KEY)  # type: ignore[misc]
                if not raw_item:
                    break

                try:
                    payload = json.loads(raw_item)
                    await cls._dispatch_notification(payload)
                    processed_count += 1
                except Exception as dispatch_err:
                    logger.error(f"[NotificationQueue] Dispatch failed, moving to DLQ: {dispatch_err}")
                    await redis_client.rpush(DEAD_LETTER_QUEUE_KEY, raw_item)  # type: ignore[misc]

        except Exception as e:
            logger.error(f"[NotificationQueue] Worker loop error: {e}")

        return processed_count

    @classmethod
    async def _dispatch_notification(cls, payload: Dict[str, Any]) -> None:
        """
        Simulates / executes high-speed parallel delivery to FCM / APNs / Twilio SMS gateways.
        """
        notif_type = payload.get("type")
        if notif_type == "EMERGENCY_DONOR_ALERT":
            donor_ids = payload.get("donor_ids", [])
            req_code = payload.get("request_code", "REQ-????")
            bg = payload.get("blood_group")
            hosp = payload.get("hospital_name")
            logger.info(
                f"[PushWorker] Dispatched priority push alert to {len(donor_ids)} donors for {bg} at {hosp} [{req_code}]"
            )
        elif notif_type == "HOSPITAL_STATUS_UPDATE":
            req_code = payload.get("request_code")
            status = payload.get("status")
            logger.info(f"[PushWorker] Dispatched hospital update for {req_code}: {status}")
        else:
            logger.info(f"[PushWorker] Processed generic notification {notif_type}")
