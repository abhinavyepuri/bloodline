from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_blood_bank,
    get_current_user,
    is_elevated,
    require_roles,
    resolve_role,
)
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.allocation import Allocation, AllocationSourceType, AllocationStatus
from app.models.blood_bank import BloodBank
from app.models.hospital import Hospital
from app.models.inventory import InventoryUnit, UnitStatus
from app.models.request import BloodRequest, RequestStatus
from app.models.user import User
from app.schemas.inventory import (
    InventoryUnitCreate,
    InventoryUnitOut,
    InventoryUnitUpdateStatus,
)
from app.services.allocation_service import AllocationService
from app.websocket.connection_manager import manager

router = APIRouter()

# Stock operations belong to blood banks; coordinators and admins may step in.
StockUser = Depends(require_roles(UserRole.BLOOD_BANK, UserRole.COORDINATOR, UserRole.ADMIN))

# A request in one of these states can no longer receive a dispatch.
CLOSED_REQUEST_STATUSES = (
    RequestStatus.FULFILLED,
    RequestStatus.CANCELLED,
    RequestStatus.EXPIRED,
)


async def _owning_bank(db: AsyncSession, current_user: User) -> Optional[BloodBank]:
    """
    The blood bank this caller owns, or None for coordinators/admins.

    Blood banks are always confined to their own stock. Elevated roles act across the
    network, so they get None and are expected to have named a bank explicitly.
    """
    if resolve_role(current_user) != UserRole.BLOOD_BANK.value:
        return None
    return await get_current_blood_bank(db=db, current_user=current_user)


@router.get("", response_model=List[InventoryUnitOut])
async def list_inventory(
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """[USER-FACING] List on-shelf blood inventory units."""
    query = select(InventoryUnit).order_by(InventoryUnit.expiry_date.asc())

    bank = await _owning_bank(db, current_user)
    if bank is not None:
        query = query.where(InventoryUnit.blood_bank_id == bank.id)

    res = await db.execute(query)
    return [InventoryUnitOut.model_validate(u) for u in res.scalars().all()]


@router.post("/units", response_model=InventoryUnitOut, status_code=status.HTTP_201_CREATED)
async def register_inventory_unit(
    unit_in: InventoryUnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """[USER-FACING] Log a new verified blood unit into blood bank stock."""
    bank = await _owning_bank(db, current_user)
    if bank is None:
        # Elevated caller: they must say which bank the stock belongs to rather than
        # having it silently attached to whichever bank happens to be first.
        if not unit_in.blood_bank_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="blood_bank_id is required when registering stock as a coordinator or admin.",
            )
        bank = await db.get(BloodBank, unit_in.blood_bank_id)
        if bank is None:
            raise HTTPException(
                status_code=404, detail=f"Blood bank {unit_in.blood_bank_id} not found"
            )

    if unit_in.expiry_date <= unit_in.collection_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="expiry_date must be later than collection_date.",
        )

    unit = InventoryUnit(
        blood_bank_id=bank.id,
        batch_number=unit_in.batch_number,
        blood_group=unit_in.blood_group,
        component_type=unit_in.component_type,
        volume_ml=unit_in.volume_ml,
        collection_date=unit_in.collection_date,
        expiry_date=unit_in.expiry_date,
        status=UnitStatus.AVAILABLE,
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)

    await manager.broadcast_operational(
        {
            "type": "INVENTORY_UNIT_ADDED",
            "unit_id": unit.id,
            "blood_bank_id": unit.blood_bank_id,
            "batch_number": unit.batch_number,
            "blood_group": unit.blood_group,
            "component_type": unit.component_type.value,
            "status": unit.status.value,
        }
    )

    # New stock can unblock requests that are waiting in RE_PLANNING.
    replan_requests_res = await db.execute(
        select(BloodRequest).where(
            and_(
                BloodRequest.status == RequestStatus.RE_PLANNING,
                BloodRequest.required_blood_group == unit.blood_group,
                BloodRequest.component_type == unit.component_type,
            )
        )
    )
    alloc_svc = AllocationService(db)
    for req in replan_requests_res.scalars().all():
        await alloc_svc.replan_request(
            req.id, trigger_reason=f"New inventory unit {unit.batch_number} added"
        )

    return InventoryUnitOut.model_validate(unit)


@router.patch("/units/{id}/status", response_model=InventoryUnitOut)
async def update_unit_status(
    id: str,
    status_in: InventoryUnitUpdateStatus,
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """
    [USER-FACING] Update status of inventory unit (e.g., mark quarantined or expired).
    Triggers automatic re-planning if unit was reserved/hard-locked for an active request!
    """
    unit = await db.get(InventoryUnit, id)
    if not unit:
        raise HTTPException(status_code=404, detail="Inventory unit not found")

    bank = await _owning_bank(db, current_user)
    if bank is not None and unit.blood_bank_id != bank.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This inventory unit belongs to another blood bank.",
        )

    old_status = unit.status
    unit.status = status_in.status
    await db.commit()
    await db.refresh(unit)

    await manager.broadcast_operational(
        {
            "type": "INVENTORY_UNIT_STATUS_CHANGED",
            "unit_id": unit.id,
            "blood_bank_id": unit.blood_bank_id,
            "batch_number": unit.batch_number,
            "old_status": old_status.value,
            "new_status": unit.status.value,
        }
    )

    # A reserved unit that is quarantined or expired invalidates its allocation, so the
    # affected request has to be re-planned.
    if (
        status_in.status in (UnitStatus.QUARANTINED, UnitStatus.EXPIRED)
        and old_status == UnitStatus.LOCKED_RESERVE
    ):
        alloc_res = await db.execute(
            select(Allocation).where(
                and_(
                    Allocation.inventory_unit_id == unit.id,
                    Allocation.status == AllocationStatus.HARD_LOCKED,
                )
            )
        )

        alloc_svc = AllocationService(db)
        for alloc in alloc_res.scalars().all():
            alloc.status = AllocationStatus.RE_OPTIMIZED
            await db.commit()

            await alloc_svc.replan_request(
                request_id=alloc.request_id,
                trigger_reason=f"Unit {unit.batch_number} was quarantined/invalidated",
            )

    return InventoryUnitOut.model_validate(unit)


