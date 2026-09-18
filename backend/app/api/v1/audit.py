from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles, resolve_role
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.audit import AllocationAuditLog
from app.models.hospital import Hospital
from app.models.request import BloodRequest
from app.models.user import User
from app.schemas.audit import AllocationAuditLogOut

router = APIRouter()


@router.get("/requests/{id}/explanation", response_model=List[AllocationAuditLogOut])
async def get_request_explanation(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    [USER-FACING] Return explainability breakdown and decision justification logs for a request.

    A hospital may read the reasoning behind its own requests; blood banks and
    coordinators may read any. Donors may not — the logs name the resources and
    donors considered.
    """
    role = resolve_role(current_user)
    if role == UserRole.DONOR.value:
        raise HTTPException(status_code=403, detail="Donors cannot read allocation audit logs.")

    blood_req = await db.get(BloodRequest, id)
    if blood_req is None:
        raise HTTPException(status_code=404, detail="Blood request not found")

    if role == UserRole.HOSPITAL.value:
        res = await db.execute(select(Hospital).where(Hospital.user_id == current_user.id))
        hospital = res.scalars().first()
        if hospital is None or blood_req.hospital_id != hospital.id:
            raise HTTPException(
                status_code=403, detail="This blood request belongs to another hospital."
            )

    res = await db.execute(
        select(AllocationAuditLog)
        .where(AllocationAuditLog.request_id == id)
        .order_by(AllocationAuditLog.created_at.asc())
    )
    logs = list(res.scalars().all())
    if not logs:
        raise HTTPException(status_code=404, detail="No audit logs available for this request")
    return [AllocationAuditLogOut.model_validate(log) for log in logs]


@router.get("/logs", response_model=List[AllocationAuditLogOut])
async def get_system_audit_logs(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.COORDINATOR)),
):
    """[USER-FACING] Retrieve system-wide allocation decision logs for Admin/Coordinator."""
    res = await db.execute(
        select(AllocationAuditLog)
        .order_by(AllocationAuditLog.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return [AllocationAuditLogOut.model_validate(log) for log in res.scalars().all()]
