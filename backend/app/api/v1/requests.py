import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, resolve_role
from app.core.database import get_db
from app.core.permissions import UserRole
from app.core.redis import ConcurrencyLockManager, get_redis
from app.models.allocation import AllocationStatus
from app.models.donor import Donor
from app.models.hospital import Hospital
from app.models.inventory import InventoryUnit, UnitStatus

from app.models.request import BloodRequest, RequestStatus
from app.models.user import User
from app.schemas.request import BloodRequestCreate, BloodRequestOut
from app.services.allocation_service import AllocationService
from app.services.donor_service import record_donor_outcome
from app.services.matching_service import MatchingEngineService
from app.services.notification_queue import NotificationQueueService
from app.websocket.connection_manager import manager


logger = logging.getLogger("smartblood.requests")

router = APIRouter()

# Statuses a request can still be cancelled or fulfilled from.
TERMINAL_REQUEST_STATUSES = (
    RequestStatus.FULFILLED,
    RequestStatus.CANCELLED,
    RequestStatus.EXPIRED,
)

# Allocation states that free their resource when the request ends.
RESERVING_ALLOCATION_STATUSES = (
    AllocationStatus.HARD_LOCKED,
    AllocationStatus.IN_TRANSIT,
)

_RELOAD_OPTIONS = (
    selectinload(BloodRequest.allocations),
    selectinload(BloodRequest.hospital),
)


async def _load_request(db: AsyncSession, identifier: str) -> BloodRequest:
    """Load request by either its UUID primary key or its human-readable code (e.g. 'REQ-8492')."""
    clean_id = identifier.strip()
    result = await db.execute(
        select(BloodRequest)
        .options(*_RELOAD_OPTIONS)
        .where(
            or_(
                BloodRequest.id == clean_id,
                func.upper(BloodRequest.code) == clean_id.upper(),
            )
        )
    )
    blood_req = result.scalars().first()
    if not blood_req:
        raise HTTPException(status_code=404, detail=f"Blood request '{identifier}' not found")
    return blood_req


async def _owned_hospital(db: AsyncSession, current_user: User) -> Hospital:
    """The hospital profile belonging to this user, or 403."""
    res = await db.execute(select(Hospital).where(Hospital.user_id == current_user.id))
    hospital = res.scalars().first()
    if not hospital:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No hospital profile is linked to this account",
        )
    return hospital


async def _resolve_requesting_hospital(
    db: AsyncSession, current_user: User, payload_hospital_id: Optional[str]
) -> Hospital:
    """
    Decide which hospital a new request belongs to.

    Hospital accounts always raise for their own facility and may not name another.
    Coordinators and admins have no facility of their own, so they must name one
    explicitly. Previously this fell back to "whichever hospital is first in the
    table", which silently attributed requests to an unrelated facility.
    """
    role = resolve_role(current_user)

    if role == UserRole.HOSPITAL.value:
        hospital = await _owned_hospital(db, current_user)
        if payload_hospital_id and payload_hospital_id != hospital.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You may only create requests for your own hospital.",
            )
        return hospital

    if role in (UserRole.COORDINATOR.value, UserRole.ADMIN.value):
        if not payload_hospital_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "hospital_id is required when creating a request on behalf of a "
                    "hospital as a coordinator or admin."
                ),
            )
        hospital = await db.get(Hospital, payload_hospital_id)
        if hospital is None:
            raise HTTPException(
                status_code=404, detail=f"Hospital {payload_hospital_id} not found"
            )
        return hospital

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Role {role} may not create blood requests.",
    )


async def _assert_request_access(
    db: AsyncSession, current_user: User, blood_req: BloodRequest
) -> None:
    """A hospital may only touch its own requests; staff roles may touch any."""
    role = resolve_role(current_user)

    if role == UserRole.HOSPITAL.value:
        hospital = await _owned_hospital(db, current_user)
        if blood_req.hospital_id != hospital.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This blood request belongs to another hospital.",
            )
        return

    if role in (
        UserRole.BLOOD_BANK.value,
        UserRole.COORDINATOR.value,
        UserRole.ADMIN.value,
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Role {role} may not access blood requests directly.",
    )


