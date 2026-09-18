from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.user import User
from app.models.hospital import Hospital
from app.models.request import BloodRequest, RequestStatus
from app.schemas.request import BloodRequestCreate, BloodRequestOut
from app.services.matching_service import MatchingEngineService
from app.services.allocation_service import AllocationService
from app.api.deps import get_current_user

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
        raise HTTPException(status_code=400, detail="User does not have an associated hospital profile")

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

    # Immediately trigger background/in-line allocation pipeline
    allocation_svc = AllocationService(db)
    await allocation_svc.execute_allocation_pipeline(blood_req.id, radius_km=5.0)
    await db.refresh(blood_req)

    return BloodRequestOut.model_validate(blood_req)


@router.get("/{id}", response_model=BloodRequestOut)
async def get_blood_request(id: str, db: AsyncSession = Depends(get_db)):
    """[USER-FACING] Retrieve real-time status of a blood request."""
    blood_req = await db.get(BloodRequest, id)
    if not blood_req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    return BloodRequestOut.model_validate(blood_req)


@router.get("", response_model=List[BloodRequestOut])
async def list_blood_requests(skip: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """[USER-FACING] List active emergency blood requests."""
    res = await db.execute(
        select(BloodRequest)
        .order_by(BloodRequest.calculated_urgency_score.desc(), BloodRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return [BloodRequestOut.model_validate(r) for r in res.scalars().all()]


@router.patch("/{id}/cancel", response_model=BloodRequestOut)
async def cancel_blood_request(id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """[USER-FACING] Cancel an open emergency blood request."""
    blood_req = await db.get(BloodRequest, id)
    if not blood_req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    blood_req.status = RequestStatus.CANCELLED
    await db.commit()
    await db.refresh(blood_req)
    return BloodRequestOut.model_validate(blood_req)

