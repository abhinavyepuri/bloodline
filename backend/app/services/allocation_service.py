from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
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
from app.websocket.connection_manager import manager


class AllocationService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.donor_repo = DonorRepository(db)
        self.inventory_repo = InventoryRepository(db)

    async def execute_allocation_pipeline(self, request_id: str, radius_km: float = 5.0) -> Dict[str, Any]:
        """
        Execute multi-tier allocation pipeline:
        1. Query Cold-Chain Blood Bank Inventory with FEFO reservation row locks.
        2. Reserve up to units_requested compatible units.
        3. If shortfall remains, evaluate Proximity Geofence for live eligible donors.
        4. Place optimistic soft locks & broadcast to all nearby donors in parallel via WebSockets.
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

        units_requested = request.units_requested
        allocated_allocations = []

        # 1. Check Blood Bank Inventory First (FEFO)
        inventory_units = await self.inventory_repo.find_compatible_units_with_lock(
            compatible_blood_groups=compatible_groups,
            component_type=request.component_type,
            limit=units_requested
        )

        candidate_scores = {}
        for idx, unit in enumerate(inventory_units):
            unit.status = UnitStatus.LOCKED_RESERVE
            
            # Estimate transit distance (mock ~0.9km for nearby blood bank, ~2 min ETA)
            distance_km = 0.9
            eta_minutes = round(distance_km / 30.0 * 60.0, 1) + 1.0  # ~2.8 min

            allocation = Allocation(
                request_id=request.id,
                source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
                inventory_unit_id=unit.id,
                status=AllocationStatus.HARD_LOCKED,
                distance_km=distance_km,
                estimated_transit_minutes=eta_minutes,
                allocated_at=datetime.now(timezone.utc)
            )
            self.db.add(allocation)
            allocated_allocations.append(allocation)

            candidate_scores[unit.batch_number] = {
                "compatibility": "PASS",
                "proximity_score": MatchingEngineService.compute_proximity_score(distance_km),
                "expiry": str(unit.expiry_date.date()) if hasattr(unit.expiry_date, "date") else str(unit.expiry_date),
                "fefo_rank": idx + 1,
                "selected": True
            }

        # If inventory satisfied all units
        if len(allocated_allocations) >= units_requested:
            request.status = RequestStatus.COMMITTED_IN_TRANSIT
            
            audit = AllocationAuditLog(
                request_id=request.id,
                decision_type="INVENTORY_MATCH",
                urgency_score=request.calculated_urgency_score,
                candidate_scores_json=candidate_scores,
                selected_resource_id=allocated_allocations[0].inventory_unit_id or "inventory-batch",
                rationale_summary=(
                    f"{len(allocated_allocations)} {request.required_blood_group} "
                    f"{request.component_type.value} units reserved from blood bank. "
                    f"FEFO priority batches: {', '.join([u.batch_number for u in inventory_units])}. "
                    f"Urgency: {request.calculated_urgency_score}/100."
                )
            )
            self.db.add(audit)
            await self.db.commit()

            # Real-time WebSocket broadcasts
            await manager.broadcast({
                "type": "INVENTORY_LOCKED",
                "request_id": request.id,
                "hospital_id": hospital.id if hospital else None,
                "units_count": len(allocated_allocations),
                "batches": [u.batch_number for u in inventory_units],
                "status": request.status.value,
                "eta_minutes": 2.5,
                "message": f"{len(allocated_allocations)} units locked from blood bank (FEFO reserve)."
            })
            await manager.broadcast({
                "type": "REQUEST_UPDATED",
                "request_id": request.id,
                "status": request.status.value,
                "calculated_urgency_score": request.calculated_urgency_score
            })

            return {
                "strategy": "INVENTORY",
                "allocated_units": len(allocated_allocations),
                "request_status": request.status.value
            }

        # 2. Live Donor Proximity-Zone Broadcast for Remaining Units
        shortfall = units_requested - len(allocated_allocations)
        nearby_donors = await self.donor_repo.find_eligible_donors_in_proximity(
            compatible_blood_groups=compatible_groups,
            hospital_lat=hospital.latitude if hospital else 12.9716,
            hospital_lng=hospital.longitude if hospital else 77.5946,
            radius_km=radius_km
        )

        if not nearby_donors:
            if allocated_allocations:
                request.status = RequestStatus.COMMITTED_IN_TRANSIT
            else:
                request.status = RequestStatus.RE_PLANNING
            await self.db.commit()

            await manager.broadcast({
                "type": "RE_PLANNING_TRIGGERED",
                "request_id": request.id,
                "reason": "INSUFFICIENT_RESOURCES",
                "status": request.status.value,
                "message": "Insufficient inventory and no available donors in proximity zone."
            })
            return {"strategy": "NO_CANDIDATES", "radius_km": radius_km, "shortfall": shortfall}

        # Apply soft locks across all eligible donors in proximity zone
        donor_ids = [donor.id for donor, _ in nearby_donors]
        for d_id in donor_ids:
            await lock_mgr.acquire_soft_lock("donor", d_id, request.id, ttl_seconds=180)

        request.status = RequestStatus.PROXIMITY_ZONE_NOTIFIED
        
        # Audit log for proximity broadcast
        donor_scores = {
            f"donor-{d.id[:6]}": {
                "blood_group": d.blood_group,
                "distance_km": round(dist, 2),
                "proximity_score": round(MatchingEngineService.compute_proximity_score(dist), 2),
                "reliability_score": d.reliability_score
            }
            for d, dist in nearby_donors
        }
        audit = AllocationAuditLog(
            request_id=request.id,
            decision_type="DONOR_PROXIMITY_BROADCAST",
            urgency_score=request.calculated_urgency_score,
            candidate_scores_json=donor_scores,
            selected_resource_id=f"zone-{len(nearby_donors)}-donors",
            rationale_summary=(
                f"Inventory depleted. Proximity broadcast initiated for {shortfall} unit(s) "
                f"to {len(nearby_donors)} eligible donors within {radius_km}km. "
                f"Awaiting first acceptance (TTL: 180s)."
            )
        )
        self.db.add(audit)
        await self.db.commit()

        # Real-time WebSocket broadcast to donors and coordinator
        await manager.broadcast({
            "type": "EMERGENCY_DISPATCH_ALERT",
            "request_id": request.id,
            "hospital_name": hospital.name if hospital else "Emergency Medical Center",
            "hospital_id": hospital.id if hospital else None,
            "required_blood_group": request.required_blood_group,
            "component_type": request.component_type.value,
            "urgency_score": request.calculated_urgency_score,
            "triage_level": request.triage_level.value,
            "units_needed": shortfall,
            "ttl_seconds": 180,
            "donor_ids": donor_ids,
            "message": f"EMERGENCY: {shortfall} unit(s) of {request.required_blood_group} requested. Respond within 180s."
        })
        await manager.broadcast({
            "type": "REQUEST_UPDATED",
            "request_id": request.id,
            "status": request.status.value,
            "calculated_urgency_score": request.calculated_urgency_score
        })

        return {
            "strategy": "PROXIMITY_ZONE_BROADCAST",
            "notified_donor_count": len(nearby_donors),
            "radius_km": radius_km,
            "donor_ids": donor_ids,
            "shortfall": shortfall
        }

    async def process_donor_response(self, request_id: str, donor_id: str, action: str) -> Dict[str, Any]:
        """
        Process donor response with First-Ack Hard Lock / Race-to-commit:
        - If action is DECLINE: release soft lock for this donor.
        - If action is ACCEPT: atomically claims the hard lock via Redis SET NX.
        - Frees all other soft locks in the zone and notifies other donors to stand down.
        - Rejects subsequent accepts with race condition conflict.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        if action.upper() == "DECLINE":
            await lock_mgr.release_soft_locks_for_zone("donor", [donor_id])
            await manager.broadcast({
                "type": "DONOR_DECLINED",
                "request_id": request_id,
                "donor_id": donor_id
            })
            return {"status": "DECLINED_RECORDED"}

        # Attempt atomic hard lock upgrade
        acquired = await lock_mgr.acquire_hard_lock(request_id, donor_id)
        if not acquired:
            raise AllocationRaceConditionError(request_id)

        request = await self.db.get(BloodRequest, request_id)
        donor = await self.db.get(Donor, donor_id)
        hospital = await self.db.get(Hospital, request.hospital_id) if request else None

        # Mock distance / transit calculation (e.g., 2.1km, ~4 min ETA)
        distance_km = 2.1
        if donor and donor.latitude and donor.longitude and hospital:
            h_lat = hospital.latitude
            h_lng = hospital.longitude
            # Approximate Euclidean distance
            distance_km = round(((donor.latitude - h_lat)**2 + (donor.longitude - h_lng)**2)**0.5 * 111.0, 2)
            distance_km = max(0.5, distance_km)

        eta_minutes = round(distance_km / 30.0 * 60.0, 1) + 2.0  # transit + preparation

        allocation = Allocation(
            request_id=request_id,
            source_type=AllocationSourceType.LIVE_DONOR,
            donor_id=donor_id,
            status=AllocationStatus.HARD_LOCKED,
            distance_km=distance_km,
            estimated_transit_minutes=eta_minutes,
            allocated_at=datetime.now(timezone.utc)
        )
        self.db.add(allocation)

        # Transition request status to COMMITTED_IN_TRANSIT
        request.status = RequestStatus.COMMITTED_IN_TRANSIT

        audit = AllocationAuditLog(
            request_id=request_id,
            decision_type="FIRST_ACK_CLAIM",
            urgency_score=request.calculated_urgency_score,
            candidate_scores_json={
                "claimed_by_donor": donor_id,
                "distance_km": distance_km,
                "eta_minutes": eta_minutes
            },
            selected_resource_id=donor_id,
            rationale_summary=(
                f"First-Ack Hard Lock claimed by Donor ({donor_id[:8]}..., {distance_km}km, ETA ~{eta_minutes}min). "
                f"All other proximity zone donors stood down."
            )
        )
        self.db.add(audit)
        await self.db.commit()

        # Release soft locks for other donors in the zone
        res_donors = await self.db.execute(select(Donor.id).where(Donor.id != donor_id))
        other_ids = list(res_donors.scalars().all())
        await lock_mgr.release_soft_locks_for_zone("donor", other_ids)

        # Real-time WebSocket events
        await manager.broadcast({
            "type": "DONOR_CLAIM_SUCCESS",
            "request_id": request_id,
            "donor_id": donor_id,
            "distance_km": distance_km,
            "eta_minutes": eta_minutes,
            "status": "COMMITTED_IN_TRANSIT",
            "message": f"First-Ack Hard Lock claimed by Donor. Units committed in transit."
        })
        await manager.broadcast({
            "type": "DONOR_STAND_DOWN",
            "request_id": request_id,
            "exempt_donor_id": donor_id,
            "message": "Emergency request fulfilled by another responding donor. Thank you for your readiness."
        })
        await manager.broadcast({
            "type": "REQUEST_UPDATED",
            "request_id": request.id,
            "status": request.status.value,
            "calculated_urgency_score": request.calculated_urgency_score
        })

        return {
            "status": "HARD_LOCKED_COMMITTED",
            "allocation_id": allocation.id,
            "donor_id": donor_id,
            "estimated_transit_minutes": eta_minutes
        }

    async def replan_request(self, request_id: str, trigger_reason: str = "RESOURCE_UNAVAILABLE") -> Dict[str, Any]:
        """
        Dynamic Re-planning Engine:
        Evaluates remaining needs after a resource state change (e.g. unit quarantined or donor cancel).
        1. Inspects valid retained allocations (HARD_LOCKED).
        2. Calculates remaining shortfall.
        3. If shortfall > 0, attempts secondary inventory reservation or initiates donor broadcast.
        4. Emits real-time WebSocket notifications across all client dashboards.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        request = await self.db.get(BloodRequest, request_id)
        if not request:
            return {"error": f"Request {request_id} not found"}

        # Find active valid allocations
        alloc_res = await self.db.execute(
            select(Allocation)
            .where(
                and_(
                    Allocation.request_id == request_id,
                    Allocation.status == AllocationStatus.HARD_LOCKED
                )
            )
        )
        valid_allocations = list(alloc_res.scalars().all())
        retained_count = len(valid_allocations)
        shortfall = request.units_requested - retained_count

        hospital = await self.db.get(Hospital, request.hospital_id)

        # Notify that re-planning has begun
        request.status = RequestStatus.RE_PLANNING
        await self.db.commit()

        await manager.broadcast({
            "type": "RE_PLANNING_TRIGGERED",
            "request_id": request.id,
            "reason": trigger_reason,
            "retained_units": retained_count,
            "shortfall": shortfall,
            "status": "RE_PLANNING",
            "message": f"Re-planning triggered for Request {request.id[:8]}: {trigger_reason}. Sourcing {shortfall} replacement unit(s)."
        })

        if shortfall <= 0:
            request.status = RequestStatus.COMMITTED_IN_TRANSIT
            await self.db.commit()
            return {"status": "ALREADY_SATISFIED"}

        # Check biological compatibility
        is_plasma = request.component_type == BloodComponentType.FFP
        compatible_groups = MatchingEngineService.get_compatible_donor_types(
            request.required_blood_group, is_plasma=is_plasma
        )

        # Try to find another inventory unit first
        extra_inventory = await self.inventory_repo.find_compatible_units_with_lock(
            compatible_blood_groups=compatible_groups,
            component_type=request.component_type,
            limit=shortfall
        )

        if extra_inventory:
            unit = extra_inventory[0]
            unit.status = UnitStatus.LOCKED_RESERVE
            allocation = Allocation(
                request_id=request.id,
                source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
                inventory_unit_id=unit.id,
                status=AllocationStatus.HARD_LOCKED,
                distance_km=0.9,
                estimated_transit_minutes=2.5,
                allocated_at=datetime.now(timezone.utc)
            )
            self.db.add(allocation)
            request.status = RequestStatus.COMMITTED_IN_TRANSIT

            audit = AllocationAuditLog(
                request_id=request.id,
                decision_type="RE_PLAN_INVENTORY_REPLACEMENT",
                urgency_score=request.calculated_urgency_score,
                candidate_scores_json={"matched_replacement_unit": unit.batch_number},
                selected_resource_id=unit.id,
                rationale_summary=f"Re-planning replaced unavailable unit with inventory unit batch {unit.batch_number}."
            )
            self.db.add(audit)
            await self.db.commit()

            await manager.broadcast({
                "type": "ALTERNATIVE_FOUND",
                "request_id": request.id,
                "source": "INVENTORY",
                "unit_batch": unit.batch_number,
                "status": "COMMITTED_IN_TRANSIT",
                "message": f"Alternative inventory unit {unit.batch_number} secured. Request restored."
            })
            await manager.broadcast({
                "type": "REQUEST_UPDATED",
                "request_id": request.id,
                "status": request.status.value,
                "calculated_urgency_score": request.calculated_urgency_score
            })
            return {"status": "REPLACED_FROM_INVENTORY", "unit_id": unit.id}

        # Otherwise, broadcast to proximity donors for the missing units!
        nearby_donors = await self.donor_repo.find_eligible_donors_in_proximity(
            compatible_blood_groups=compatible_groups,
            hospital_lat=hospital.latitude if hospital else 12.9716,
            hospital_lng=hospital.longitude if hospital else 77.5946,
            radius_km=5.0
        )

        if nearby_donors:
            donor_ids = [donor.id for donor, _ in nearby_donors]
            for d_id in donor_ids:
                await lock_mgr.acquire_soft_lock("donor", d_id, request.id, ttl_seconds=180)

            request.status = RequestStatus.PROXIMITY_ZONE_NOTIFIED
            
            audit = AllocationAuditLog(
                request_id=request.id,
                decision_type="RE_PLAN_ALTERNATIVE",
                urgency_score=request.calculated_urgency_score,
                candidate_scores_json={"shortfall": shortfall, "broadcast_donor_count": len(nearby_donors)},
                selected_resource_id=f"replan-zone-{len(nearby_donors)}",
                rationale_summary=(
                    f"{trigger_reason}. Retained {retained_count} units. Sourcing missing {shortfall} unit(s) "
                    f"via proximity broadcast to {len(nearby_donors)} donors."
                )
            )
            self.db.add(audit)
            await self.db.commit()

            await manager.broadcast({
                "type": "EMERGENCY_DISPATCH_ALERT",
                "request_id": request.id,
                "hospital_name": hospital.name if hospital else "Emergency Medical Center",
                "hospital_id": hospital.id if hospital else None,
                "required_blood_group": request.required_blood_group,
                "component_type": request.component_type.value,
                "urgency_score": request.calculated_urgency_score,
                "triage_level": request.triage_level.value,
                "units_needed": shortfall,
                "ttl_seconds": 180,
                "is_replan": True,
                "reason": trigger_reason,
                "donor_ids": donor_ids,
                "message": f"RE-PLAN ALERT: Unit unavailable ({trigger_reason}). Replacement needed for {shortfall} unit(s)."
            })
            await manager.broadcast({
                "type": "REQUEST_UPDATED",
                "request_id": request.id,
                "status": request.status.value,
                "calculated_urgency_score": request.calculated_urgency_score
            })

            return {"status": "DONOR_REPLAN_BROADCAST", "shortfall": shortfall, "donor_count": len(nearby_donors)}

        # No resources found
        request.status = RequestStatus.RE_PLANNING
        await self.db.commit()
        await manager.broadcast({
            "type": "REQUEST_UPDATED",
            "request_id": request.id,
            "status": request.status.value,
            "calculated_urgency_score": request.calculated_urgency_score
        })
        return {"status": "NO_RESOURCES_AVAILABLE"}