@router.post("", response_model=BloodRequestOut, status_code=status.HTTP_201_CREATED)
async def create_blood_request(
    req_in: BloodRequestCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[USER-FACING] Create a verified emergency blood request and trigger optimization."""
    hospital = await _resolve_requesting_hospital(db, current_user, req_in.hospital_id)

    urgency_score = MatchingEngineService.calculate_urgency_score(
        req_in.triage_level, req_in.deadline_at
    )

    blood_req = BloodRequest(
        hospital_id=hospital.id,
        patient_id_token=req_in.patient_id_token,
        required_blood_group=req_in.required_blood_group,
        component_type=req_in.component_type,
        units_requested=req_in.units_requested,
        triage_level=req_in.triage_level,
        calculated_urgency_score=urgency_score,
        deadline_at=req_in.deadline_at,
        status=RequestStatus.PENDING_EVALUATION,
    )
    db.add(blood_req)
    await db.commit()
    await db.refresh(blood_req)

    # The request row is persisted first so a downstream failure cannot lose it, but
    # a pipeline error must not surface as a 500 on an already-created request.
    allocation_svc = AllocationService(db)
    try:
        await allocation_svc.execute_allocation_pipeline(
            blood_req.id,
            request=blood_req,
            hospital=hospital,
            fulfillment_mode=req_in.fulfillment_mode or "AUTO",
        )
    except Exception:
        logger.exception("Allocation pipeline failed for request %s", blood_req.id)
        await db.rollback()
        blood_req = await db.get(BloodRequest, blood_req.id)
        if blood_req and blood_req.status == RequestStatus.PENDING_EVALUATION:
            blood_req.status = RequestStatus.RE_PLANNING
            await db.commit()
        manager.dispatch(
            manager.broadcast_operational(
                {
                    "type": "RE_PLANNING_TRIGGERED",
                    "request_id": blood_req.id if blood_req else None,
                    "reason": "ALLOCATION_PIPELINE_ERROR",
                    "message": (
                        "Request recorded, but automatic sourcing failed. "
                        "It has been queued for re-planning."
                    ),
                }
            )
        )


    loaded_req = await _load_request(db, blood_req.id)

    # Offload parallel notification batch delivery to background task
    background_tasks.add_task(NotificationQueueService.process_next_batch, 50)

    manager.dispatch(
        manager.broadcast_operational(
            {
                "type": "REQUEST_CREATED",
                "request_id": loaded_req.id,
                "hospital_id": loaded_req.hospital_id,
                "hospital_name": loaded_req.hospital_name,
                "required_blood_group": loaded_req.required_blood_group,
                "component_type": loaded_req.component_type.value,
                "units_requested": loaded_req.units_requested,
                "units_covered": loaded_req.units_covered,
                "urgency_score": loaded_req.calculated_urgency_score,
                "status": loaded_req.status.value,
            }
        )
    )


    return BloodRequestOut.model_validate(loaded_req)



@router.get("/{id}", response_model=BloodRequestOut)
async def get_blood_request(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[USER-FACING] Retrieve real-time status of a blood request with its active allocations."""
    blood_req = await _load_request(db, id)
    await _assert_request_access(db, current_user, blood_req)
    return BloodRequestOut.model_validate(blood_req)


@router.get("", response_model=List[BloodRequestOut])
async def list_blood_requests(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[USER-FACING] List active emergency blood requests ordered by urgency."""
    role = resolve_role(current_user)
    if role == UserRole.DONOR.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Donors receive targeted emergency alerts rather than the full request board.",
        )

    query = (
        select(BloodRequest)
        .options(*_RELOAD_OPTIONS)
        .order_by(
            BloodRequest.calculated_urgency_score.desc(), BloodRequest.created_at.desc()
        )
    )

    # Hospitals see only their own demand. Blood banks see the whole board so they can
    # dispatch stock; coordinators and admins see everything.
    if role == UserRole.HOSPITAL.value:
        hospital = await _owned_hospital(db, current_user)
        query = query.where(BloodRequest.hospital_id == hospital.id)

    res = await db.execute(query.offset(skip).limit(limit))
    return [BloodRequestOut.model_validate(r) for r in res.scalars().all()]


async def _release_request_resources(
    db: AsyncSession, blood_req: BloodRequest, new_status: RequestStatus
) -> None:
    """
    End a request: release every Redis lock, return reserved stock to the shelf, mark
    the allocations as superseded, and clear donor stand-down state.
    """
    inv_ids = [
        alloc.inventory_unit_id
        for alloc in blood_req.allocations
        if alloc.status in RESERVING_ALLOCATION_STATUSES and alloc.inventory_unit_id
    ]
    if inv_ids:
        await db.execute(
            update(InventoryUnit)
            .where(
                InventoryUnit.id.in_(inv_ids),
                InventoryUnit.status == UnitStatus.LOCKED_RESERVE,
            )
            .values(status=UnitStatus.AVAILABLE)
        )

    for alloc in blood_req.allocations:
        if alloc.status in RESERVING_ALLOCATION_STATUSES:
            alloc.status = AllocationStatus.RE_OPTIMIZED


    blood_req.status = new_status
    await db.commit()

    redis_conn = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis_conn)
    await lock_mgr.release_request_locks(blood_req.id)


@router.patch("/{id}/cancel", response_model=BloodRequestOut)
async def cancel_blood_request(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[USER-FACING] Cancel an open emergency blood request."""
    blood_req = await _load_request(db, id)
    await _assert_request_access(db, current_user, blood_req)

    if blood_req.status in TERMINAL_REQUEST_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This request is already {blood_req.status.value}.",
        )

    await _release_request_resources(db, blood_req, RequestStatus.CANCELLED)
    await db.refresh(blood_req)

    await manager.broadcast_operational(
        {
            "type": "REQUEST_CANCELLED",
            "request_id": blood_req.id,
            "hospital_id": blood_req.hospital_id,
            "status": blood_req.status.value,
            "message": f"Blood request {blood_req.id[:8]} was cancelled; reserved stock released.",
        }
    )
    await manager.broadcast_to_hospital(
        blood_req.hospital_id,
        {
            "type": "REQUEST_UPDATED",
            "request_id": blood_req.id,
            "status": blood_req.status.value,
            "units_covered": blood_req.units_covered,
            "units_requested": blood_req.units_requested,
        },
    )

    return BloodRequestOut.model_validate(blood_req)


@router.post("/{id}/fulfill", response_model=BloodRequestOut)
async def fulfill_blood_request(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[USER-FACING] Mark emergency blood request as fulfilled upon arrival at the hospital."""
    blood_req = await _load_request(db, id)
    await _assert_request_access(db, current_user, blood_req)

    if blood_req.status == RequestStatus.FULFILLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This request is already fulfilled."
        )
    if blood_req.status == RequestStatus.CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A cancelled request cannot be fulfilled.",
        )

    if blood_req.units_covered < blood_req.units_requested:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Only {blood_req.units_covered} of {blood_req.units_requested} unit(s) are "
                f"secured. Source the remaining {blood_req.units_shortfall} before fulfilling."
            ),
        )

    now = datetime.now(timezone.utc)
    inv_ids = [
        alloc.inventory_unit_id
        for alloc in blood_req.allocations
        if alloc.status in RESERVING_ALLOCATION_STATUSES and alloc.inventory_unit_id
    ]
    if inv_ids:
        await db.execute(
            update(InventoryUnit)
            .where(InventoryUnit.id.in_(inv_ids))
            .values(status=UnitStatus.DISPATCHED)
        )

    donor_ids = [
        alloc.donor_id
        for alloc in blood_req.allocations
        if alloc.status in RESERVING_ALLOCATION_STATUSES and alloc.donor_id
    ]
    if donor_ids:
        donors_res = await db.execute(select(Donor).where(Donor.id.in_(donor_ids)))
        for donor in donors_res.scalars().all():
            record_donor_outcome(donor, success=True)

    for alloc in blood_req.allocations:
        if alloc.status in RESERVING_ALLOCATION_STATUSES:
            alloc.status = AllocationStatus.COMPLETED
            alloc.completed_at = now

    blood_req.status = RequestStatus.FULFILLED
    await db.commit()
    await db.refresh(blood_req)

    redis_conn = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis_conn)
    await lock_mgr.release_request_locks(blood_req.id)

    manager.dispatch(
        manager.broadcast_operational(
            {
                "type": "REQUEST_FULFILLED",
                "request_id": blood_req.id,
                "hospital_id": blood_req.hospital_id,
                "status": blood_req.status.value,
                "units_covered": blood_req.units_covered,
                "units_requested": blood_req.units_requested,
                "message": f"Blood request {blood_req.id[:8]} successfully fulfilled.",
            }
        )
    )
    manager.dispatch(
        manager.broadcast_to_hospital(
            blood_req.hospital_id,
            {
                "type": "REQUEST_UPDATED",
                "request_id": blood_req.id,
                "status": blood_req.status.value,
                "units_covered": blood_req.units_covered,
                "units_requested": blood_req.units_requested,
            },
        )
    )


    return BloodRequestOut.model_validate(blood_req)
