import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Union

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
from app.models.audit import AllocationAuditLog
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
    HospitalOrderAcceptRequest,
)
from app.services.allocation_service import AllocationService
from app.services.donor_service import is_plasma_derived
from app.services.matching_service import MatchingEngineService
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

# Standard fixed volume in mL per component type
DEFAULT_VOLUME_ML_BY_COMPONENT = {
    BloodComponentType.PRBC: 350.0,
    BloodComponentType.WHOLE_BLOOD: 450.0,
    BloodComponentType.PLATELETS: 250.0,
    BloodComponentType.FFP: 250.0,
    BloodComponentType.CRYOPRECIPITATE: 20.0,
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


async def _notify_and_replan_for_new_inventory(
    db: AsyncSession,
    added_types: set,
    trigger_note: str,
) -> None:
    """
    1. For requests in RE_PLANNING matching added types, trigger replanning.
    2. For requests in PROXIMITY_ZONE_NOTIFIED (routed to donors) matching added types,
       broadcast INVENTORY_DEFICIT_COVERED to update the blood bank desk in real time.
    """
    if not added_types:
        return

    alloc_svc = AllocationService(db)
    type_filters = [
        and_(
            BloodRequest.required_blood_group == bg,
            BloodRequest.component_type == comp,
        )
        for bg, comp in added_types
    ]

    # 1. Unblock RE_PLANNING requests
    replan_query = select(BloodRequest).where(
        and_(
            BloodRequest.status == RequestStatus.RE_PLANNING,
            or_(*type_filters),
        )
    )
    replan_res = await db.execute(replan_query)
    for req in replan_res.scalars().all():
        await alloc_svc.replan_request(
            req.id,
            trigger_reason=trigger_note,
        )

    # 2. Notify blood bank desk of donor-routed requests that now have stock available
    donor_routed_query = (
        select(BloodRequest)
        .options(selectinload(BloodRequest.hospital))
        .where(
            and_(
                BloodRequest.status == RequestStatus.PROXIMITY_ZONE_NOTIFIED,
                or_(*type_filters),
            )
        )
    )
    donor_res = await db.execute(donor_routed_query)
    for req in donor_res.scalars().all():
        hosp_name = req.hospital.name if req.hospital else "Emergency Medical Center"
        covered = await alloc_svc.covered_unit_count(req.id)
        shortfall = max(0, req.units_requested - covered)
        await manager.broadcast_operational(
            {
                "type": "INVENTORY_DEFICIT_COVERED",
                "request_id": req.id,
                "request_code": req.code or f"REQ-{req.id[:6].upper()}",
                "hospital_name": hosp_name,
                "blood_group": req.required_blood_group,
                "component_type": req.component_type.value,
                "units_covered": covered,
                "units_requested": req.units_requested,
                "shortfall": shortfall,
                "status": req.status.value,
                "message": (
                    f"⚡ Stock Updated: Newly added units in storage match Request {req.code or req.id[:6]} "
                    f"for {hosp_name} ({req.required_blood_group}) previously routed to donors."
                ),
            }
        )


@router.post("/units", response_model=InventoryUnitOut, status_code=status.HTTP_201_CREATED)
async def register_inventory_unit(
    unit_in: InventoryUnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """[USER-FACING] Log a new verified blood unit into blood bank stock."""
    bank = await _owning_bank(db, current_user)
    if bank is None:
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

    qty = max(1, min(100, unit_in.quantity))
    created_units: List[InventoryUnit] = []

    for i in range(1, qty + 1):
        if qty == 1:
            batch_no = unit_in.batch_number
        else:
            batch_no = f"{unit_in.batch_number}-{i:02d}"

        existing = await db.scalar(select(InventoryUnit.id).where(InventoryUnit.batch_number == batch_no))
        if existing:
            batch_no = f"{batch_no}-{uuid.uuid4().hex[:4].upper()}"

        unit = InventoryUnit(
            blood_bank_id=bank.id,
            batch_number=batch_no,
            blood_group=unit_in.blood_group,
            component_type=unit_in.component_type,
            volume_ml=unit_in.volume_ml,
            collection_date=unit_in.collection_date,
            expiry_date=unit_in.expiry_date,
            status=UnitStatus.AVAILABLE,
        )
        db.add(unit)
        created_units.append(unit)

    await db.commit()

    for u in created_units:
        await db.refresh(u)
        await manager.broadcast_operational(
            {
                "type": "INVENTORY_UNIT_ADDED",
                "unit_id": u.id,
                "blood_bank_id": u.blood_bank_id,
                "batch_number": u.batch_number,
                "blood_group": u.blood_group,
                "component_type": u.component_type.value,
                "status": u.status.value,
            }
        )

    # Automatically check and unblock/notify for active requests
    distinct_types = {(u.blood_group, u.component_type) for u in created_units}
    await _notify_and_replan_for_new_inventory(
        db=db,
        added_types=distinct_types,
        trigger_note=f"Inventory intake: {len(created_units)} packet(s) logged into stock",
    )

    return InventoryUnitOut.model_validate(created_units[0])


@router.post("/units/batch", response_model=List[InventoryUnitOut], status_code=status.HTTP_201_CREATED)
async def register_inventory_units_batch(
    unit_in: InventoryUnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """[USER-FACING] Register a batch of blood packets into blood bank stock and return all created units."""
    bank = await _owning_bank(db, current_user)
    if bank is None:
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

    qty = max(1, min(100, unit_in.quantity))
    created_units: List[InventoryUnit] = []

    for i in range(1, qty + 1):
        if qty == 1:
            batch_no = unit_in.batch_number
        else:
            batch_no = f"{unit_in.batch_number}-{i:02d}"

        existing = await db.scalar(select(InventoryUnit.id).where(InventoryUnit.batch_number == batch_no))
        if existing:
            batch_no = f"{batch_no}-{uuid.uuid4().hex[:4].upper()}"

        unit = InventoryUnit(
            blood_bank_id=bank.id,
            batch_number=batch_no,
            blood_group=unit_in.blood_group,
            component_type=unit_in.component_type,
            volume_ml=unit_in.volume_ml,
            collection_date=unit_in.collection_date,
            expiry_date=unit_in.expiry_date,
            status=UnitStatus.AVAILABLE,
        )
        db.add(unit)
        created_units.append(unit)

    await db.commit()

    for u in created_units:
        await db.refresh(u)
        await manager.broadcast_operational(
            {
                "type": "INVENTORY_UNIT_ADDED",
                "unit_id": u.id,
                "blood_bank_id": u.blood_bank_id,
                "batch_number": u.batch_number,
                "blood_group": u.blood_group,
                "component_type": u.component_type.value,
                "status": u.status.value,
            }
        )

    # Automatically check and unblock/notify for active requests
    distinct_types = {(u.blood_group, u.component_type) for u in created_units}
    await _notify_and_replan_for_new_inventory(
        db=db,
        added_types=distinct_types,
        trigger_note=f"Batch inventory intake: {len(created_units)} packet(s) logged into stock",
    )

    return [InventoryUnitOut.model_validate(u) for u in created_units]


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

            default_vol = DEFAULT_VOLUME_ML_BY_COMPONENT.get(item.component_type, 350.0)
            vol = item.volume_ml if item.volume_ml and item.volume_ml > 0 else default_vol

            unit = InventoryUnit(
                blood_bank_id=effective_bank_id,
                batch_number=batch_code,
                blood_group=item.blood_group,
                component_type=item.component_type,
                volume_ml=vol,
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

    # Unblock / re-plan any requests waiting in RE_PLANNING or notify for donor-routed requests
    if distinct_types_added:
        await _notify_and_replan_for_new_inventory(
            db=db,
            added_types=distinct_types_added,
            trigger_note=f"Batch inventory addition: {len(units_to_add)} packet(s) logged into stock",
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

    # If unit status changed to AVAILABLE, check if any active requests can be unblocked/notified
    if status_in.status == UnitStatus.AVAILABLE and old_status != UnitStatus.AVAILABLE:
        await _notify_and_replan_for_new_inventory(
            db=db,
            added_types={(unit.blood_group, unit.component_type)},
            trigger_note=f"Unit {unit.batch_number} marked available in stock",
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
            selectinload(BloodRequest.allocations).selectinload(Allocation.donor),
        )
        .order_by(BloodRequest.created_at.desc(), BloodRequest.calculated_urgency_score.desc())
    )
    req_results = (await db.execute(req_query)).scalars().all()

    now = datetime.now(timezone.utc)

    # ── Batch-load compatible available units ──────────────────────────────────
    # Collect every (blood_group, component_type) combination we'll need across
    # all open requests that still have a shortfall. One single DB query replaces
    # the previous per-request loop that caused N+1 queries.
    open_requests_needing_units = [
        req for req in req_results
        if req.status not in CLOSED_REQUEST_STATUSES
    ]

    needed_combos: set[tuple[str, object]] = set()
    for req in open_requests_needing_units:
        covered = sum(
            1 for a in (req.allocations or [])
            if a.status in (AllocationStatus.HARD_LOCKED, AllocationStatus.IN_TRANSIT)
        )
        if req.units_requested - covered > 0:
            compat_groups = MatchingEngineService.get_compatible_donor_types(
                req.required_blood_group, is_plasma=is_plasma_derived(req.component_type)
            )
            for bg in compat_groups:
                needed_combos.add((bg, req.component_type))

    # Single batched query for ALL needed (blood_group, component_type) pairs
    available_units_by_key: dict[tuple[str, str], list[InventoryUnit]] = {}
    if needed_combos:
        combo_filters = [
            and_(
                InventoryUnit.blood_group == bg,
                InventoryUnit.component_type == ct,
            )
            for bg, ct in needed_combos
        ]
        avail_q = (
            select(InventoryUnit)
            .where(
                and_(
                    or_(*combo_filters),
                    InventoryUnit.status == UnitStatus.AVAILABLE,
                    InventoryUnit.expiry_date > now,
                    *([InventoryUnit.blood_bank_id == bank.id] if bank else []),
                )
            )
            .order_by(InventoryUnit.expiry_date.asc())
        )
        all_avail = (await db.execute(avail_q)).scalars().all()
        for u in all_avail:
            key = (u.blood_group, u.component_type.value if hasattr(u.component_type, 'value') else str(u.component_type))
            available_units_by_key.setdefault(key, []).append(u)
    # ──────────────────────────────────────────────────────────────────────────

    orders_list = []
    for req in req_results:
        hosp = req.hospital
        hosp_name = hosp.name if hosp else "Emergency Medical Center"
        hosp_address = hosp.address if hosp else "Hospital Ward"

        allocated_units = []
        volunteer_donors = []
        # Sort allocations in chronological order of when they were issued (newest first)
        sorted_allocs = sorted(
            req.allocations or [],
            key=lambda a: a.created_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        for alloc in sorted_allocs:
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
            elif alloc.source_type == AllocationSourceType.LIVE_DONOR or alloc.donor_id or alloc.donor:
                donor_id = alloc.donor.id if alloc.donor else (alloc.donor_id or f"donor-{alloc.id[:6]}")
                donor_bg = alloc.donor.blood_group if alloc.donor else (alloc.blood_group or req.required_blood_group)
                volunteer_donors.append(
                    {
                        "donor_id": donor_id,
                        "blood_group": donor_bg,
                        "allocation_status": alloc.status.value,
                        "allocation_id": alloc.id,
                        "distance_km": alloc.distance_km,
                        "estimated_transit_minutes": alloc.estimated_transit_minutes,
                    }
                )

        # Omit historical closed requests that did not involve this blood bank
        if req.status in CLOSED_REQUEST_STATUSES and not allocated_units:
            continue

        covered_count = sum(
            1
            for a in (req.allocations or [])
            if a.status in (AllocationStatus.HARD_LOCKED, AllocationStatus.IN_TRANSIT)
        )
        shortfall = max(0, req.units_requested - covered_count)

        # Look up pre-fetched compatible units from the batch map — zero extra DB calls
        compatible_available_units = []
        if req.status not in CLOSED_REQUEST_STATUSES and shortfall > 0:
            compat_groups = MatchingEngineService.get_compatible_donor_types(
                req.required_blood_group, is_plasma=is_plasma_derived(req.component_type)
            )
            comp_type_val = req.component_type.value if hasattr(req.component_type, 'value') else str(req.component_type)
            for bg in compat_groups:
                for u in available_units_by_key.get((bg, comp_type_val), []):
                    compatible_available_units.append(
                        {
                            "unit_id": u.id,
                            "batch_number": u.batch_number,
                            "blood_group": u.blood_group,
                            "expiry_date": u.expiry_date.isoformat(),
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
                "units_covered": covered_count,
                "units_shortfall": shortfall,
                "triage_level": req.triage_level.value,
                "calculated_urgency_score": req.calculated_urgency_score,
                "status": req.status.value,
                "created_at": req.created_at.isoformat()
                if hasattr(req.created_at, "isoformat")
                else str(req.created_at),
                "allocated_units": allocated_units,
                "volunteer_donors": volunteer_donors,
                "available_compatible_units": compatible_available_units,
            }
        )

    return orders_list



@router.post("/orders/{request_id}/accept")
async def accept_hospital_order(
    request_id: str,
    accept_in: Optional[HospitalOrderAcceptRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = StockUser,
):
    """
    [USER-FACING] Blood Bank Staff explicitly accepts an incoming hospital request,
    reserving available packets from storage and optionally dispatching them immediately.
    """
    blood_req = await db.get(BloodRequest, request_id)
    if blood_req is None:
        raise HTTPException(status_code=404, detail=f"Blood request {request_id} not found")

    if blood_req.status in CLOSED_REQUEST_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot accept a request that is already {blood_req.status.value}.",
        )

    bank = await _owning_bank(db, current_user)
    auto_dispatch = accept_in.auto_dispatch if accept_in else False
    requested_unit_ids = accept_in.unit_ids if (accept_in and accept_in.unit_ids) else None

    compatible_groups = MatchingEngineService.get_compatible_donor_types(
        blood_req.required_blood_group, is_plasma=is_plasma_derived(blood_req.component_type)
    )
    now = datetime.now(timezone.utc)
    units_to_allocate: List[InventoryUnit] = []

    # Check existing inventory allocations for this request from this bank
    existing_allocs_res = await db.execute(
        select(Allocation, InventoryUnit)
        .join(InventoryUnit, Allocation.inventory_unit_id == InventoryUnit.id)
        .where(
            and_(
                Allocation.request_id == request_id,
                Allocation.source_type == AllocationSourceType.BLOOD_BANK_INVENTORY,
                *( [InventoryUnit.blood_bank_id == bank.id] if bank else [] )
            )
        )
    )
    existing_pairs = existing_allocs_res.all()

    alloc_svc = AllocationService(db)
    current_covered = await alloc_svc.covered_unit_count(blood_req.id)
    shortfall = max(0, blood_req.units_requested - current_covered)

    # If already covered and no specific units requested, confirm or dispatch
    if not requested_unit_ids and shortfall <= 0 and existing_pairs:
        if auto_dispatch:
            return await dispatch_hospital_order(request_id=request_id, db=db, current_user=current_user)
        return {
            "status": "ACCEPTED",
            "request_id": blood_req.id,
            "batches": [u.batch_number for _, u in existing_pairs],
            "units_covered": current_covered,
            "request_status": blood_req.status.value,
        }

    if requested_unit_ids:
        for uid in requested_unit_ids:
            unit = await db.get(InventoryUnit, uid)
            if not unit:
                raise HTTPException(status_code=404, detail=f"Inventory unit {uid} not found")
            if bank and unit.blood_bank_id != bank.id:
                raise HTTPException(status_code=403, detail=f"Unit {unit.batch_number} belongs to another blood bank")
            if unit.status != UnitStatus.AVAILABLE:
                raise HTTPException(status_code=400, detail=f"Unit {unit.batch_number} is not AVAILABLE (status: {unit.status.value})")
            if unit.expiry_date <= now:
                raise HTTPException(status_code=400, detail=f"Unit {unit.batch_number} has expired")
            if unit.blood_group not in compatible_groups or unit.component_type != blood_req.component_type:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unit {unit.batch_number} ({unit.blood_group} {unit.component_type.value}) is not compatible with request ({blood_req.required_blood_group} {blood_req.component_type.value})"
                )
            units_to_allocate.append(unit)
    else:
        needed = max(1, shortfall)
        q = (
            select(InventoryUnit)
            .where(
                and_(
                    InventoryUnit.blood_group.in_(compatible_groups),
                    InventoryUnit.component_type == blood_req.component_type,
                    InventoryUnit.status == UnitStatus.AVAILABLE,
                    InventoryUnit.expiry_date > now,
                    *( [InventoryUnit.blood_bank_id == bank.id] if bank else [] )
                )
            )
            .order_by(InventoryUnit.expiry_date.asc())
            .limit(needed)
            .with_for_update(skip_locked=True)
        )
        res = await db.execute(q)
        units_to_allocate = list(res.scalars().all())
        if not units_to_allocate and not existing_pairs:
            raise HTTPException(
                status_code=400,
                detail=f"No compatible available packets in storage for {blood_req.required_blood_group} ({blood_req.component_type.value}).",
            )

    batches = []
    # If auto-dispatching, also dispatch any units already reserved in storage for this order
    if auto_dispatch and existing_pairs:
        for alloc, unit in existing_pairs:
            if unit.status == UnitStatus.LOCKED_RESERVE:
                unit.status = UnitStatus.DISPATCHED
                alloc.status = AllocationStatus.IN_TRANSIT
                batches.append(unit.batch_number)

    for unit in units_to_allocate:
        unit.status = UnitStatus.DISPATCHED if auto_dispatch else UnitStatus.LOCKED_RESERVE
        alloc = Allocation(
            request_id=blood_req.id,
            source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
            inventory_unit_id=unit.id,
            status=AllocationStatus.IN_TRANSIT if auto_dispatch else AllocationStatus.HARD_LOCKED,
            distance_km=0.5,
            allocated_at=now,
        )
        db.add(alloc)
        batches.append(unit.batch_number)

    await db.flush()

    alloc_svc = AllocationService(db)
    covered = await alloc_svc.covered_unit_count(blood_req.id)
    if covered >= blood_req.units_requested:
        blood_req.status = RequestStatus.COMMITTED_IN_TRANSIT

    db.add(
        AllocationAuditLog(
            request_id=blood_req.id,
            decision_type="BLOOD_BANK_ACCEPTED",
            urgency_score=blood_req.calculated_urgency_score,
            candidate_scores_json={"batches": batches, "auto_dispatch": auto_dispatch},
            selected_resource_id=", ".join(batches),
            rationale_summary=(
                f"Blood bank staff accepted request and {'dispatched' if auto_dispatch else 'reserved'} "
                f"{len(batches)} packet(s) ({', '.join(batches)}). Total covered: {covered}/{blood_req.units_requested}."
            ),
        )
    )
    await db.commit()
    await db.refresh(blood_req)

    hosp = await db.get(Hospital, blood_req.hospital_id)
    hospital_name = hosp.name if hosp else "Hospital"

    event_type = "BLOOD_BANK_DISPATCHED" if auto_dispatch else "INVENTORY_LOCKED"
    event_msg = (
        f"Blood bank has packed and dispatched batch(es) {', '.join(batches)} to {hospital_name}!"
        if auto_dispatch
        else f"Blood bank accepted request and reserved {len(batches)} unit(s) ({', '.join(batches)})."
    )

    manager.dispatch(
        manager.broadcast_operational(
            {
                "type": event_type,
                "request_id": blood_req.id,
                "hospital_id": blood_req.hospital_id,
                "hospital_name": hospital_name,
                "batches": batches,
                "status": blood_req.status.value,
                "units_covered": covered,
                "message": event_msg,
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
                "units_covered": covered,
                "units_requested": blood_req.units_requested,
                "message": event_msg,
            }
        )
    )

    return {
        "status": "DISPATCHED" if auto_dispatch else "ACCEPTED",
        "request_id": blood_req.id,
        "batches": batches,
        "units_covered": covered,
        "request_status": blood_req.status.value,
    }


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
    bank = await _owning_bank(db, current_user)

    if not pairs:
        # Check if this bank has available compatible units to auto-allocate and dispatch immediately
        compatible_groups = MatchingEngineService.get_compatible_donor_types(
            blood_req.required_blood_group, is_plasma=is_plasma_derived(blood_req.component_type)
        )
        now = datetime.now(timezone.utc)
        alloc_svc = AllocationService(db)
        current_covered = await alloc_svc.covered_unit_count(blood_req.id)
        shortfall = max(0, blood_req.units_requested - current_covered)
        needed = max(1, shortfall)
        q = (
            select(InventoryUnit)
            .where(
                and_(
                    InventoryUnit.blood_group.in_(compatible_groups),
                    InventoryUnit.component_type == blood_req.component_type,
                    InventoryUnit.status == UnitStatus.AVAILABLE,
                    InventoryUnit.expiry_date > now,
                    *( [InventoryUnit.blood_bank_id == bank.id] if bank else [] )
                )
            )
            .order_by(InventoryUnit.expiry_date.asc())
            .limit(needed)
            .with_for_update(skip_locked=True)
        )
        avail_res = await db.execute(q)
        auto_units = list(avail_res.scalars().all())
        if auto_units:
            batches_dispatched = []
            for unit in auto_units:
                unit.status = UnitStatus.DISPATCHED
                alloc = Allocation(
                    request_id=blood_req.id,
                    source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
                    inventory_unit_id=unit.id,
                    status=AllocationStatus.IN_TRANSIT,
                    distance_km=0.5,
                    allocated_at=now,
                )
                db.add(alloc)
                batches_dispatched.append(unit.batch_number)
            await db.flush()
            covered = await alloc_svc.covered_unit_count(blood_req.id)
            if covered >= blood_req.units_requested:
                blood_req.status = RequestStatus.COMMITTED_IN_TRANSIT
            await db.commit()
            await db.refresh(blood_req)
            hosp = await db.get(Hospital, blood_req.hospital_id)
            hospital_name = hosp.name if hosp else "Hospital"
            manager.dispatch(
                manager.broadcast_to_hospital(
                    blood_req.hospital_id,
                    {
                        "type": "BLOOD_BANK_DISPATCHED",
                        "request_id": request_id,
                        "hospital_name": hospital_name,
                        "batches": batches_dispatched,
                        "status": "DISPATCHED",
                        "message": f"Blood Bank has packed and dispatched batch(es) {', '.join(batches_dispatched)} to {hospital_name}!",
                    }
                )
            )
            manager.dispatch(
                manager.broadcast_operational(
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
            )
            return {
                "status": "DISPATCHED_TO_COURIER",
                "request_id": request_id,
                "batches": batches_dispatched,
            }
        raise HTTPException(
            status_code=404, detail="No inventory allocations or compatible available units found for this request"
        )

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

    alloc_svc = AllocationService(db)
    covered = await alloc_svc.covered_unit_count(blood_req.id)
    if covered >= blood_req.units_requested:
        blood_req.status = RequestStatus.COMMITTED_IN_TRANSIT

    await db.commit()
    await db.refresh(blood_req)

    hosp = await db.get(Hospital, blood_req.hospital_id)
    hospital_name = hosp.name if hosp else "Hospital"

    manager.dispatch(
        manager.broadcast_to_hospital(
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
    )
    manager.dispatch(
        manager.broadcast_to_hospital(
            blood_req.hospital_id,
            {
                "type": "REQUEST_UPDATED",
                "request_id": blood_req.id,
                "status": blood_req.status.value,
                "units_covered": covered,
                "units_requested": blood_req.units_requested,
                "batches": batches_dispatched,
            },
        )
    )
    manager.dispatch(
        manager.broadcast_operational(
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
    )

    return {
        "status": "DISPATCHED_TO_COURIER",
        "request_id": request_id,
        "batches": batches_dispatched,
    }
