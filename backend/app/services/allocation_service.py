from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.request import BloodRequest, RequestStatus
from app.models.allocation import Allocation, AllocationSourceType, AllocationStatus
from app.models.donor import Donor
from app.models.inventory import InventoryUnit, UnitStatus, BloodComponentType
from app.models.hospital import Hospital
from app.models.audit import AllocationAuditLog
from app.repositories.donor_repo import DonorRepository
from app.repositories.inventory_repo import InventoryRepository
from app.services.matching_service import MatchingEngineService
from app.core.redis import ConcurrencyLockManager, get_redis
from app.core.exceptions import AllocationRaceConditionError


class AllocationService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.donor_repo = DonorRepository(db)
        self.inventory_repo = InventoryRepository(db)

    async def execute_allocation_pipeline(self, request_id: str, radius_km: float = 5.0) -> Dict[str, Any]:
        """
        Execute multi-tier allocation:
        1. Check Cold-Chain Blood Bank Inventory with FEFO reservation lock.
        2. If inventory depleted, evaluate Proximity Geofence for live eligible donors.
        3. Place optimistic soft locks & broadcast to all nearby donors in parallel.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        request = await self.db.get(BloodRequest, request_id)
        if not request:
            raise ValueError(f"Request {request_id} not found")

        hospital = await self.db.get(Hospital, request.hospital_id)
        is_plasma = request.component_type == BloodComponentType.FFP
        compatible_groups = MatchingEngineService.get_compatible_donor_types(
            request.required_blood_group, is_plasma=is_plasma
        )

        # 1. Check Blood Bank Inventory First
        inventory_units = await self.inventory_repo.find_compatible_units_with_lock(
            compatible_blood_groups=compatible_groups,
            component_type=request.component_type,
            limit=request.units_requested
        )

        if inventory_units:
            unit = inventory_units[0]
            unit.status = UnitStatus.LOCKED_RESERVE
            
            allocation = Allocation(
                request_id=request.id,
                source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
                inventory_unit_id=unit.id,
                status=AllocationStatus.HARD_LOCKED,
                allocated_at=datetime.now(timezone.utc)
            )
            self.db.add(allocation)
            request.status = RequestStatus.COMMITTED_IN_TRANSIT
            
            audit = AllocationAuditLog(
                request_id=request.id,
                decision_type="INVENTORY_MATCH",
                urgency_score=request.calculated_urgency_score,
                candidate_scores_json={"matched_unit": unit.id, "expiry": str(unit.expiry_date)},
                selected_resource_id=unit.id,
                rationale_summary=f"Direct blood bank inventory reserve matched (FEFO batch: {unit.batch_number})"
            )
            self.db.add(audit)
            await self.db.commit()
            return {"strategy": "INVENTORY", "allocation_id": allocation.id, "unit_id": unit.id}

        # 2. Live Donor Proximity-Zone Broadcast
        nearby_donors = await self.donor_repo.find_eligible_donors_in_proximity(
            compatible_blood_groups=compatible_groups,
            hospital_lat=hospital.latitude,
            hospital_lng=hospital.longitude,
            radius_km=radius_km
        )

        if not nearby_donors:
            request.status = RequestStatus.RE_PLANNING
            await self.db.commit()
            return {"strategy": "NO_CANDIDATES", "radius_km": radius_km}

        # Apply soft locks across all eligible donors in proximity zone
        donor_ids = [donor.id for donor, _ in nearby_donors]
        for donor_id in donor_ids:
            await lock_mgr.acquire_soft_lock("donor", donor_id, request.id, ttl_seconds=180)

        request.status = RequestStatus.PROXIMITY_ZONE_NOTIFIED
        await self.db.commit()

        return {
            "strategy": "PROXIMITY_ZONE_BROADCAST",
            "notified_donor_count": len(nearby_donors),
            "radius_km": radius_km,
            "donor_ids": donor_ids
        }

    async def process_donor_response(self, request_id: str, donor_id: str, action: str) -> Dict[str, Any]:
        """
        Process donor response with First-Ack Hard Lock / Race-to-commit:
        - If action is ACCEPT, atomically claims the hard lock.
        - Frees all other soft locks in the zone.
        - Rejects subsequent accepts with race condition conflict.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        if action.upper() == "DECLINE":
            await lock_mgr.release_soft_locks_for_zone("donor", [donor_id])
            return {"status": "DECLINED_RECORDED"}

        # Attempt atomic hard lock upgrade
        acquired = await lock_mgr.acquire_hard_lock(request_id, donor_id)
        if not acquired:
            raise AllocationRaceConditionError(request_id)

        request = await self.db.get(BloodRequest, request_id)
        request.status = RequestStatus.COMMITTED_IN_TRANSIT

        allocation = Allocation(
            request_id=request_id,
            source_type=AllocationSourceType.LIVE_DONOR,
            donor_id=donor_id,
            status=AllocationStatus.HARD_LOCKED,
            allocated_at=datetime.now(timezone.utc)
        )
        self.db.add(allocation)

        audit = AllocationAuditLog(
            request_id=request_id,
            decision_type="FIRST_ACK_CLAIM",
            urgency_score=request.calculated_urgency_score,
            candidate_scores_json={"claimed_by_donor": donor_id},
            selected_resource_id=donor_id,
            rationale_summary=f"First-Ack Hard Lock claimed by Donor {donor_id}. Remaining zone donors dismissed."
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "status": "HARD_LOCKED_COMMITTED",
            "allocation_id": allocation.id,
            "donor_id": donor_id
        }
