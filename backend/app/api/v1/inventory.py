import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_blood_bank,
    require_roles,
    resolve_role,
)
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.allocation import Allocation, AllocationSourceType, AllocationStatus
from app.models.blood_bank import BloodBank
from app.models.hospital import Hospital
from app.models.inventory import BloodComponentType, InventoryUnit, UnitStatus
from app.models.request import BloodRequest, RequestStatus
from app.models.user import User
from app.schemas.inventory import (
    InventoryBatchCreate,
    InventoryBatchItem,
    InventoryUnitCreate,
    InventoryUnitOut,
    InventoryUnitUpdateStatus,
)
from app.services.allocation_service import AllocationService
from app.websocket.connection_manager import manager

router = APIRouter()

# Default shelf lives in days per component type
DEFAULT_SHELF_LIFE_DAYS = {
    BloodComponentType.PRBC: 42,
    BloodComponentType.PLATELETS: 5,
    BloodComponentType.FFP: 365,
    BloodComponentType.CRYOPRECIPITATE: 365,
    BloodComponentType.WHOLE_BLOOD: 35,
}

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


@router.post("/batch", response_model=List[InventoryUnitOut], status_code=status.HTTP_201_CREATED)
@router.post("/units/batch", response_model=List[InventoryUnitOut], status_code=status.HTTP_201_CREATED)
async def register_inventory_batch(
    payload: Union[InventoryBatchCreate, List[InventoryBatchItem]],
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """
    [USER-FACING] Batch register multiple blood packets into blood bank inventory.
    Supports multi-item batches, quantity multipliers, and bulk generation.
    Triggers re-planning for any waiting emergency requests across all added blood groups.
    """
    bank = await _owning_bank(db, current_user)
    now_utc = datetime.now(timezone.utc)

    # Normalize payload into a list of items to generate
    items_to_process: List[InventoryBatchItem] = []
    top_blood_bank_id: Optional[str] = None
    batch_prefix: Optional[str] = None

    if isinstance(payload, list):
        items_to_process = payload
    else:
        top_blood_bank_id = payload.blood_bank_id
        batch_prefix = payload.batch_prefix
        if payload.items:
            items_to_process.extend(payload.items)
        if payload.blood_group and payload.component_type:
            items_to_process.append(
                InventoryBatchItem(
                    blood_group=payload.blood_group,
                    component_type=payload.component_type,
                    volume_ml=payload.volume_ml or 450.0,
                    quantity=payload.quantity or 1,
                    collection_date=payload.collection_date,
                    expiry_date=payload.expiry_date,
                    expiry_days=payload.expiry_days,
                    blood_bank_id=payload.blood_bank_id,
                )
            )

    if not items_to_process:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No inventory units specified in batch request.",
        )

    units_to_add: List[InventoryUnit] = []
    distinct_types_added = set()

    for item_idx, item in enumerate(items_to_process):
        # Resolve target blood bank for each item
        target_bank_id = item.blood_bank_id or top_blood_bank_id
        if bank is not None:
            effective_bank_id = bank.id
        elif target_bank_id:
            target_bank = await db.get(BloodBank, target_bank_id)
            if not target_bank:
                raise HTTPException(
                    status_code=404,
                    detail=f"Blood bank {target_bank_id} not found for item #{item_idx + 1}",
                )
            effective_bank_id = target_bank.id
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="blood_bank_id is required when registering stock as a coordinator or admin.",
            )

        # Dates calculation
        coll_date = item.collection_date or now_utc
        if item.expiry_date:
            exp_date = item.expiry_date
        else:
            days = item.expiry_days or DEFAULT_SHELF_LIFE_DAYS.get(item.component_type, 42)
            exp_date = coll_date + timedelta(days=days)

        if exp_date <= coll_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"expiry_date must be later than collection_date (item #{item_idx + 1}).",
            )

        qty = max(1, item.quantity)
        for q_idx in range(qty):
            if item.batch_number and qty == 1:
                batch_code = item.batch_number
            elif item.batch_number:
                batch_code = f"{item.batch_number}-{q_idx + 1:02d}"
            elif batch_prefix:
                batch_code = f"{batch_prefix}{uuid.uuid4().hex[:6].upper()}"
            else:
                batch_code = f"BB-{uuid.uuid4().hex[:7].upper()}"

            unit = InventoryUnit(
                blood_bank_id=effective_bank_id,
                batch_number=batch_code,
                blood_group=item.blood_group,
                component_type=item.component_type,
                volume_ml=item.volume_ml,
                collection_date=coll_date,
                expiry_date=exp_date,
                status=UnitStatus.AVAILABLE,
            )
            units_to_add.append(unit)
            distinct_types_added.add((unit.blood_group, unit.component_type))

    db.add_all(units_to_add)
    await db.commit()

    for u in units_to_add:
        await db.refresh(u)

    # Broadcast batch addition event to connected clients
    await manager.broadcast_operational(
        {
            "type": "INVENTORY_UNIT_ADDED",
            "batch_count": len(units_to_add),
            "blood_bank_id": units_to_add[0].blood_bank_id if units_to_add else None,
            "units_summary": [
                {
                    "unit_id": u.id,
                    "batch_number": u.batch_number,
                    "blood_group": u.blood_group,
                    "component_type": u.component_type.value,
                }
                for u in units_to_add
            ],
        }
    )

    # Unblock any requests waiting in RE_PLANNING matching any of the added groups
    if distinct_types_added:
        alloc_svc = AllocationService(db)
        type_filters = [
            and_(
                BloodRequest.required_blood_group == bg,
                BloodRequest.component_type == comp,
            )
            for bg, comp in distinct_types_added
        ]
        replan_requests_res = await db.execute(
            select(BloodRequest).where(
                and_(
                    BloodRequest.status == RequestStatus.RE_PLANNING,
                    or_(*type_filters),
                )
            )
        )
        for req in replan_requests_res.scalars().all():
            await alloc_svc.replan_request(
                req.id,
                trigger_reason=f"Batch inventory addition: {len(units_to_add)} packet(s) logged into stock",
            )

    return [InventoryUnitOut.model_validate(u) for u in units_to_add]


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
    """[USER-FACING] List emergency blood orders routed from hospitals across the network."""
    bank = await _owning_bank(db, current_user)

    req_query = (
        select(BloodRequest)
        .options(
            selectinload(BloodRequest.hospital),
            selectinload(BloodRequest.allocations).selectinload(Allocation.inventory_unit),
        )
        .order_by(BloodRequest.calculated_urgency_score.desc(), BloodRequest.created_at.desc())
    )
    req_results = (await db.execute(req_query)).scalars().all()

    orders_list = []
    for req in req_results:
        hosp = req.hospital
        hosp_name = hosp.name if hosp else "Emergency Medical Center"
        hosp_address = hosp.address if hosp else "Hospital Ward"

        allocated_units = []
        for alloc in (req.allocations or []):
            if alloc.inventory_unit:
                if bank and alloc.inventory_unit.blood_bank_id != bank.id:
                    continue
                allocated_units.append(
                    {
                        "unit_id": alloc.inventory_unit.id,
                        "batch_number": alloc.inventory_unit.batch_number,
                        "blood_group": alloc.inventory_unit.blood_group,
                        "unit_status": alloc.inventory_unit.status.value,
                        "allocation_status": alloc.status.value,
                        "allocation_id": alloc.id,
                    }
                )

        orders_list.append(
            {
                "request_id": req.id,
                "hospital_name": hosp_name,
                "hospital_address": hosp_address,
                "patient_id_token": req.patient_id_token,
                "required_blood_group": req.required_blood_group,
                "component_type": req.component_type.value,
                "units_requested": req.units_requested,
                "units_covered": req.units_covered,
                "triage_level": req.triage_level.value,
                "calculated_urgency_score": req.calculated_urgency_score,
                "status": req.status.value,
                "created_at": req.created_at.isoformat()
                if hasattr(req.created_at, "isoformat")
                else str(req.created_at),
                "allocated_units": allocated_units,
            }
        )

    return orders_list


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
