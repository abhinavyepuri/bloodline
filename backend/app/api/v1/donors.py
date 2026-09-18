from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.core.database import get_db
from app.models.user import User
from app.models.donor import Donor
from app.models.request import BloodRequest, RequestStatus
from app.models.allocation import Allocation, AllocationStatus
from app.schemas.donor import DonorUpdateAvailability, DonorOut
from app.schemas.allocation import DonorRespondRequest, DonorRespondOut
from app.schemas.request import BloodRequestOut
from app.services.allocation_service import AllocationService
from app.api.deps import get_current_user
from app.services.matching_service import MatchingEngineService
from app.websocket.connection_manager import manager

router = APIRouter()


@router.get("/me", response_model=DonorOut)
async def get_current_donor_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Retrieve current donor's profile, availability, and stats."""
    res = await db.execute(select(Donor).where(Donor.user_id == current_user.id))
    donor = res.scalars().first()
    if not donor:
        raise HTTPException(status_code=404, detail="Donor profile not found")
    return DonorOut.model_validate(donor)


@router.get("", response_model=List[DonorOut])
async def list_donors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] List registered donors (for Coordinator/Admin)."""
    res = await db.execute(select(Donor).order_by(Donor.reliability_score.desc()))
    return [DonorOut.model_validate(d) for d in res.scalars().all()]


@router.patch("/availability", response_model=DonorOut)
async def update_donor_availability(
    update_in: DonorUpdateAvailability,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Toggle donor active availability and ping current GPS location."""
    res = await db.execute(select(Donor).where(Donor.user_id == current_user.id))
    donor = res.scalars().first()
    if not donor:
        raise HTTPException(status_code=404, detail="Donor profile not found")

    donor.is_available = update_in.is_available
    if update_in.latitude is not None and update_in.longitude is not None:
        donor.latitude = update_in.latitude
        donor.longitude = update_in.longitude
        donor.location = func.ST_SetSRID(func.ST_Point(update_in.longitude, update_in.latitude), 4326)

    await db.commit()
    await db.refresh(donor)

    await manager.broadcast({
        "type": "DONOR_AVAILABILITY_CHANGED",
        "donor_id": donor.id,
        "is_available": donor.is_available,
        "latitude": donor.latitude,
        "longitude": donor.longitude
    })

    return DonorOut.model_validate(donor)


@router.get("/requests/active", response_model=List[BloodRequestOut])
async def get_active_emergency_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    [USER-FACING] Retrieve active emergency blood requests that are broadcasting to this donor.
    Filters for compatible blood requests in PROXIMITY_ZONE_NOTIFIED status.
    """
    res = await db.execute(select(Donor).where(Donor.user_id == current_user.id))
    donor = res.scalars().first()
    if not donor or not donor.is_available:
        return []

    # Get requests in PROXIMITY_ZONE_NOTIFIED
    req_res = await db.execute(
        select(BloodRequest)
        .where(BloodRequest.status == RequestStatus.PROXIMITY_ZONE_NOTIFIED)
        .order_by(BloodRequest.calculated_urgency_score.desc())
    )
    all_active = list(req_res.scalars().all())

    compatible_requests = []
    for r in all_active:
        compatible_groups = MatchingEngineService.get_compatible_donor_types(r.required_blood_group)
        if donor.blood_group in compatible_groups:
            compatible_requests.append(BloodRequestOut.model_validate(r))

    return compatible_requests


@router.post("/requests/{id}/respond", response_model=DonorRespondOut)
async def respond_to_emergency_dispatch(
    id: str,
    resp: DonorRespondRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Donor responds (ACCEPT / DECLINE) to emergency proximity alert."""
    res = await db.execute(select(Donor).where(Donor.user_id == current_user.id))
    donor = res.scalars().first()
    if not donor:
        raise HTTPException(status_code=404, detail="Donor profile not found")

    allocation_svc = AllocationService(db)
    result = await allocation_svc.process_donor_response(
        request_id=id,
        donor_id=donor.id,
        action=resp.action
    )
    return DonorRespondOut.model_validate(result)
