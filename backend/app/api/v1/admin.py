from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone
from app.core.database import get_db
from app.core.permissions import RoleChecker, UserRole
from app.models.user import User
from app.models.request import BloodRequest, RequestStatus
from app.models.inventory import InventoryUnit, UnitStatus
from app.models.donor import Donor
from app.models.allocation import Allocation, AllocationStatus, AllocationSourceType
from app.models.audit import AllocationAuditLog
from app.schemas.admin import AdminOverviewOut, AdminOverrideRequest, AdminOverrideOut
from app.api.deps import get_current_user
from app.seed import seed_data
from app.websocket.connection_manager import manager

router = APIRouter()

admin_or_coordinator_guard = RoleChecker([UserRole.ADMIN, UserRole.COORDINATOR])


@router.get("/overview", response_model=AdminOverviewOut)
async def get_admin_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Fetches global network metrics, active allocations, and system health."""
    admin_or_coordinator_guard(current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role))

    # Active requests count
    req_res = await db.execute(
        select(func.count(BloodRequest.id))
        .where(BloodRequest.status.in_([RequestStatus.PENDING_EVALUATION, RequestStatus.PROXIMITY_ZONE_NOTIFIED, RequestStatus.COMMITTED_IN_TRANSIT, RequestStatus.RE_PLANNING]))
    )
    active_requests = req_res.scalar() or 0

    # Available inventory count
    inv_res = await db.execute(
        select(func.count(InventoryUnit.id))
        .where(InventoryUnit.status == UnitStatus.AVAILABLE)
    )
    available_units = inv_res.scalar() or 0

    # Active available donors count
    donor_res = await db.execute(
        select(func.count(Donor.id))
        .where(Donor.is_available == True)
    )
    active_donors = donor_res.scalar() or 0

    # Total allocations count
    alloc_res = await db.execute(select(func.count(Allocation.id)))
    alloc_count = alloc_res.scalar() or 0

    return AdminOverviewOut(
        active_requests_count=active_requests,
        available_inventory_units_count=available_units,
        active_donors_count=active_donors,
        recent_allocations_count=alloc_count,
        system_status="HEALTHY"
    )


@router.post("/allocations/{id}/override", response_model=AdminOverrideOut)
async def override_allocation(
    id: str,
    override_in: AdminOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """[USER-FACING] Manually overrides or re-routes an algorithmic match under exceptional conditions."""
    admin_or_coordinator_guard(current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role))

    blood_req = await db.get(BloodRequest, id)
    if not blood_req:
        raise HTTPException(status_code=404, detail=f"Blood request {id} not found")

    # Update or create override allocation
    allocation = None
    if override_in.donor_id:
        allocation = Allocation(
            request_id=blood_req.id,
            source_type=AllocationSourceType.LIVE_DONOR,
            donor_id=override_in.donor_id,
            status=AllocationStatus.HARD_LOCKED,
            allocated_at=datetime.now(timezone.utc)
        )
        db.add(allocation)
        blood_req.status = RequestStatus.COMMITTED_IN_TRANSIT
    elif override_in.inventory_unit_id:
        unit = await db.get(InventoryUnit, override_in.inventory_unit_id)
        if not unit:
            raise HTTPException(status_code=404, detail=f"Inventory unit {override_in.inventory_unit_id} not found")
        unit.status = UnitStatus.LOCKED_RESERVE
        allocation = Allocation(
            request_id=blood_req.id,
            source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
            inventory_unit_id=unit.id,
            status=AllocationStatus.HARD_LOCKED,
            allocated_at=datetime.now(timezone.utc)
        )
        db.add(allocation)
        blood_req.status = RequestStatus.COMMITTED_IN_TRANSIT

    audit = AllocationAuditLog(
        request_id=blood_req.id,
        decision_type="MANUAL_COORDINATOR_OVERRIDE",
        urgency_score=blood_req.calculated_urgency_score,
        candidate_scores_json={"override_by": current_user.id, "reason": override_in.reason},
        selected_resource_id=override_in.donor_id or override_in.inventory_unit_id or "NONE",
        rationale_summary=f"Manual Coordinator Override by {current_user.full_name}: {override_in.reason}"
    )
    db.add(audit)
    await db.commit()

    return AdminOverrideOut(
        status="OVERRIDE_SUCCESSFUL",
        message=f"Request {id} manually overridden by coordinator",
        request_id=id,
        allocation_id=allocation.id if allocation else None
    )


@router.post("/reset-seed")
async def reset_seed_data(db: AsyncSession = Depends(get_db)):
    """[DEMO SUPPORT] Reset database to Section 14 clean synthetic state."""
    await seed_data()
    await manager.broadcast({
        "type": "SYSTEM_RESET",
        "message": "Database reset to clean synthetic demo state (Section 14)."
    })
    return {"status": "SUCCESS", "message": "Database successfully re-seeded."}
