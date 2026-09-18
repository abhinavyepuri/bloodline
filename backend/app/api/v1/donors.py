from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_donor, require_roles
from app.core.database import get_db
from app.core.permissions import UserRole
from app.core.redis import ConcurrencyLockManager, get_redis
from app.models.donor import Donor
from app.models.request import BloodRequest, RequestStatus
from app.models.user import User
from app.schemas.allocation import DonorRespondOut, DonorRespondRequest
from app.schemas.donor import DonorOut, DonorPublicOut, DonorTelemetryIn, DonorTelemetryOut, DonorUpdateAvailability
from app.schemas.request import BloodRequestOut
from app.services.allocation_service import AllocationService
from app.services.donor_service import is_plasma_derived
from app.services.matching_service import MatchingEngineService
from app.services.notification_queue import NotificationQueueService
from app.services.tracking_service import LiveTrackingService
from app.websocket.connection_manager import manager


router = APIRouter()


@router.get("/me", response_model=DonorOut)
async def get_current_donor_profile(donor: Donor = Depends(get_current_donor)):
    """[USER-FACING] Retrieve current donor's profile, availability, and stats."""
    return DonorOut.model_validate(donor)


@router.get("", response_model=List[DonorPublicOut])
async def list_donors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.COORDINATOR, UserRole.BLOOD_BANK)),
):
    """
    [USER-FACING] List registered donors for network planning.

    Returns the reduced ``DonorPublicOut`` shape — this endpoint is readable across
    tenants, so it never exposes donor PII. Donors themselves read their own record
    via ``/donors/me``.
    """
    res = await db.execute(select(Donor).order_by(Donor.reliability_score.desc()))
    return [DonorPublicOut.model_validate(d) for d in res.scalars().all()]


@router.patch("/availability", response_model=DonorOut)
async def update_donor_availability(
    update_in: DonorUpdateAvailability,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """[USER-FACING] Toggle donor active availability and ping current GPS location."""
    donor.is_available = update_in.is_available
    if update_in.latitude is not None and update_in.longitude is not None:
        donor.latitude = update_in.latitude
        donor.longitude = update_in.longitude
        donor.location = func.ST_SetSRID(func.ST_Point(update_in.longitude, update_in.latitude), 4326)

    await db.commit()
    await db.refresh(donor)

    # Operational staff use availability for planning; other donors have no business
    # seeing a given donor's location.
    manager.dispatch(
        manager.broadcast_operational(
            {
                "type": "DONOR_AVAILABILITY_CHANGED",
                "donor_id": donor.id,
                "blood_group": donor.blood_group,
                "is_available": donor.is_available,
            }
        )
    )

    return DonorOut.model_validate(donor)


@router.post("/me/telemetry", response_model=DonorTelemetryOut)
async def submit_donor_telemetry(
    telemetry: DonorTelemetryIn,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Ingest live GPS coordinates from mobile donor app.
    Updates PostGIS location, calculates real-time ETA to recipient hospital,
    and triggers automated 'DONOR_APPROACHING_WARD' geofence alerts within 500m.
    """
    return await LiveTrackingService.process_telemetry(
        db=db,
        donor=donor,
        latitude=telemetry.latitude,
        longitude=telemetry.longitude,
        speed_kmh=telemetry.speed_kmh,
    )


@router.get("/requests/active", response_model=List[BloodRequestOut])

async def get_active_emergency_alerts(
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Retrieve active emergency blood requests that are broadcasting to this donor.

    Only requests this donor was actually alerted for are returned — the alert zone in
    Redis is the source of truth, so the dashboard can never offer a donor a request
    that ``/respond`` would then refuse.
    """
    if not donor.is_available:
        return []

    req_res = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations), selectinload(BloodRequest.hospital))
        .where(
            BloodRequest.status.in_([
                RequestStatus.PROXIMITY_ZONE_NOTIFIED,
                RequestStatus.RE_PLANNING,
            ])
        )
        .order_by(BloodRequest.calculated_urgency_score.desc())
    )

    active_requests = [
        r for r in req_res.scalars().all()
        if r.units_covered < r.units_requested
    ]
    if not active_requests:
        return []

    redis_conn = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis_conn)

    # Batch check membership and TTL for all candidate requests in a single round-trip
    pipe = redis_conn.pipeline()
    for req in active_requests:
        pipe.sismember(lock_mgr._zone_key(req.id), donor.id)
        pipe.ttl(lock_mgr._zone_key(req.id))
    raw_results = await pipe.execute()

    alerts: List[BloodRequestOut] = []
    for idx, request in enumerate(active_requests):
        is_member = raw_results[idx * 2]
        ttl_val = raw_results[idx * 2 + 1]
        ttl_seconds = ttl_val if isinstance(ttl_val, int) and ttl_val >= 0 else None

        # Biological compatibility: Plasma-derived components follow the plasma matrix, otherwise red-cell matrix.
        compatible_groups = MatchingEngineService.get_compatible_donor_types(
            request.required_blood_group, is_plasma=is_plasma_derived(request.component_type)
        )
        if donor.blood_group not in compatible_groups:
            continue

        # If not already recorded in Redis (e.g. registered after request or TTL expired),
        # enroll this compatible donor so they can immediately claim a unit.
        if not is_member:
            await lock_mgr.register_alerted_donors(request.id, [donor.id], ttl_seconds=180)
            ttl_seconds = 180

        alerts.append(
            BloodRequestOut.model_validate(request).model_copy(
                update={"alert_expires_in_seconds": ttl_seconds}
            )
        )

    return alerts



@router.post("/respond", response_model=DonorRespondOut)
async def respond_to_active_alert_contextual(
    resp: DonorRespondRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Contextual 1-Tap Response for mobile app.
    Donor responds (ACCEPT / DECLINE) without needing a long URL ID.
    If 'request_id' is supplied in the request body, it targets that request or short code (e.g. 'REQ-8492');
    otherwise, it automatically discovers the emergency alert currently active for this donor.
    """
    target_request_id = resp.request_id

    if not target_request_id:
        active_alerts = await get_active_emergency_alerts(db=db, donor=donor, current_user=current_user)
        if not active_alerts:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active emergency dispatch alert is currently open for your account.",
            )
        target_request_id = active_alerts[0].id

    allocation_svc = AllocationService(db)
    result = await allocation_svc.process_donor_response(
        request_id=target_request_id,
        donor_id=donor.id,
        action=resp.action,
    )
    background_tasks.add_task(NotificationQueueService.process_next_batch, 20)
    return DonorRespondOut.model_validate(result)


@router.post("/requests/{id}/respond", response_model=DonorRespondOut)
async def respond_to_emergency_dispatch(
    id: str,
    resp: DonorRespondRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """[USER-FACING] Donor responds (ACCEPT / DECLINE) using either full UUID or short code (e.g. 'REQ-8492')."""
    allocation_svc = AllocationService(db)
    result = await allocation_svc.process_donor_response(
        request_id=id,
        donor_id=donor.id,
        action=resp.action,
    )
    background_tasks.add_task(NotificationQueueService.process_next_batch, 20)
    return DonorRespondOut.model_validate(result)

