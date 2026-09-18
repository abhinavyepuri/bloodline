import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    AllocationRaceConditionError,
    DomainException,
    IncompatibleBloodTypeError,
)
from app.core.redis import ConcurrencyLockManager, get_redis
from app.models.allocation import (
    COVERING_ALLOCATION_STATUSES,
    Allocation,
    AllocationSourceType,
    AllocationStatus,
)
from app.models.audit import AllocationAuditLog
from app.models.donor import Donor
from app.models.hospital import Hospital
from app.models.inventory import UnitStatus
from app.models.request import BloodRequest, RequestStatus
from app.repositories.donor_repo import DonorRepository
from app.repositories.inventory_repo import InventoryRepository
from app.services.donor_service import (
    ensure_donor_eligible,
    is_plasma_derived,
    record_donor_outcome,
)
from app.services.matching_service import MatchingEngineService
from app.services.notification_queue import NotificationQueueService
from app.websocket.connection_manager import manager

# Assumed road speed for ETA estimation, and cold-chain packing/handover allowance.
AVERAGE_TRANSIT_SPEED_KMH = 30.0
INVENTORY_PREPARATION_MINUTES = 1.0
DONOR_PREPARATION_MINUTES = 2.0

# Fallbacks when a record has no resolvable geometry.
DEFAULT_INVENTORY_DISTANCE_KM = 0.9
DEFAULT_DONOR_DISTANCE_KM = 2.1
DEFAULT_HOSPITAL_LAT = 12.9716
DEFAULT_HOSPITAL_LNG = 77.5946
KM_PER_DEGREE_LAT = 111.0


def estimate_eta_minutes(distance_km: float, preparation_minutes: float) -> float:
    """Transit time at average road speed plus a fixed preparation allowance."""
    return round(distance_km / AVERAGE_TRANSIT_SPEED_KMH * 60.0, 1) + preparation_minutes