@router.get("/orders")
async def list_incoming_hospital_orders(
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """[USER-FACING] List emergency blood orders routed from hospitals to this blood bank."""
    bank = await _owning_bank(db, current_user)

    alloc_query = (
        select(Allocation, BloodRequest, Hospital, InventoryUnit)
        .join(BloodRequest, Allocation.request_id == BloodRequest.id)
        .join(Hospital, BloodRequest.hospital_id == Hospital.id)
        .join(InventoryUnit, Allocation.inventory_unit_id == InventoryUnit.id)
    )
    if bank is not None:
        alloc_query = alloc_query.where(InventoryUnit.blood_bank_id == bank.id)

    results = (await db.execute(alloc_query)).all()

    orders_map = {}
    for alloc, req, hosp, unit in results:
        if req.id not in orders_map:
            orders_map[req.id] = {
                "request_id": req.id,
                "hospital_name": hosp.name,
                "hospital_address": hosp.address,
                "patient_id_token": req.patient_id_token,
                "required_blood_group": req.required_blood_group,
                "component_type": req.component_type.value,
                "units_requested": req.units_requested,
                "triage_level": req.triage_level.value,
                "calculated_urgency_score": req.calculated_urgency_score,
                "status": req.status.value,
                "created_at": req.created_at.isoformat()
                if hasattr(req.created_at, "isoformat")
                else str(req.created_at),
                "allocated_units": [],
            }
        orders_map[req.id]["allocated_units"].append(
            {
                "unit_id": unit.id,
                "batch_number": unit.batch_number,
                "blood_group": unit.blood_group,
                "unit_status": unit.status.value,
                "allocation_status": alloc.status.value,
                "allocation_id": alloc.id,
            }
        )

    return list(orders_map.values())


@router.post("/orders/{request_id}/dispatch")
async def dispatch_hospital_order(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """[USER-FACING] Blood Bank Staff confirms packing and dispatches blood packs to hospital courier."""
    blood_req = await db.get(BloodRequest, request_id)
    if blood_req is None:
        raise HTTPException(status_code=404, detail=f"Blood request {request_id} not found")

    if blood_req.status in CLOSED_REQUEST_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot dispatch against a request that is {blood_req.status.value}.",
        )

    alloc_res = await db.execute(
        select(Allocation, InventoryUnit)
        .join(InventoryUnit, Allocation.inventory_unit_id == InventoryUnit.id)
        .where(
            and_(
                Allocation.request_id == request_id,
                Allocation.source_type == AllocationSourceType.BLOOD_BANK_INVENTORY,
            )
        )
    )
    pairs = alloc_res.all()
    if not pairs:
        raise HTTPException(
            status_code=404, detail="No inventory allocations found for this request"
        )

    bank = await _owning_bank(db, current_user)
    if bank is not None:
        foreign = [unit.batch_number for _, unit in pairs if unit.blood_bank_id != bank.id]
        if foreign:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This order includes units held by another blood bank "
                    f"({', '.join(foreign)})."
                ),
            )

    batches_dispatched = []
    for alloc, unit in pairs:
        if unit.status == UnitStatus.LOCKED_RESERVE:
            unit.status = UnitStatus.DISPATCHED
            alloc.status = AllocationStatus.IN_TRANSIT
            batches_dispatched.append(unit.batch_number)

    if not batches_dispatched:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Every unit on this order has already been dispatched.",
        )

    await db.commit()

    hosp = await db.get(Hospital, blood_req.hospital_id)
    hospital_name = hosp.name if hosp else "Hospital"

    await manager.broadcast_to_hospital(
        blood_req.hospital_id,
        {
            "type": "BLOOD_BANK_DISPATCHED",
            "request_id": request_id,
            "hospital_name": hospital_name,
            "batches": batches_dispatched,
            "status": "DISPATCHED",
            "message": (
                f"Blood Bank has packed and dispatched batch(es) "
                f"{', '.join(batches_dispatched)} to {hospital_name}!"
            ),
        },
    )
    await manager.broadcast_operational(
        {
            "type": "BLOOD_BANK_DISPATCHED",
            "request_id": request_id,
            "hospital_id": blood_req.hospital_id,
            "hospital_name": hospital_name,
            "batches": batches_dispatched,
            "status": "DISPATCHED",
            "message": f"{len(batches_dispatched)} unit(s) dispatched to {hospital_name}.",
        }
    )

    return {
        "status": "DISPATCHED_TO_COURIER",
        "request_id": request_id,
        "batches": batches_dispatched,
    }
