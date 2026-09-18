from typing import List

from fastapi import APIRouter, Depends
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
from app.schemas.donor import DonorOut, DonorPublicOut, DonorUpdateAvailability
from app.schemas.request import BloodRequestOut
from app.services.allocation_service import AllocationService
from app.services.donor_service import is_plasma_derived
from app.services.matching_service import MatchingEngineService
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
    await manager.broadcast_operational(
        {
            "type": "DONOR_AVAILABILITY_CHANGED",
            "donor_id": donor.id,
            "blood_group": donor.blood_group,
            "is_available": donor.is_available,
        }
    )

    return DonorOut.model_validate(donor)


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
        .where(BloodRequest.status == RequestStatus.PROXIMITY_ZONE_NOTIFIED)
        .order_by(BloodRequest.calculated_urgency_score.desc())
    )

    redis_conn = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis_conn)

    alerts: List[BloodRequestOut] = []
    for request in req_res.scalars().all():
        # A request that is fully covered no longer needs this donor.
        if request.units_covered >= request.units_requested:
            continue

        if not await lock_mgr.is_donor_alerted(request.id, donor.id):
            continue

        # Plasma-derived components follow the plasma matrix, not the red-cell one.
        compatible_groups = MatchingEngineService.get_compatible_donor_types(
            request.required_blood_group, is_plasma=is_plasma_derived(request.component_type)
        )
        if donor.blood_group not in compatible_groups:
            continue

        alerts.append(
            BloodRequestOut.model_validate(request).model_copy(
                update={"alert_expires_in_seconds": await lock_mgr.alert_zone_ttl(request.id)}
            )
        )

    return alerts


@router.post("/requests/{id}/respond", response_model=DonorRespondOut)
async def respond_to_emergency_dispatch(
    id: str,
    resp: DonorRespondRequest,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """[USER-FACING] Donor responds (ACCEPT / DECLINE) to emergency proximity alert."""
    allocation_svc = AllocationService(db)
    result = await allocation_svc.process_donor_response(
        request_id=id,
        donor_id=donor.id,
        action=resp.action,
    )
    return DonorRespondOut.model_validate(result)
