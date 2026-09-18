from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.models.user import User
from app.models.donor import Donor
from app.schemas.donor import DonorUpdateAvailability, DonorOut
from app.schemas.allocation import DonorRespondRequest
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
    return donor


@router.post("/requests/{id}/respond")
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
    return result
