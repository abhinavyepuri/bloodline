from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.hospital import Hospital
from app.models.user import User
from app.schemas.hospital import HospitalDirectoryOut

router = APIRouter()


@router.get("", response_model=List[HospitalDirectoryOut])
async def list_hospitals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(
            UserRole.HOSPITAL,
            UserRole.BLOOD_BANK,
            UserRole.COORDINATOR,
            UserRole.ADMIN,
        )
    ),
):
    """
    [USER-FACING] Facility directory.

    Coordinators and admins need this to raise a request on behalf of a specific
    hospital (``POST /requests`` requires an explicit ``hospital_id`` for them).
    Donors are excluded — they are routed to a hospital by the matching engine rather
    than choosing one.
    """
    res = await db.execute(select(Hospital).order_by(Hospital.name.asc()))
    return [HospitalDirectoryOut.model_validate(h) for h in res.scalars().all()]