class AllocationService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.donor_repo = DonorRepository(db)
        self.inventory_repo = InventoryRepository(db)

    # ------------------------------------------------------------- helpers
    async def _get_request(self, identifier: str) -> Optional[BloodRequest]:
        """Fetch BloodRequest by primary key UUID or short code (e.g. 'REQ-8492')."""
        clean_id = identifier.strip()
        req = await self.db.get(BloodRequest, clean_id)
        if req is not None:
            return req
        res = await self.db.execute(
            select(BloodRequest).where(func.upper(BloodRequest.code) == clean_id.upper())
        )
        return res.scalars().first()

    async def covered_unit_count(self, request_id: str) -> int:
        """Number of units currently secured for a request (inventory + donors)."""
        res = await self.db.execute(
            select(func.count(Allocation.id)).where(
                and_(
                    Allocation.request_id == request_id,
                    Allocation.status.in_(COVERING_ALLOCATION_STATUSES),
                )
            )
        )
        return int(res.scalar() or 0)

    @staticmethod
    def _compatible_groups_for(request: BloodRequest) -> List[str]:
        return MatchingEngineService.get_compatible_donor_types(
            request.required_blood_group,
            is_plasma=is_plasma_derived(request.component_type),
        )

    @staticmethod
    def _donor_distance_km(donor: Donor, hospital: Optional[Hospital]) -> float:
        """Equirectangular distance from donor to hospital, in km."""
        if donor.latitude is None or donor.longitude is None or hospital is None:
            return DEFAULT_DONOR_DISTANCE_KM

        delta_lat = donor.latitude - hospital.latitude
        # Longitude degrees shrink with latitude; correct before combining.
        delta_lng = (donor.longitude - hospital.longitude) * math.cos(
            math.radians(hospital.latitude)
        )
        distance = math.hypot(delta_lat, delta_lng) * KM_PER_DEGREE_LAT
        return round(max(0.5, distance), 2)

    async def _alert_proximity_donors(
        self,
        request: BloodRequest,
        hospital: Optional[Hospital],
        radius_km: float,
        lock_mgr: ConcurrencyLockManager,
    ) -> List[Tuple[Donor, float]]:
        """Find eligible donors in range and register them in the request's alert zone."""
        donors = await self.donor_repo.find_eligible_donors_in_proximity(
            compatible_blood_groups=self._compatible_groups_for(request),
            hospital_lat=hospital.latitude if hospital else DEFAULT_HOSPITAL_LAT,
            hospital_lng=hospital.longitude if hospital else DEFAULT_HOSPITAL_LNG,
            radius_km=radius_km,
            component_type=request.component_type,
        )
        if donors:
            await lock_mgr.register_alerted_donors(
                request.id,
                [donor.id for donor, _ in donors],
                ttl_seconds=settings.DONOR_RESPONSE_TTL_SECONDS,
            )
        return donors

    async def _alert_proximity_donors_staged(
        self,
        request: BloodRequest,
        hospital: Optional[Hospital],
        lock_mgr: ConcurrencyLockManager,
        radius_km: Optional[float] = None,
    ) -> Tuple[List[Tuple[Donor, float]], float]:
        """
        Search the default geofence first, then expand to the configured wider
        radius before giving up.
        """
        radii: List[float] = [radius_km if radius_km is not None else settings.DEFAULT_GEOFENCE_RADIUS_KM]
        expanded = settings.EXPANDED_GEOFENCE_RADIUS_KM
        if expanded > radii[0]:
            radii.append(expanded)

        for radius in radii:
            donors = await self._alert_proximity_donors(request, hospital, radius, lock_mgr)
            if donors:
                return donors, radius
        return [], radii[-1]

    # ------------------------------------------------------------ pipeline
    async def execute_allocation_pipeline(
        self,
        request_id: str,
        radius_km: Optional[float] = None,
        request: Optional[BloodRequest] = None,
        hospital: Optional[Hospital] = None,
    ) -> Dict[str, Any]:
        """
        Execute the multi-tier allocation pipeline:

        1. Reserve compatible cold-chain inventory (FEFO, nearest blood bank first).
        2. If stock falls short, alert eligible donors inside the proximity geofence.
        3. Place an alert-zone soft lock and broadcast emergency alerts in parallel.

        The request only reports ``COMMITTED_IN_TRANSIT`` once every requested unit is
        covered; a partial fill stays in the alerting state.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        if not request:
            request = await self._get_request(request_id)
        if not request:
            raise DomainException(f"Blood request '{request_id}' not found", 404)

        if not hospital and request.hospital_id:
            hospital = await self.db.get(Hospital, request.hospital_id)


        units_requested = request.units_requested
        candidate_scores: Dict[str, Any] = {}

        # 1. Cold-chain inventory first, ordered by real proximity then FEFO.
        inventory_pairs = await self.inventory_repo.find_compatible_units_with_lock(
            compatible_blood_groups=self._compatible_groups_for(request),
            component_type=request.component_type,
            limit=units_requested,
            hospital_lat=hospital.latitude if hospital else None,
            hospital_lng=hospital.longitude if hospital else None,
        )

        batches: List[str] = []
        for idx, (unit, distance) in enumerate(inventory_pairs):
            unit.status = UnitStatus.LOCKED_RESERVE
            distance_km = distance if distance is not None else DEFAULT_INVENTORY_DISTANCE_KM

            self.db.add(
                Allocation(
                    request_id=request.id,
                    source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
                    inventory_unit_id=unit.id,
                    status=AllocationStatus.HARD_LOCKED,
                    distance_km=distance_km,
                    estimated_transit_minutes=estimate_eta_minutes(
                        distance_km, INVENTORY_PREPARATION_MINUTES
                    ),
                    allocated_at=datetime.now(timezone.utc),
                )
            )
            batches.append(unit.batch_number)
            candidate_scores[unit.batch_number] = {
                "compatibility": "PASS",
                "distance_km": round(distance_km, 2),
                "proximity_score": round(
                    MatchingEngineService.compute_proximity_score(distance_km), 4
                ),
                "expiry": str(unit.expiry_date.date())
                if hasattr(unit.expiry_date, "date")
                else str(unit.expiry_date),
                "fefo_rank": idx + 1,
                "selected": True,
            }

        covered = len(batches)
        shortfall = units_requested - covered

        # 1a. Fully satisfied from inventory.
        if shortfall <= 0:
            request.status = RequestStatus.COMMITTED_IN_TRANSIT
            self.db.add(
                AllocationAuditLog(
                    request_id=request.id,
                    decision_type="INVENTORY_MATCH",
                    urgency_score=request.calculated_urgency_score,
                    candidate_scores_json=candidate_scores,
                    selected_resource_id=batches[0] if batches else "inventory-batch",
                    rationale_summary=(
                        f"{covered} {request.required_blood_group} "
                        f"{request.component_type.value} unit(s) reserved from blood bank stock. "
                        f"FEFO priority batches: {', '.join(batches)}. "
                        f"Urgency: {request.calculated_urgency_score}/100."
                    ),
                )
            )
            await self.db.commit()

            manager.dispatch(
                manager.broadcast_operational(
                    {
                        "type": "INVENTORY_LOCKED",
                        "request_id": request.id,
                        "hospital_id": hospital.id if hospital else None,
                        "units_count": covered,
                        "units_requested": units_requested,
                        "batches": batches,
                        "status": request.status.value,
                        "eta_minutes": estimate_eta_minutes(
                            candidate_scores[batches[0]]["distance_km"], INVENTORY_PREPARATION_MINUTES
                        )
                        if batches
                        else None,
                        "message": f"{covered} unit(s) reserved from blood bank storage.",
                    }
                )
            )
            manager.dispatch(
                manager.broadcast_to_hospital(
                    request.hospital_id,
                    {
                        "type": "REQUEST_UPDATED",
                        "request_id": request.id,
                        "status": request.status.value,
                        "units_covered": covered,
                        "units_requested": units_requested,
                        "calculated_urgency_score": request.calculated_urgency_score,
                    },
                )
            )


            return {
                "strategy": "INVENTORY",
                "allocated_units": covered,
                "shortfall": 0,
                "request_status": request.status.value,
            }

        # 2. Shortfall remains — alert eligible donors.
        donors, radius_used = await self._alert_proximity_donors_staged(
            request, hospital, lock_mgr, radius_km
        )
        donor_ids = [donor.id for donor, _ in donors]

        if not donors:
            # Nothing left to try in this pass. Any retained inventory stays reserved.
            request.status = RequestStatus.RE_PLANNING
            self.db.add(
                AllocationAuditLog(
                    request_id=request.id,
                    decision_type="INSUFFICIENT_RESOURCES",
                    urgency_score=request.calculated_urgency_score,
                    candidate_scores_json={
                        "inventory_reserved": batches,
                        "covered": covered,
                        "shortfall": shortfall,
                        "radius_km": radius_used,
                    },
                    selected_resource_id="zone-0-donors",
                    rationale_summary=(
                        f"Reserved {covered} unit(s) from inventory; no eligible donors "
                        f"found within {radius_used}km for the remaining {shortfall} unit(s). "
                        f"Request marked for re-planning."
                    ),
                )
            )
            await self.db.commit()

            await manager.broadcast_operational(
                {
                    "type": "RE_PLANNING_TRIGGERED",
                    "request_id": request.id,
                    "reason": "INSUFFICIENT_RESOURCES",
                    "covered": covered,
                    "shortfall": shortfall,
                    "status": request.status.value,
                    "message": (
                        f"Inventory covered {covered} of {units_requested} unit(s) and no "
                        f"eligible donors were found nearby."
                    ),
                }
            )
            await manager.broadcast_to_hospital(
                request.hospital_id,
                {
                    "type": "REQUEST_UPDATED",
                    "request_id": request.id,
                    "status": request.status.value,
                    "units_covered": covered,
                    "units_requested": units_requested,
                    "calculated_urgency_score": request.calculated_urgency_score,
                },
            )
            return {
                "strategy": "NO_CANDIDATES",
                "covered": covered,
                "shortfall": shortfall,
                "radius_km": radius_used,
            }

        # 2a. Partial inventory + donors alerted: stay in the alerting state.
        request.status = RequestStatus.PROXIMITY_ZONE_NOTIFIED

        donor_scores = {
            f"donor-{donor.id[:6]}": {
                "blood_group": donor.blood_group,
                "distance_km": round(distance, 2),
                "proximity_score": round(
                    MatchingEngineService.compute_proximity_score(distance), 2
                ),
                "reliability_score": donor.reliability_score,
            }
            for donor, distance in donors
        }
        self.db.add(
            AllocationAuditLog(
                request_id=request.id,
                decision_type="DONOR_PROXIMITY_BROADCAST",
                urgency_score=request.calculated_urgency_score,
                candidate_scores_json={
                    "inventory_reserved": batches,
                    "donors": donor_scores,
                    "covered": covered,
                    "shortfall": shortfall,
                },
                selected_resource_id=f"zone-{len(donors)}-donors",
                rationale_summary=(
                    f"Inventory secured {covered} of {units_requested} unit(s). "
                    f"Proximity broadcast initiated for the remaining {shortfall} unit(s) to "
                    f"{len(donors)} eligible donors within {radius_used}km. "
                    f"Awaiting acceptances (TTL: {settings.DONOR_RESPONSE_TTL_SECONDS}s)."
                ),
            )
        )
        await self.db.commit()

        manager.dispatch(
            manager.broadcast_to_donors(
                donor_ids,
                {
                    "type": "EMERGENCY_DISPATCH_ALERT",
                    "request_id": request.id,
                    "hospital_name": hospital.name if hospital else "Emergency Medical Center",
                    "hospital_id": hospital.id if hospital else None,
                    "required_blood_group": request.required_blood_group,
                    "component_type": request.component_type.value,
                    "urgency_score": request.calculated_urgency_score,
                    "triage_level": request.triage_level.value,
                    "units_needed": shortfall,
                    "units_requested": units_requested,
                    "units_covered": covered,
                    "ttl_seconds": settings.DONOR_RESPONSE_TTL_SECONDS,
                    "donor_ids": donor_ids,
                    "message": (
                        f"Emergency: {shortfall} bag(s) of {request.required_blood_group} blood needed "
                        f"urgently by the hospital. Please tap Accept if you can help!"
                    ),
                },
            )
        )
        manager.dispatch(
            manager.broadcast_to_hospital(
                request.hospital_id,
                {
                    "type": "REQUEST_UPDATED",
                    "request_id": request.id,
                    "status": request.status.value,
                    "units_covered": covered,
                    "units_requested": units_requested,
                    "calculated_urgency_score": request.calculated_urgency_score,
                },
            )
        )
        manager.dispatch(
            manager.broadcast_operational(
                {
                    "type": "EMERGENCY_BROADCAST_SENT",
                    "request_id": request.id,
                    "hospital_name": hospital.name if hospital else "Emergency Medical Center",
                    "units_needed": shortfall,
                    "donor_count": len(donors),
                    "radius_km": radius_used,
                    "message": (
                        f"Blood bank stock covered {covered} of {units_requested} unit(s). "
                        f"Alerting {len(donors)} nearby volunteer donors for the rest."
                    ),
                }
            )
        )


        # Schedule the 180s countdown and enqueue parallel background push notifications
        await lock_mgr.schedule_alert_timeout(request.id, timeout_seconds=settings.DONOR_RESPONSE_TTL_SECONDS)
        deadline_mins = 60
        if request.deadline_at:
            now_dt = datetime.now(timezone.utc)
            req_dl = request.deadline_at if request.deadline_at.tzinfo else request.deadline_at.replace(tzinfo=timezone.utc)
            deadline_mins = max(1, int((req_dl - now_dt).total_seconds() / 60))
        await NotificationQueueService.enqueue_donor_alert(
            donor_ids=donor_ids,
            request_id=request.id,
            request_code=request.code,
            blood_group=request.required_blood_group,
            urgency_score=request.calculated_urgency_score,
            deadline_minutes=deadline_mins,
            hospital_name=hospital.name if hospital else "Emergency Medical Center",
            distance_km_map={donor.id: round(dist, 2) for donor, dist in donors},
        )

        return {
            "strategy": "PROXIMITY_ZONE_BROADCAST",
            "covered": covered,
            "shortfall": shortfall,
            "notified_donor_count": len(donors),
            "radius_km": radius_used,
            "donor_ids": donor_ids,
        }



    # ---------------------------------------------------- donor response
    async def process_donor_response(
        self, request_id: str, donor_id: str, action: str
    ) -> Dict[str, Any]:
        """
        Process a donor's response to an emergency alert.

        Each ACCEPT atomically claims **one unit slot** on the request, so a request
        needing N units can be filled by N distinct donors. Only once every unit is
        covered is the remainder of the alert zone stood down.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        request = await self._get_request(request_id)
        if not request:
            raise DomainException(f"Blood request '{request_id}' not found", 404)
        canonical_id = request.id

        if request.status not in (
            RequestStatus.PENDING_EVALUATION,
            RequestStatus.PROXIMITY_ZONE_NOTIFIED,
            RequestStatus.RE_PLANNING,
        ):
            raise DomainException(
                f"This request is no longer accepting donor responses "
                f"(status: {request.status.value}).",
                409,
            )

        donor = await self.db.get(Donor, donor_id)
        if not donor:
            raise DomainException("Donor profile not found", 404)

        # A donor may only respond to a request they were actually alerted for. The
        # alert zone is the sole authority on that: the eligibility and compatibility
        # filters were applied when it was built, so accepting outside it would bypass
        # them. An empty zone means either the response window lapsed or the request
        # never reached the donor, and those are worth telling apart.
        alert_zone = await lock_mgr.get_alerted_donors(canonical_id)
        if donor_id not in alert_zone:
            # If the request is still open and needing units, and donor is compatible, allow claim
            if (
                request.status in (RequestStatus.PROXIMITY_ZONE_NOTIFIED, RequestStatus.RE_PLANNING)
                and request.units_covered < request.units_requested
                and donor.blood_group in self._compatible_groups_for(request)
            ):
                await lock_mgr.register_alerted_donors(canonical_id, [donor_id], ttl_seconds=180)
                alert_zone.add(donor_id)
            else:
                if await lock_mgr.alert_zone_ttl(canonical_id) is None:
                    raise DomainException(
                        "The response window for this request has closed.", 409
                    )
                raise DomainException(
                    "You were not alerted for this request, so it is not open to you.", 403
                )

        if action.upper() == "DECLINE":
            await lock_mgr.remove_alerted_donor(canonical_id, donor_id)
            record_donor_outcome(donor, success=False)
            await self.db.commit()

            await manager.broadcast_operational(
                {
                    "type": "DONOR_DECLINED",
                    "request_id": canonical_id,
                    "request_code": request.code,
                    "donor_id": donor_id,
                    "message": (
                        "A volunteer declined. Other nearby donors are still being asked."
                    ),
                }
            )
            return {"status": "DECLINED_RECORDED", "donor_id": donor_id}

        # ---- ACCEPT ----
        ensure_donor_eligible(donor, request.component_type)

        # Defence in depth. The alert zone was filtered by compatibility when it was
        # built, so this should be unreachable — but a stale or hand-written zone entry
        # must not be able to place an incompatible unit against a patient.
        if donor.blood_group not in self._compatible_groups_for(request):
            raise IncompatibleBloodTypeError(
                donor.blood_group, request.required_blood_group
            )

        # Idempotent: a donor who already holds a slot is not given a second one.
        existing_slot = await lock_mgr.donor_slot(canonical_id, donor_id, request.units_requested)
        if existing_slot is not None:
            return {
                "status": "ALREADY_CLAIMED",
                "donor_id": donor_id,
                "slot": existing_slot,
            }

        slot = await lock_mgr.claim_unit_slot(canonical_id, donor_id, request.units_requested)
        if slot is None:
            # Every unit slot is taken by other donors.
            raise AllocationRaceConditionError(canonical_id)

        try:
            hospital = await self.db.get(Hospital, request.hospital_id)
            distance_km = self._donor_distance_km(donor, hospital)
            eta_minutes = estimate_eta_minutes(distance_km, DONOR_PREPARATION_MINUTES)

            allocation = Allocation(
                request_id=canonical_id,
                source_type=AllocationSourceType.LIVE_DONOR,
                donor_id=donor_id,
                status=AllocationStatus.HARD_LOCKED,
                distance_km=distance_km,
                estimated_transit_minutes=eta_minutes,
                allocated_at=datetime.now(timezone.utc),
            )
            self.db.add(allocation)
            await self.db.flush()

            covered = await self.covered_unit_count(canonical_id)
            remaining = request.units_requested - covered
            fully_covered = remaining <= 0

            request.status = (
                RequestStatus.COMMITTED_IN_TRANSIT
                if fully_covered
                else RequestStatus.PROXIMITY_ZONE_NOTIFIED
            )

            self.db.add(
                AllocationAuditLog(
                    request_id=canonical_id,
                    decision_type="DONOR_UNIT_CLAIM",
                    urgency_score=request.calculated_urgency_score,
                    candidate_scores_json={
                        "claimed_by_donor": donor_id,
                        "slot_index": slot,
                        "distance_km": distance_km,
                        "eta_minutes": eta_minutes,
                        "units_covered": covered,
                        "units_requested": request.units_requested,
                    },
                    selected_resource_id=donor_id,
                    rationale_summary=(
                        f"Donor {donor_id[:8]}... claimed unit slot {slot + 1} of "
                        f"{request.units_requested} ({distance_km}km, ETA ~{eta_minutes}min). "
                        f"{covered}/{request.units_requested} unit(s) now covered."
                    ),
                )
            )
            await self.db.commit()
        except Exception:
            # Clean up claimed slot from Redis to prevent lock leaking on unexpected DB errors
            await lock_mgr.release_donor_slot(canonical_id, donor_id, request.units_requested)
            raise

        manager.dispatch(
            manager.broadcast_to_donors(
                [donor_id],
                {
                    "type": "DONOR_CLAIM_SUCCESS",
                    "request_id": canonical_id,
                    "request_code": request.code,
                    "donor_id": donor_id,
                    "distance_km": distance_km,
                    "eta_minutes": eta_minutes,
                    "units_covered": covered,
                    "units_requested": request.units_requested,
                    "status": request.status.value,
                    "message": (
                        "Your offer to donate is confirmed. Please head toward the hospital."
                    ),
                },
            )
        )
        manager.dispatch(
            manager.broadcast_operational(
                {
                    "type": "DONOR_CLAIM_SUCCESS",
                    "request_id": canonical_id,
                    "request_code": request.code,
                    "donor_id": donor_id,
                    "distance_km": distance_km,
                    "eta_minutes": eta_minutes,
                    "units_covered": covered,
                    "units_requested": request.units_requested,
                    "status": request.status.value,
                    "message": "Nearby volunteer donor agreed to donate.",
                }
            )
        )
        manager.dispatch(
            manager.broadcast_to_hospital(
                request.hospital_id,
                {
                    "type": "REQUEST_UPDATED",
                    "request_id": canonical_id,
                    "request_code": request.code,
                    "status": request.status.value,
                    "units_covered": covered,
                    "units_requested": request.units_requested,
                    "calculated_urgency_score": request.calculated_urgency_score,
                },
            )
        )

        if fully_covered:
            # Stand down only the donors alerted for THIS request, then drop its locks.
            stood_down = sorted(alert_zone - {donor_id})
            if stood_down:
                manager.dispatch(
                    manager.broadcast_to_donors(
                        stood_down,
                        {
                            "type": "DONOR_STAND_DOWN",
                            "request_id": canonical_id,
                            "request_code": request.code,
                            "exempt_donor_id": donor_id,
                            "message": (
                                "This emergency has enough donors now. Thank you for your readiness."
                            ),
                        },
                    )
                )
            await lock_mgr.release_request_locks(canonical_id)
        else:
            manager.dispatch(
                manager.broadcast_to_donors(
                    [donor_id],
                    {
                        "type": "UNITS_STILL_NEEDED",
                        "request_id": canonical_id,
                        "request_code": request.code,
                        "units_covered": covered,
                        "units_requested": request.units_requested,
                        "shortfall": remaining,
                        "message": (
                            f"{covered} of {request.units_requested} unit(s) covered. "
                            f"Still coordinating the remaining {remaining}."
                        ),
                    },
                )
            )


        return {
            "status": "HARD_LOCKED_COMMITTED",
            "allocation_id": allocation.id,
            "donor_id": donor_id,
            "slot": slot,
            "distance_km": distance_km,
            "estimated_transit_minutes": eta_minutes,
            "units_covered": covered,
            "units_requested": request.units_requested,
            "shortfall": max(remaining, 0),
            # The request's own status, as distinct from ``status`` above which describes
            # the outcome of this response. The donor dashboard needs to know whether the
            # request as a whole is now committed.
            "request_status": request.status.value,
        }

    # ---------------------------------------------------- re-planning
    async def replan_request(
        self, request_id: str, trigger_reason: str = "RESOURCE_UNAVAILABLE"
    ) -> Dict[str, Any]:
        """
        Dynamic re-planning after a resource state change (a unit was quarantined, a
        donor cancelled, ...). Reserves as many replacement units as are available —
        not just one — and broadcasts to donors only if a shortfall remains.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        request = await self._get_request(request_id)
        if not request:
            raise DomainException(f"Blood request '{request_id}' not found", 404)
        canonical_id = request.id

        hospital = await self.db.get(Hospital, request.hospital_id)

        retained = await self.covered_unit_count(canonical_id)
        shortfall = request.units_requested - retained

        request.status = (
            RequestStatus.COMMITTED_IN_TRANSIT if shortfall <= 0 else RequestStatus.RE_PLANNING
        )
        await self.db.commit()

        await manager.broadcast_operational(
            {
                "type": "RE_PLANNING_TRIGGERED",
                "request_id": request.id,
                "reason": trigger_reason,
                "retained_units": retained,
                "shortfall": max(shortfall, 0),
                "units_requested": request.units_requested,
                "status": request.status.value,
                "message": (
                    f"Re-planning for request {request.id[:8]}: {trigger_reason}. "
                    f"Sourcing {max(shortfall, 0)} replacement unit(s)."
                ),
            }
        )
        await manager.broadcast_to_hospital(
            request.hospital_id,
            {
                "type": "REQUEST_UPDATED",
                "request_id": request.id,
                "status": request.status.value,
                "units_covered": retained,
                "units_requested": request.units_requested,
                "calculated_urgency_score": request.calculated_urgency_score,
            },
        )

        if shortfall <= 0:
            await lock_mgr.release_request_locks(request.id)
            return {"status": "ALREADY_SATISFIED", "retained": retained}

        # 1. Reserve every available replacement unit, not just the first.
        replacement_pairs = await self.inventory_repo.find_compatible_units_with_lock(
            compatible_blood_groups=self._compatible_groups_for(request),
            component_type=request.component_type,
            limit=shortfall,
            hospital_lat=hospital.latitude if hospital else None,
            hospital_lng=hospital.longitude if hospital else None,
        )

        replaced_batches: List[str] = []
        for unit, distance in replacement_pairs:
            unit.status = UnitStatus.LOCKED_RESERVE
            distance_km = distance if distance is not None else DEFAULT_INVENTORY_DISTANCE_KM
            self.db.add(
                Allocation(
                    request_id=request.id,
                    source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
                    inventory_unit_id=unit.id,
                    status=AllocationStatus.HARD_LOCKED,
                    distance_km=distance_km,
                    estimated_transit_minutes=estimate_eta_minutes(
                        distance_km, INVENTORY_PREPARATION_MINUTES
                    ),
                    allocated_at=datetime.now(timezone.utc),
                )
            )
            replaced_batches.append(unit.batch_number)

        if replaced_batches:
            await self.db.flush()
            retained = await self.covered_unit_count(request.id)
            shortfall = request.units_requested - retained

            self.db.add(
                AllocationAuditLog(
                    request_id=request.id,
                    decision_type="RE_PLAN_INVENTORY_REPLACEMENT",
                    urgency_score=request.calculated_urgency_score,
                    candidate_scores_json={
                        "replacement_batches": replaced_batches,
                        "retained_units": retained,
                        "shortfall": max(shortfall, 0),
                    },
                    selected_resource_id=replaced_batches[0],
                    rationale_summary=(
                        f"Re-planning replaced {len(replaced_batches)} unavailable unit(s) with "
                        f"inventory batch(es) {', '.join(replaced_batches)}. "
                        f"{retained}/{request.units_requested} unit(s) now covered."
                    ),
                )
            )
            await self.db.commit()

            await manager.broadcast_operational(
                {
                    "type": "ALTERNATIVE_FOUND",
                    "request_id": request.id,
                    "source": "INVENTORY",
                    "units_replaced": len(replaced_batches),
                    "unit_batches": replaced_batches,
                    "units_covered": retained,
                    "units_requested": request.units_requested,
                    "shortfall": max(shortfall, 0),
                    "status": request.status.value,
                    "message": (
                        f"{len(replaced_batches)} replacement unit(s) secured from inventory."
                    ),
                }
            )
            await manager.broadcast_to_hospital(
                request.hospital_id,
                {
                    "type": "REQUEST_UPDATED",
                    "request_id": request.id,
                    "status": request.status.value,
                    "units_covered": retained,
                    "units_requested": request.units_requested,
                    "calculated_urgency_score": request.calculated_urgency_score,
                },
            )

            if shortfall <= 0:
                request.status = RequestStatus.COMMITTED_IN_TRANSIT
                await self.db.commit()
                await lock_mgr.release_request_locks(request.id)
                return {
                    "status": "REPLACED_FROM_INVENTORY",
                    "replaced": len(replaced_batches),
                    "retained": retained,
                }

        # 2. Still short — alert donors for what is missing.
        donors, radius_used = await self._alert_proximity_donors_staged(request, hospital, lock_mgr)
        donor_ids = [donor.id for donor, _ in donors]

        if donors:
            request.status = RequestStatus.PROXIMITY_ZONE_NOTIFIED

            self.db.add(
                AllocationAuditLog(
                    request_id=request.id,
                    decision_type="RE_PLAN_ALTERNATIVE",
                    urgency_score=request.calculated_urgency_score,
                    candidate_scores_json={
                        "shortfall": shortfall,
                        "broadcast_donor_count": len(donors),
                        "radius_km": radius_used,
                        "inventory_replaced": replaced_batches,
                    },
                    selected_resource_id=f"replan-zone-{len(donors)}",
                    rationale_summary=(
                        f"{trigger_reason}. Retained {retained} unit(s). Sourcing missing "
                        f"{shortfall} unit(s) via proximity broadcast to {len(donors)} donors "
                        f"within {radius_used}km."
                    ),
                )
            )
            await self.db.commit()

            await manager.broadcast_to_donors(
                donor_ids,
                {
                    "type": "EMERGENCY_DISPATCH_ALERT",
                    "request_id": request.id,
                    "hospital_name": hospital.name if hospital else "Emergency Medical Center",
                    "hospital_id": hospital.id if hospital else None,
                    "required_blood_group": request.required_blood_group,
                    "component_type": request.component_type.value,
                    "urgency_score": request.calculated_urgency_score,
                    "triage_level": request.triage_level.value,
                    "units_needed": shortfall,
                    "units_requested": request.units_requested,
                    "units_covered": retained,
                    "ttl_seconds": settings.DONOR_RESPONSE_TTL_SECONDS,
                    "is_replan": True,
                    "reason": trigger_reason,
                    "donor_ids": donor_ids,
                    "message": (
                        f"Urgent replacement needed: a blood bag became unavailable "
                        f"({trigger_reason}). Alerting {len(donors)} nearby volunteer donors."
                    ),
                },
            )
            await manager.broadcast_to_hospital(
                request.hospital_id,
                {
                    "type": "REQUEST_UPDATED",
                    "request_id": request.id,
                    "status": request.status.value,
                    "units_covered": retained,
                    "units_requested": request.units_requested,
                    "calculated_urgency_score": request.calculated_urgency_score,
                },
            )

            # Schedule 180s timeout and enqueue background notifications
            await lock_mgr.schedule_alert_timeout(request.id, timeout_seconds=settings.DONOR_RESPONSE_TTL_SECONDS)
            deadline_mins = 60
            if request.deadline_at:
                now_dt = datetime.now(timezone.utc)
                deadline_mins = max(1, int((request.deadline_at.replace(tzinfo=timezone.utc) if request.deadline_at.tzinfo is None else request.deadline_at - now_dt).total_seconds() / 60))
            await NotificationQueueService.enqueue_donor_alert(
                donor_ids=donor_ids,
                request_id=request.id,
                request_code=request.code,
                blood_group=request.required_blood_group,
                urgency_score=request.calculated_urgency_score,
                deadline_minutes=deadline_mins,
                hospital_name=hospital.name if hospital else "Emergency Medical Center",
                distance_km_map={donor.id: round(dist, 2) for donor, dist in donors},
            )

            return {
                "status": "DONOR_REPLAN_BROADCAST",
                "retained": retained,
                "shortfall": shortfall,
                "donor_count": len(donors),
                "radius_km": radius_used,
            }


        # 3. Nothing left to try.
        request.status = RequestStatus.RE_PLANNING
        await self.db.commit()

        await manager.broadcast_to_hospital(
            request.hospital_id,
            {
                "type": "REQUEST_UPDATED",
                "request_id": request.id,
                "status": request.status.value,
                "units_covered": retained,
                "units_requested": request.units_requested,
                "calculated_urgency_score": request.calculated_urgency_score,
            },
        )
        return {
            "status": "NO_RESOURCES_AVAILABLE",
            "retained": retained,
            "shortfall": shortfall,
        }

    # ---------------------------------------------------- cancellation & timeout
    async def cancel_donor_allocation(
        self, request_id: str, donor_id: str, reason: str = "DONOR_CANCELLED"
    ) -> Dict[str, Any]:
        """
        Process a donor cancelling their previously accepted allocation.
        Releases their hard lock slot, marks allocation as CANCELLED_BY_DONOR,
        updates donor outcome stats, and triggers dynamic re-planning.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        request = await self._get_request(request_id)
        if not request:
            raise DomainException(f"Blood request '{request_id}' not found", 404)
        canonical_id = request.id

        alloc_res = await self.db.execute(
            select(Allocation).where(
                and_(
                    Allocation.request_id == canonical_id,
                    Allocation.donor_id == donor_id,
                    Allocation.status.in_(COVERING_ALLOCATION_STATUSES),
                )
            )
        )
        allocation = alloc_res.scalars().first()
        if not allocation:
            raise DomainException(
                f"No active allocation found for donor {donor_id} on request {request_id}",
                404,
            )

        allocation.status = AllocationStatus.CANCELLED_BY_DONOR
        donor = await self.db.get(Donor, donor_id)
        if donor:
            record_donor_outcome(donor, success=False)

        await self.db.commit()

        # Release the donor's slot in Redis
        await lock_mgr.release_donor_slot(canonical_id, donor_id, request.units_requested)

        # Trigger automatic re-planning to source a replacement
        replan_res = await self.replan_request(
            request_id=canonical_id,
            trigger_reason=f"Committed donor {donor_id[:8]} cancelled: {reason}",
        )

        await manager.broadcast_operational(
            {
                "type": "DONOR_ALLOCATION_CANCELLED",
                "request_id": canonical_id,
                "request_code": request.code,
                "donor_id": donor_id,
                "reason": reason,
                "replan_status": replan_res.get("status"),
            }
        )

        return {
            "status": "DONOR_ALLOCATION_CANCELLED",
            "request_id": canonical_id,
            "request_code": request.code,
            "donor_id": donor_id,
            "replan_result": replan_res,
        }

    async def handle_allocation_timeout(self, request_id: str) -> Dict[str, Any]:
        """
        Handle expiration of donor response window. If shortfall remains, escalate
        to expanded geofence or flag request for coordinator re-planning.
        """
        redis_conn = await get_redis()
        lock_mgr = ConcurrencyLockManager(redis_conn)

        request = await self._get_request(request_id)
        if not request:
            raise DomainException(f"Blood request '{request_id}' not found", 404)
        canonical_id = request.id

        if request.status not in (
            RequestStatus.PROXIMITY_ZONE_NOTIFIED,
            RequestStatus.RE_PLANNING,
            RequestStatus.PENDING_EVALUATION,
        ):
            return {
                "status": "NOOP",
                "request_status": request.status.value,
                "message": f"Request {request_id} is in status {request.status.value}, no timeout action needed.",
            }

        covered = await self.covered_unit_count(canonical_id)
        shortfall = request.units_requested - covered

        if shortfall <= 0:
            request.status = RequestStatus.COMMITTED_IN_TRANSIT
            await self.db.commit()
            await lock_mgr.release_request_locks(canonical_id)
            return {
                "status": "ALREADY_SATISFIED",
                "covered": covered,
                "shortfall": 0,
            }

        # Expand geofence search or trigger replan
        hospital = await self.db.get(Hospital, request.hospital_id)
        donors, radius_used = await self._alert_proximity_donors_staged(
            request, hospital, lock_mgr, radius_km=settings.EXPANDED_GEOFENCE_RADIUS_KM
        )

        if donors:
            request.status = RequestStatus.PROXIMITY_ZONE_NOTIFIED
            self.db.add(
                AllocationAuditLog(
                    request_id=request.id,
                    decision_type="TIMEOUT_GEOFENCE_EXPANSION",
                    urgency_score=request.calculated_urgency_score,
                    candidate_scores_json={
                        "shortfall": shortfall,
                        "covered": covered,
                        "expanded_donor_count": len(donors),
                        "radius_km": radius_used,
                    },
                    selected_resource_id=f"timeout-expanded-{len(donors)}",
                    rationale_summary=(
                        f"Alert window lapsed with {covered}/{request.units_requested} unit(s) covered. "
                        f"Expanded geofence to {radius_used}km alerting {len(donors)} donors."
                    ),
                )
            )
            await self.db.commit()
            return {
                "status": "EXPANDED_ALERT_ZONE",
                "covered": covered,
                "shortfall": shortfall,
                "donors_alerted": len(donors),
                "radius_km": radius_used,
            }

        # Otherwise mark for operational replanning
        request.status = RequestStatus.RE_PLANNING
        await self.db.commit()

        await manager.broadcast_operational(
            {
                "type": "ALLOCATION_TIMED_OUT",
                "request_id": request_id,
                "covered": covered,
                "shortfall": shortfall,
                "status": request.status.value,
                "message": f"Alert window lapsed for request {request_id[:8]}. Shortfall: {shortfall} unit(s).",
            }
        )

        return {
            "status": "TIMEOUT_REPLANNING",
            "covered": covered,
            "shortfall": shortfall,
        }
