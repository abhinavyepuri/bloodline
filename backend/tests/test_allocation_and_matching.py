import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select

from app.models.hospital import Hospital
from app.models.request import TriageLevel, BloodRequest, RequestStatus
from app.models.inventory import BloodComponentType
from app.services.matching_service import MatchingEngineService
from app.services.allocation_service import AllocationService


def test_rbc_compatibility_matrix():
    # O- can only receive from O-
    assert MatchingEngineService.get_compatible_donor_types("O-", is_plasma=False) == ["O-"]
    # AB+ can receive from all 8 blood groups
    ab_pos = MatchingEngineService.get_compatible_donor_types("AB+", is_plasma=False)
    assert len(ab_pos) == 8
    assert "O-" in ab_pos and "AB+" in ab_pos
    # A+ can receive from O-, O+, A-, A+
    a_pos = MatchingEngineService.get_compatible_donor_types("A+", is_plasma=False)
    assert set(a_pos) == {"O-", "O+", "A-", "A+"}


def test_plasma_compatibility_matrix():
    # In plasma, AB is universal donor, O is universal recipient
    o_neg = MatchingEngineService.get_compatible_donor_types("O-", is_plasma=True)
    assert len(o_neg) == 8  # O- can receive plasma from any group
    ab_pos = MatchingEngineService.get_compatible_donor_types("AB+", is_plasma=True)
    assert ab_pos == ["AB+"]  # AB+ can only receive AB+ plasma


def test_urgency_scoring():
    now = datetime.now(timezone.utc)
    # Immediate MTP (< 15 min remaining) -> 95 + 20 = 115 capped at 100
    deadline_10m = now + timedelta(minutes=10)
    score_mtp = MatchingEngineService.calculate_urgency_score(TriageLevel.MASSIVE_TRANSFUSION_PROTOCOL, deadline_10m)
    assert score_mtp == 100.0

    # Routine clinical (> 4 hours) -> base 20 + 0 = 20
    deadline_5h = now + timedelta(hours=5)
    score_routine = MatchingEngineService.calculate_urgency_score(TriageLevel.ROUTINE_CLINICAL, deadline_5h)
    assert score_routine == 20.0


def test_proximity_score():
    # Distance 0km -> 1.0
    assert MatchingEngineService.compute_proximity_score(0.0) == 1.0
    # Distance 15km (max) -> 0.0
    assert MatchingEngineService.compute_proximity_score(15.0) == 0.0
    # Distance 7.5km -> 0.5
    assert MatchingEngineService.compute_proximity_score(7.5) == 0.5


@pytest.mark.asyncio
async def test_allocation_pipeline_seeded_data(db, seeded):
    """
    The seeded Section 14 scenario: two O- PRBC units on the shelf, a 2-unit MTP request.
    """
    hosp = (await db.execute(select(Hospital))).scalars().first()
    assert hosp is not None

    now = datetime.now(timezone.utc)
    req = BloodRequest(
        hospital_id=hosp.id,
        patient_id_token="TEST-PATIENT-RA",
        required_blood_group="O-",
        component_type=BloodComponentType.PRBC,
        units_requested=2,
        triage_level=TriageLevel.MASSIVE_TRANSFUSION_PROTOCOL,
        calculated_urgency_score=100.0,
        deadline_at=now + timedelta(minutes=12),
        status=RequestStatus.PENDING_EVALUATION,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    result = await AllocationService(db).execute_allocation_pipeline(req.id)

    assert result["strategy"] == "INVENTORY"
    assert result["allocated_units"] == 2
    assert result["request_status"] == RequestStatus.COMMITTED_IN_TRANSIT.value
