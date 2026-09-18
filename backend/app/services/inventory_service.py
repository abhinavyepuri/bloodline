"""
Inventory lifecycle maintenance.

Nothing in the system ever set ``UnitStatus.EXPIRED``, so outdated stock stayed
``AVAILABLE``: invisible to the compatibility filter (which checks ``expiry_date``)
but still rendered as "Ready" on the blood bank dashboard, and still counted in the
admin overview's available-units metric.
"""
import logging
from datetime import datetime, timezone
from typing import Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import InventoryUnit, UnitStatus

logger = logging.getLogger("smartblood.inventory")


async def expire_stale_units(db: AsyncSession, commit: bool = True) -> List[str]:
    """
    Flip every AVAILABLE or LOCKED_RESERVE unit past its expiry date to EXPIRED.

    Reserved units are included because a unit cannot be issued after its expiry: if
    one expires while held for a request, the allocation service must be told so it
    can re-plan. Returns the batch numbers that were expired.

    Only units still on the shelf are touched — a DISPATCHED or TRANSFUSED unit has
    left the blood bank and its status is a record of what happened.
    """
    now = datetime.now(timezone.utc)

    res = await db.execute(
        select(InventoryUnit).where(
            InventoryUnit.expiry_date <= now,
            InventoryUnit.status.in_((UnitStatus.AVAILABLE, UnitStatus.LOCKED_RESERVE)),
        )
    )
    stale = list(res.scalars().all())
    if not stale:
        return []

    batches = [unit.batch_number for unit in stale]
    for unit in stale:
        unit.status = UnitStatus.EXPIRED

    if commit:
        await db.commit()

    logger.info("Expired %d stale inventory unit(s): %s", len(batches), ", ".join(batches))
    return batches


async def _replan_requests_holding_expired_units(db: AsyncSession) -> int:
    """
    Re-plan any request relying on a unit that just expired.

    Without this the request keeps counting the dead unit as covered and the hospital
    is told it has blood it will never receive.
    """
    from app.models.allocation import Allocation, AllocationStatus
    from app.services.allocation_service import AllocationService

    res = await db.execute(
        select(Allocation).where(
            Allocation.status == AllocationStatus.HARD_LOCKED,
            Allocation.inventory_unit_id.isnot(None),
        )
    )
    allocations = list(res.scalars().all())

    affected: Dict[str, None] = {}
    for allocation in allocations:
        unit = await db.get(InventoryUnit, allocation.inventory_unit_id)
        if unit is not None and unit.status == UnitStatus.EXPIRED:
            allocation.status = AllocationStatus.RE_OPTIMIZED
            affected[allocation.request_id] = None

    if not affected:
        return 0

    await db.commit()

    svc = AllocationService(db)
    for request_id in affected:
        await svc.replan_request(
            request_id, trigger_reason="Reserved unit reached its expiry date"
        )
    return len(affected)


async def check_near_expiry_units(db: AsyncSession, hours_threshold: int = 24) -> int:
    """Find units expiring within `hours_threshold` hours and alert staff dashboards."""
    from datetime import timedelta
    from app.websocket.connection_manager import manager

    now = datetime.now(timezone.utc)
    threshold = now + timedelta(hours=hours_threshold)
    res = await db.execute(
        select(InventoryUnit).where(
            InventoryUnit.expiry_date > now,
            InventoryUnit.expiry_date <= threshold,
            InventoryUnit.status == UnitStatus.AVAILABLE,
        )
    )
    near_expiry = list(res.scalars().all())
    if near_expiry:
        await manager.broadcast_operational(
            {
                "type": "NEAR_EXPIRY_WARNING",
                "count": len(near_expiry),
                "batches": [u.batch_number for u in near_expiry[:5]],
                "message": (
                    f"{len(near_expiry)} unit(s) expiring within {hours_threshold}h. "
                    "FEFO priority elevated."
                ),
            }
        )
    return len(near_expiry)


async def run_lifecycle_sweep() -> Dict[str, int]:
    """
    Expiry sweep on its own session, for the background task in the application
    lifespan. Never raises: a maintenance task must not take the app down.
    """
    from app.core.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            batches = await expire_stale_units(db)
            replanned = await _replan_requests_holding_expired_units(db) if batches else 0
            near_expiry = await check_near_expiry_units(db, hours_threshold=24)
            return {
                "expired_units": len(batches),
                "requests_replanned": replanned,
                "near_expiry_units": near_expiry,
            }
    except Exception:
        logger.exception("Inventory lifecycle sweep failed")
        return {"expired_units": 0, "requests_replanned": 0, "near_expiry_units": 0}

