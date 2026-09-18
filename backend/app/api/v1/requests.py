from typing import List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.models.user import User
from app.models.hospital import Hospital
from app.models.request import BloodRequest, RequestStatus
from app.models.allocation import Allocation, AllocationStatus
from app.schemas.request import BloodRequestCreate, BloodRequestOut
from app.services.matching_service import MatchingEngineService
from app.services.allocation_service import AllocationService
from app.api.deps import get_current_user
from app.websocket.connection_manager import manager

router = APIRouter()


@router.post("", response_model=BloodRequestOut, status_code=status.HTTP_201_CREATED)
async def create_blood_request(
    req_in: BloodRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Create a verified emergency blood request and trigger optimization."""
    # Find hospital profile
    res = await db.execute(select(Hospital).where(Hospital.user_id == current_user.id))
    hospital = res.scalars().first()
    if not hospital:
        # Fallback to first hospital for demo / coordinator convenience
        first_hosp = (await db.execute(select(Hospital))).scalars().first()
        if not first_hosp:
            raise HTTPException(status_code=400, detail="No hospital profile configured")
        hospital = first_hosp

    urgency_score = MatchingEngineService.calculate_urgency_score(req_in.triage_level, req_in.deadline_at)

    blood_req = BloodRequest(
        hospital_id=hospital.id,
        patient_id_token=req_in.patient_id_token,
        required_blood_group=req_in.required_blood_group,
        component_type=req_in.component_type,
        units_requested=req_in.units_requested,
        triage_level=req_in.triage_level,
        calculated_urgency_score=urgency_score,
        deadline_at=req_in.deadline_at,
        status=RequestStatus.PENDING_EVALUATION
    )
    db.add(blood_req)
    await db.commit()
    await db.refresh(blood_req)

    # Immediately trigger allocation pipeline
    allocation_svc = AllocationService(db)
    await allocation_svc.execute_allocation_pipeline(blood_req.id, radius_km=5.0)

    # Reload with allocations
    result = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations))
        .where(BloodRequest.id == blood_req.id)
    )
    loaded_req = result.scalars().first()

    await manager.broadcast({
        "type": "REQUEST_CREATED",
        "request_id": loaded_req.id,
        "required_blood_group": loaded_req.required_blood_group,
        "units_requested": loaded_req.units_requested,
        "urgency_score": loaded_req.calculated_urgency_score,
        "status": loaded_req.status.value
    })

    return loaded_req


@router.get("/{id}", response_model=BloodRequestOut)
async def get_blood_request(id: str, db: AsyncSession = Depends(get_db)):
    """[USER-FACING] Retrieve real-time status of a blood request with its active allocations."""
    result = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations))
        .where(BloodRequest.id == id)
    )
    blood_req = result.scalars().first()
    if not blood_req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    return blood_req


@router.get("", response_model=List[BloodRequestOut])
async def list_blood_requests(skip: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """[USER-FACING] List active emergency blood requests ordered by urgency."""
    res = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations))
        .order_by(BloodRequest.calculated_urgency_score.desc(), BloodRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(res.scalars().all())


@router.patch("/{id}/cancel", response_model=BloodRequestOut)
async def cancel_blood_request(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Cancel an open emergency blood request."""
    result = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations))
        .where(BloodRequest.id == id)
    )
    blood_req = result.scalars().first()
    if not blood_req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    blood_req.status = RequestStatus.CANCELLED
    await db.commit()
    await db.refresh(blood_req)

    await manager.broadcast({
        "type": "REQUEST_CANCELLED",
        "request_id": blood_req.id,
        "status": blood_req.status.value
    })

    return blood_req


@router.post("/{id}/fulfill", response_model=BloodRequestOut)
async def fulfill_blood_request(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Mark emergency blood request as fulfilled upon arrival at the hospital."""
    result = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations))
        .where(BloodRequest.id == id)
    )
    blood_req = result.scalars().first()
    if not blood_req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    blood_req.status = RequestStatus.FULFILLED
    now = datetime.now(timezone.utc)
    for alloc in blood_req.allocations:
        alloc.status = AllocationStatus.COMPLETED
        alloc.completed_at = now

    await db.commit()
    await db.refresh(blood_req)

    await manager.broadcast({
        "type": "REQUEST_FULFILLED",
        "request_id": blood_req.id,
        "status": blood_req.status.value,
        "message": f"Blood request {blood_req.id[:8]} successfully fulfilled."
    })

    return blood_req
