from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.user import User
from app.models.blood_bank import BloodBank
from app.models.inventory import InventoryUnit
from app.schemas.inventory import InventoryUnitCreate, InventoryUnitUpdateStatus, InventoryUnitOut
from app.api.deps import get_current_user

router = APIRouter()


@router.get("", response_model=List[InventoryUnitOut])
async def list_inventory(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] List on-shelf blood inventory units for current blood bank."""
    res = await db.execute(select(BloodBank).where(BloodBank.user_id == current_user.id))
    bank = res.scalars().first()
    if not bank:
        # Fallback: list all for coordinator/admin
        units_res = await db.execute(select(InventoryUnit).order_by(InventoryUnit.expiry_date.asc()))
        return [InventoryUnitOut.model_validate(u) for u in units_res.scalars().all()]

    units_res = await db.execute(
        select(InventoryUnit)
        .where(InventoryUnit.blood_bank_id == bank.id)
        .order_by(InventoryUnit.expiry_date.asc())
    )
    return [InventoryUnitOut.model_validate(u) for u in units_res.scalars().all()]


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
        raise HTTPException(status_code=400, detail="User is not associated with a registered blood bank")

    unit = InventoryUnit(
        blood_bank_id=bank.id,
        batch_number=unit_in.batch_number,
        blood_group=unit_in.blood_group,
        component_type=unit_in.component_type,
        volume_ml=unit_in.volume_ml,
        collection_date=unit_in.collection_date,
        expiry_date=unit_in.expiry_date
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    return InventoryUnitOut.model_validate(unit)


@router.patch("/units/{id}/status", response_model=InventoryUnitOut)
async def update_unit_status(
    id: str,
    status_in: InventoryUnitUpdateStatus,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Update status of inventory unit (e.g., mark quarantined or expired)."""
    unit = await db.get(InventoryUnit, id)
    if not unit:
        raise HTTPException(status_code=404, detail="Inventory unit not found")
    unit.status = status_in.status
    await db.commit()
    await db.refresh(unit)
    return InventoryUnitOut.model_validate(unit)

