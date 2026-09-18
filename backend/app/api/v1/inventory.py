from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.core.database import get_db
from app.models.user import User
from app.models.blood_bank import BloodBank
from app.models.inventory import InventoryUnit, UnitStatus
from app.models.allocation import Allocation, AllocationStatus
from app.models.request import BloodRequest, RequestStatus
from app.schemas.inventory import InventoryUnitCreate, InventoryUnitUpdateStatus, InventoryUnitOut
from app.api.deps import get_current_user
from app.services.allocation_service import AllocationService
from app.websocket.connection_manager import manager

router = APIRouter()


@router.get("", response_model=List[InventoryUnitOut])
async def list_inventory(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] List on-shelf blood inventory units."""
    res = await db.execute(select(BloodBank).where(BloodBank.user_id == current_user.id))
    bank = res.scalars().first()
    if not bank:
        # Fallback: list all for coordinator/admin/hospital
        units_res = await db.execute(select(InventoryUnit).order_by(InventoryUnit.expiry_date.asc()))
        return list(units_res.scalars().all())

    units_res = await db.execute(
        select(InventoryUnit)
        .where(InventoryUnit.blood_bank_id == bank.id)
        .order_by(InventoryUnit.expiry_date.asc())
    )
    return list(units_res.scalars().all())


@router.post("/units", response_model=InventoryUnitOut, status_code=status.HTTP_201_CREATED)
async def register_inventory_unit(
    unit_in: InventoryUnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Log a new verified blood unit into blood bank stock."""
    res = await db.execute(select(BloodBank).where(BloodBank.user_id == current_user.id))
    bank = res.scalars().first()
    if not bank:
        # If coordinator/admin, link to first available blood bank
        first_bank = (await db.execute(select(BloodBank))).scalars().first()
        if not first_bank:
            raise HTTPException(status_code=400, detail="No registered blood bank found")
        bank = first_bank

    unit = InventoryUnit(
        blood_bank_id=bank.id,
        batch_number=unit_in.batch_number,
        blood_group=unit_in.blood_group,
        component_type=unit_in.component_type,
        volume_ml=unit_in.volume_ml,
        collection_date=unit_in.collection_date,
        expiry_date=unit_in.expiry_date,
        status=UnitStatus.AVAILABLE
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)

    # Broadcast unit added
    await manager.broadcast({
        "type": "INVENTORY_UNIT_ADDED",
        "unit_id": unit.id,
        "batch_number": unit.batch_number,
        "blood_group": unit.blood_group,
        "component_type": unit.component_type.value,
        "status": unit.status.value
    })

    # If any requests are currently in RE_PLANNING for this blood group, trigger re-evaluation
    replan_requests_res = await db.execute(
        select(BloodRequest).where(
            and_(
                BloodRequest.status == RequestStatus.RE_PLANNING,
                BloodRequest.required_blood_group == unit.blood_group,
                BloodRequest.component_type == unit.component_type
            )
        )
    )
    replan_requests = list(replan_requests_res.scalars().all())
    alloc_svc = AllocationService(db)
    for req in replan_requests:
        await alloc_svc.replan_request(req.id, trigger_reason=f"New inventory unit {unit.batch_number} added")

    return unit


@router.patch("/units/{id}/status", response_model=InventoryUnitOut)
async def update_unit_status(
    id: str,
    status_in: InventoryUnitUpdateStatus,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    [USER-FACING] Update status of inventory unit (e.g., mark quarantined or expired).
    Triggers automatic re-planning if unit was reserved/hard-locked for an active request!
    """
    unit = await db.get(InventoryUnit, id)
    if not unit:
        raise HTTPException(status_code=404, detail="Inventory unit not found")

    old_status = unit.status
    unit.status = status_in.status
    await db.commit()
    await db.refresh(unit)

    # Broadcast status change
    await manager.broadcast({
        "type": "INVENTORY_UNIT_STATUS_CHANGED",
        "unit_id": unit.id,
        "batch_number": unit.batch_number,
        "old_status": old_status.value,
        "new_status": unit.status.value
    })

    # If unit was quarantined or expired while in reserve, trigger re-planning!
    if (
        status_in.status in [UnitStatus.QUARANTINED, UnitStatus.EXPIRED]
        and old_status == UnitStatus.LOCKED_RESERVE
    ):
        alloc_res = await db.execute(
            select(Allocation).where(
                and_(
                    Allocation.inventory_unit_id == unit.id,
                    Allocation.status == AllocationStatus.HARD_LOCKED
                )
            )
        )
        active_allocs = list(alloc_res.scalars().all())
        
        alloc_svc = AllocationService(db)
        for alloc in active_allocs:
            alloc.status = AllocationStatus.RE_OPTIMIZED
            await db.commit()
            
            # Fire re-planning engine for the affected request!
            await alloc_svc.replan_request(
                request_id=alloc.request_id,
                trigger_reason=f"Unit {unit.batch_number} was quarantined/invalidated"
            )

    return unit
