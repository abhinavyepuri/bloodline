from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
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

router = APIRouter()


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
    return DonorOut.model_validate(donor)


@router.get("/requests/active", response_model=Optional[BloodRequestOut])
async def get_active_donor_dispatch_request(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Fetches current pending emergency dispatch request assigned/notified to the donor."""
    res = await db.execute(select(Donor).where(Donor.user_id == current_user.id))
    donor = res.scalars().first()
    if not donor:
        raise HTTPException(status_code=404, detail="Donor profile not found")

    # Check for active committed allocations first
    alloc_res = await db.execute(
        select(Allocation)
        .where(
            Allocation.donor_id == donor.id,
            Allocation.status.in_([AllocationStatus.HARD_LOCKED, AllocationStatus.IN_TRANSIT])
        )
        .order_by(Allocation.created_at.desc())
    )
    active_alloc = alloc_res.scalars().first()
    if active_alloc:
        active_req = await db.get(BloodRequest, active_alloc.request_id)
        if active_req and active_req.status not in (RequestStatus.FULFILLED, RequestStatus.CANCELLED, RequestStatus.EXPIRED):
            return BloodRequestOut.model_validate(active_req)

    # Check for open proximity zone notifications
    req_res = await db.execute(
        select(BloodRequest)
        .where(BloodRequest.status == RequestStatus.PROXIMITY_ZONE_NOTIFIED)
        .order_by(BloodRequest.calculated_urgency_score.desc(), BloodRequest.created_at.desc())
    )
    latest_req = req_res.scalars().first()
    if latest_req:
        return BloodRequestOut.model_validate(latest_req)

    return None


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

