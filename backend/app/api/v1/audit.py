from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.audit import AllocationAuditLog
from app.schemas.audit import AllocationAuditLogOut

router = APIRouter()


@router.get("/requests/{id}/explanation", response_model=List[AllocationAuditLogOut])
async def get_request_explanation(id: str, db: AsyncSession = Depends(get_db)):
    """[USER-FACING] Return explainability breakdown and decision justification logs for a request."""
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
async def get_system_audit_logs(skip: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """[USER-FACING] Retrieve system-wide allocation decision logs for Admin/Coordinator."""
    res = await db.execute(
        select(AllocationAuditLog)
        .order_by(AllocationAuditLog.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return [AllocationAuditLogOut.model_validate(log) for log in res.scalars().all()]

