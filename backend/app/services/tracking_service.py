import logging
import math
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.redis import get_redis
from app.models.allocation import Allocation, AllocationStatus
from app.models.donor import Donor
from app.models.hospital import Hospital
from app.models.request import BloodRequest
from app.schemas.donor import DonorTelemetryOut
from app.websocket.connection_manager import manager

logger = logging.getLogger("bloodline.tracking")

APPROACHING_THRESHOLD_METERS = 500.0
DEFAULT_SPEED_KMH = 30.0  # Urban transit speed


def calculate_haversine_distance_meters(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """Computes great-circle distance in meters between two GPS coordinates."""
    r = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


class LiveTrackingService:
    """
    Real-time donor location telemetry and in-transit geofence tracking.
    Computes dynamic PostGIS distances to destination hospitals and triggers
    proactive ward approach notifications when donors cross within 500m.
    """

    @classmethod
    async def process_telemetry(
        cls,
        db: AsyncSession,
        donor: Donor,
        latitude: float,
        longitude: float,
        speed_kmh: Optional[float] = None,
    ) -> DonorTelemetryOut:
        # 1. Update donor's live coordinate and spatial point
        now = datetime.now(timezone.utc)
        donor.latitude = latitude
        donor.longitude = longitude
        donor.location = func.ST_SetSRID(func.ST_Point(longitude, latitude), 4326)
        donor.location_updated_at = now

        # 2. Check for an active in-transit allocation
        alloc_res = await db.execute(
            select(Allocation)
            .options(
                selectinload(Allocation.request).selectinload(BloodRequest.hospital)
            )
            .where(
                Allocation.donor_id == donor.id,
                Allocation.status.in_(
                    [AllocationStatus.HARD_LOCKED, AllocationStatus.IN_TRANSIT]
                ),
            )
            .order_by(Allocation.allocated_at.desc())
        )
        active_allocation = alloc_res.scalars().first()

        if not active_allocation or not active_allocation.request:
            await db.commit()
            return DonorTelemetryOut(
                donor_id=donor.id,
                latitude=latitude,
                longitude=longitude,
                message="Telemetry recorded. No active emergency in-transit allocation.",
            )

        blood_request = active_allocation.request
        hospital = blood_request.hospital

        if not hospital or hospital.latitude is None or hospital.longitude is None:
            await db.commit()
            return DonorTelemetryOut(
                donor_id=donor.id,
                latitude=latitude,
                longitude=longitude,
                active_allocation_id=active_allocation.id,
                message="Telemetry recorded. Destination hospital coordinates unavailable.",
            )

        # 3. Compute distance in meters
        distance_meters = calculate_haversine_distance_meters(
            latitude, longitude, hospital.latitude, hospital.longitude
        )
        distance_km = round(distance_meters / 1000.0, 2)

        # 4. Compute dynamic ETA in minutes
        effective_speed = (
            speed_kmh if (speed_kmh and speed_kmh > 5.0) else DEFAULT_SPEED_KMH
        )
        eta_minutes = max(1, int(round((distance_km / effective_speed) * 60.0)))

        # Update allocation metrics
        active_allocation.distance_km = distance_km
        active_allocation.estimated_transit_minutes = eta_minutes
        active_allocation.status = AllocationStatus.IN_TRANSIT

        is_approaching = distance_meters <= APPROACHING_THRESHOLD_METERS

        # 5. Geofence Trigger: 500m Ward Approach Alert
        if is_approaching:
            await cls._trigger_approaching_alert(
                hospital=hospital,
                blood_request=blood_request,
                donor=donor,
                allocation=active_allocation,
                distance_meters=distance_meters,
                eta_minutes=eta_minutes,
            )

        await db.commit()

        status_msg = (
            f"Approaching hospital ward ({int(distance_meters)}m remaining)"
            if is_approaching
            else f"In transit to {hospital.name} ({distance_km}km, ~{eta_minutes}m ETA)"
        )

        return DonorTelemetryOut(
            donor_id=donor.id,
            latitude=latitude,
            longitude=longitude,
            active_allocation_id=active_allocation.id,
            hospital_id=hospital.id,
            hospital_name=hospital.name,
            distance_to_hospital_km=distance_km,
            estimated_eta_minutes=eta_minutes,
            is_approaching_ward=is_approaching,
            message=status_msg,
        )

    @classmethod
    async def _trigger_approaching_alert(
        cls,
        hospital: Hospital,
        blood_request: BloodRequest,
        donor: Donor,
        allocation: Allocation,
        distance_meters: float,
        eta_minutes: int,
    ) -> None:
        """
        Dispatches priority DONOR_APPROACHING_WARD notification to the emergency ward
        with Redis deduplication to avoid repetitive broadcast alerts.
        """
        dedup_key = f"notif:geofence:approaching:{allocation.id}"
        try:
            redis_client = await get_redis()
            # Set key with 30-minute expiry; only fires if key did not previously exist
            already_notified = not await redis_client.set(
                dedup_key, "notified", nx=True, ex=1800
            )
            if already_notified:
                return
        except Exception as e:
            logger.warning(f"[Tracking] Redis deduplication failed ({e})")

        logger.info(
            f"[Geofence] Donor {donor.id[:8]} crossed within {int(distance_meters)}m of hospital {hospital.name}!"
        )

        manager.dispatch(
            manager.broadcast_to_hospital(
                hospital.id,
                {
                    "type": "DONOR_APPROACHING_WARD",
                    "request_id": blood_request.id,
                    "request_code": blood_request.code,
                    "donor_id": donor.id,
                    "hospital_id": hospital.id,
                    "hospital_name": hospital.name,
                    "distance_meters": round(distance_meters, 1),
                    "eta_minutes": eta_minutes,
                    "message": (
                        f"🚨 Volunteer donor for emergency request {blood_request.code} "
                        f"is within {int(distance_meters)}m of the emergency ward! "
                        f"Prepare triage reception."
                    ),
                },
            )
        )
        manager.dispatch(
            manager.broadcast_operational(
                {
                    "type": "DONOR_APPROACHING_WARD",
                    "request_id": blood_request.id,
                    "request_code": blood_request.code,
                    "donor_id": donor.id,
                    "hospital_id": hospital.id,
                    "distance_meters": round(distance_meters, 1),
                    "message": f"Donor approaching ward for request {blood_request.code}.",
                }
            )
        )
