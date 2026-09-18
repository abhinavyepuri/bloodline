"""
Wave 2 regression tests: per-unit claims, honest coverage, and multi-unit re-planning.

These are the behaviours the PRD describes and the original engine could not deliver —
a 4-unit request could only ever be filled by a single donor, partial fills were
reported as fully in-transit, and re-planning reserved one unit regardless of how many
were missing.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.redis import ConcurrencyLockManager, get_redis
from app.models.allocation import AllocationStatus
from app.models.donor import Donor
from app.models.inventory import BloodComponentType, InventoryUnit, UnitStatus
from app.models.user import User
from app.core.permissions import UserRole
from app.core.security import get_password_hash
from tests.conftest import auth

DAVE_EMAIL = "dave@donor.org"


def _deadline(minutes: int = 20) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


async def _quarantine_all_o_neg_prbc(client, blood_bank_token) -> int:
    """Empty the O- red-cell shelf so a request has to be met by live donors."""
    inventory = (await client.get("/api/v1/inventory", headers=auth(blood_bank_token))).json()
    targets = [
        u for u in inventory if u["blood_group"] == "O-" and u["component_type"] == "PRBC"
    ]
    for unit in targets:
        response = await client.patch(
            f"/api/v1/inventory/units/{unit['id']}/status",
            headers=auth(blood_bank_token),
            json={"status": "QUARANTINED"},
        )
        assert response.status_code == 200, response.text
    return len(targets)


async def _add_third_o_neg_donor(db, longitude: float = 77.6000, latitude: float = 12.9800):
    """Register an extra eligible O- donor so three distinct animals can each claim a slot."""
    from geoalchemy2.functions import ST_Point, ST_SetSRID

    user = User(
        email=DAVE_EMAIL,
        hashed_password=get_password_hash("password123"),
        full_name="Dave Donor (D4)",
        phone_number="+1-555-0304",
        role=UserRole.DONOR,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    donor = Donor(
        user_id=user.id,
        blood_group="O-",
        date_of_birth=date(1990, 6, 1),
        weight_kg=75.0,
        last_donation_date=None,
        is_available=True,
        reliability_score=0.90,
        total_successful_donations=1,
        latitude=latitude,
        longitude=longitude,
        location=ST_SetSRID(ST_Point(longitude, latitude), 4326),
    )
    db.add(donor)
    await db.commit()
    await db.refresh(donor)
    return donor


# --------------------------------------------------------------------- locking
async def test_unit_slots_are_claimed_one_at_a_time():
    """
    The hard lock is per *unit slot*, not per request.

    Two donors claim two different slots on a two-unit request; a third is refused
    because nothing is left. This is the change that lets N donors fill an N-unit
    request at all.
    """
    redis = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis)
    request_id = "test-slot-claiming"

    await lock_mgr.release_request_locks(request_id)
    try:
        assert await lock_mgr.claim_unit_slot(request_id, "donor-a", 2) == 0
        assert await lock_mgr.claim_unit_slot(request_id, "donor-b", 2) == 1
        assert await lock_mgr.claim_unit_slot(request_id, "donor-c", 2) is None

        assert await lock_mgr.claimed_count(request_id, 2) == 2

        # A donor who already holds a slot is reported as such rather than handed a second.
        assert await lock_mgr.donor_slot(request_id, "donor-a", 2) == 0
        assert await lock_mgr.donor_slot(request_id, "donor-c", 2) is None
    finally:
        await lock_mgr.release_request_locks(request_id)

    assert await lock_mgr.claimed_count(request_id, 2) == 0


async def test_alert_zone_is_enumerable_and_expires():
    """The soft lock is an enumerable set, so a stand-down only touches alerted donors."""
    redis = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis)
    request_id = "test-zone-membership"

    await lock_mgr.release_request_locks(request_id)
    try:
        await lock_mgr.register_alerted_donors(request_id, ["d1", "d2", "d3"], ttl_seconds=120)
        assert await lock_mgr.get_alerted_donors(request_id) == {"d1", "d2", "d3"}
        assert await lock_mgr.is_donor_alerted(request_id, "d2")

        await lock_mgr.remove_alerted_donor(request_id, "d2")
        assert await lock_mgr.get_alerted_donors(request_id) == {"d1", "d3"}

        ttl = await lock_mgr.alert_zone_ttl(request_id)
        assert ttl is not None and 0 < ttl <= 120
    finally:
        await lock_mgr.release_request_locks(request_id)

    assert await lock_mgr.alert_zone_ttl(request_id) is None


# ------------------------------------------------------------------- coverage
async def test_two_unit_request_is_fully_covered_from_inventory(client, hospital_token):
    """Section 14 step 1: two O- PRBC units sit on the shelf; both are reserved."""
    response = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-FULL-INVENTORY",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 2,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": _deadline(15),
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["units_covered"] == 2
    assert body["units_shortfall"] == 0
    assert body["status"] == "COMMITTED_IN_TRANSIT"


async def test_partial_fill_never_reports_in_transit(client, hospital_token):
    """
    Only two O- units exist; asking for three must not claim success.

    The old engine set COMMITTED_IN_TRANSIT whenever *any* inventory was reserved.
    """
    response = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-PARTIAL",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 3,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": _deadline(15),
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["units_covered"] == 2
    assert body["units_shortfall"] == 1
    assert body["status"] != "COMMITTED_IN_TRANSIT"
    assert body["status"] in ("PROXIMITY_ZONE_NOTIFIED", "RE_PLANNING")

    # And the hospital cannot sign for blood it never received.
    fulfill = await client.post(
        f"/api/v1/requests/{body['id']}/fulfill", headers=auth(hospital_token)
    )
    assert fulfill.status_code == 409
    assert "unit" in fulfill.text.lower()


async def test_three_unit_request_filled_by_three_separate_donors(
    client, blood_bank_token, hospital_token, db
):
    """The headline Wave 2 behaviour: N units, N donors, N distinct slots."""
    quarantined = await _quarantine_all_o_neg_prbc(client, blood_bank_token)
    assert quarantined == 2, "seed data is expected to hold exactly two O- PRBC units"
    await _add_third_o_neg_donor(db)

    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-THREE-DONORS",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 3,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": _deadline(15),
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert created.json()["units_covered"] == 0
    assert created.json()["status"] == "PROXIMITY_ZONE_NOTIFIED"

    slots = []
    for index, email in enumerate(
        ["alice@donor.org", "bob@donor.org", DAVE_EMAIL], start=1
    ):
        token = (
            await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "password123"},
            )
        ).json()["access_token"]

        responded = await client.post(
            f"/api/v1/donors/requests/{request_id}/respond",
            headers=auth(token),
            json={"action": "ACCEPT"},
        )
        assert responded.status_code == 200, responded.text
        payload = responded.json()

        slots.append(payload["slot"])
        assert payload["units_covered"] == index, (
            f"after {index} acceptance(s) the request should show {index} covered unit(s)"
        )
        assert payload["units_requested"] == 3
        # Only the final acceptance closes the request.
        expected = "COMMITTED_IN_TRANSIT" if index == 3 else "PROXIMITY_ZONE_NOTIFIED"
        assert payload["request_status"] == expected, payload

    assert len(set(slots)) == 3, f"each donor must hold a distinct slot, got {slots}"

    final = (await client.get(f"/api/v1/requests/{request_id}", headers=auth(hospital_token))).json()
    assert final["units_covered"] == 3
    assert final["units_shortfall"] == 0
    assert final["status"] == "COMMITTED_IN_TRANSIT"


async def test_donor_cannot_claim_twice(client, blood_bank_token, hospital_token, db):
    """A second ACCEPT from the same donor must not consume another unit slot."""
    await _quarantine_all_o_neg_prbc(client, blood_bank_token)

    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-DOUBLE-CLAIM",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 2,
            "triage_level": "ACTIVE_TRAUMA",
            "deadline_at": _deadline(45),
        },
    )
    request_id = created.json()["id"]

    token = (
        await client.post(
            "/api/v1/auth/login", json={"email": "alice@donor.org", "password": "password123"}
        )
    ).json()["access_token"]

    first = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(token),
        json={"action": "ACCEPT"},
    )
    assert first.json()["units_covered"] == 1

    second = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(token),
        json={"action": "ACCEPT"},
    )
    assert second.status_code == 200
    assert second.json()["status"] == "ALREADY_CLAIMED"

    final = (await client.get(f"/api/v1/requests/{request_id}", headers=auth(hospital_token))).json()
    assert final["units_covered"] == 1, "one donor must not be counted twice"


async def test_unrelated_donor_cannot_respond_to_an_alert_they_never_received(
    client, hospital_token
):
    """
    Being logged in as a donor is not the same as being alerted for a request.

    Three O- units are asked for when only two exist, so the request stays open in the
    alerting state with a live zone. Charlie is A+, which makes him incompatible with an
    O- recipient, so the zone never contained him.
    """
    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-NOT-ALERTED",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 3,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": _deadline(20),
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert created.json()["status"] == "PROXIMITY_ZONE_NOTIFIED"

    token = (
        await client.post(
            "/api/v1/auth/login",
            json={"email": "charlie@donor.org", "password": "password123"},
        )
    ).json()["access_token"]

    response = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(token),
        json={"action": "ACCEPT"},
    )
    assert response.status_code == 403, response.text

    # And nothing was allocated to him.
    final = (await client.get(f"/api/v1/requests/{request_id}", headers=auth(hospital_token))).json()
    assert final["units_covered"] == 2


# ----------------------------------------------------------------- re-planning
async def test_replan_reserves_the_whole_shortfall(client, blood_bank_token, hospital_token, db):
    """
    A re-plan must replace the *whole* shortfall in one pass.

    The original took ``extra_inventory[0]`` from a query that had already been limited
    to the shortfall, so a two-unit gap could only ever be half repaired and the request
    silently stayed one unit short. Two units are lost here and a single
    ``replan_request`` call has to bring the request back to full coverage.
    """
    from app.models.allocation import Allocation
    from app.models.inventory import InventoryUnit
    from app.services.allocation_service import AllocationService

    now = datetime.now(timezone.utc)

    # Two more units than the request will take, so the re-plan has replacements to find.
    for index in range(5, 9):
        registered = await client.post(
            "/api/v1/inventory/units",
            headers=auth(blood_bank_token),
            json={
                "batch_number": f"BB-{index:03d}",
                "blood_group": "O-",
                "component_type": "PRBC",
                "volume_ml": 300.0,
                "collection_date": now.isoformat(),
                "expiry_date": (now + timedelta(days=200)).isoformat(),
            },
        )
        assert registered.status_code == 201, registered.text

    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-REPLAN-WHOLE-SHORTFALL",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 4,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": _deadline(15),
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert created.json()["units_covered"] == 4, "six units were available for a four-unit request"
    assert created.json()["status"] == "COMMITTED_IN_TRANSIT"

    # Lose two of the four reserved units in one go.
    holdings = (
        (
            await db.execute(
                select(Allocation).where(
                    Allocation.request_id == request_id,
                    Allocation.status == AllocationStatus.HARD_LOCKED,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(holdings) == 4

    for allocation in holdings[:2]:
        allocation.status = AllocationStatus.RE_OPTIMIZED
        unit = await db.get(InventoryUnit, allocation.inventory_unit_id)
        unit.status = UnitStatus.QUARANTINED
    await db.commit()

    result = await AllocationService(db).replan_request(
        request_id, trigger_reason="test: two units lost"
    )

    assert result["status"] == "REPLACED_FROM_INVENTORY", result
    assert result["replaced"] == 2, f"both missing units should be replaced, got {result}"
    assert result["retained"] == 4, f"the request should be whole again, got {result}"

    final = (await client.get(f"/api/v1/requests/{request_id}", headers=auth(hospital_token))).json()
    assert final["units_covered"] == 4
    assert final["units_shortfall"] == 0
    assert final["status"] == "COMMITTED_IN_TRANSIT"


async def test_quarantining_a_reserved_unit_keeps_the_rest_covered(
    client, blood_bank_token, hospital_token
):
    """Killing one unit must not invalidate the units that survived it."""
    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-REPLAN",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 2,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": _deadline(15),
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert created.json()["units_covered"] == 2

    # Break one of the two reserved units.
    inventory = (await client.get("/api/v1/inventory", headers=auth(blood_bank_token))).json()
    reserved = [u for u in inventory if u["status"] == "LOCKED_RESERVE"]
    assert len(reserved) == 2, f"expected both units reserved, saw {len(reserved)}"

    await client.patch(
        f"/api/v1/inventory/units/{reserved[0]['id']}/status",
        headers=auth(blood_bank_token),
        json={"status": "QUARANTINED"},
    )

    refreshed = (
        await client.get(f"/api/v1/requests/{request_id}", headers=auth(hospital_token))
    ).json()

    # With no spare O- stock on the shelf the request falls back to alerting donors,
    # but the remaining reserved unit must still count towards coverage.
    assert refreshed["units_covered"] == 1
    assert refreshed["units_shortfall"] == 1
    assert refreshed["status"] != "COMMITTED_IN_TRANSIT"


async def test_seeded_inventory_can_be_restored_to_a_clean_state(client, blood_bank_token):
    """Guard against the seed data drifting: two O- PRBC units, both available."""
    inventory = (await client.get("/api/v1/inventory", headers=auth(blood_bank_token))).json()
    available_o_neg = [
        u
        for u in inventory
        if u["blood_group"] == "O-" and u["component_type"] == "PRBC" and u["status"] == "AVAILABLE"
    ]
    assert len(available_o_neg) == 2


async def test_expired_units_are_flipped_out_of_the_available_pool(db, seeded):
    """
    Nothing used to set EXPIRED, so outdated stock stayed visible as "Ready" on the
    blood bank dashboard while being unusable for transfusion.
    """
    from app.models.blood_bank import BloodBank
    from app.services.inventory_service import expire_stale_units

    bank_id = (await db.execute(select(BloodBank.id))).scalars().first()
    unit = InventoryUnit(
        blood_bank_id=bank_id,
        batch_number="TEST-EXPIRED",
        blood_group="O-",
        component_type=BloodComponentType.PRBC,
        volume_ml=300.0,
        collection_date=datetime.now(timezone.utc) - timedelta(days=60),
        expiry_date=datetime.now(timezone.utc) - timedelta(days=1),
        status=UnitStatus.AVAILABLE,
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)

    expired = await expire_stale_units(db)
    assert "TEST-EXPIRED" in expired

    await db.refresh(unit)
    assert unit.status == UnitStatus.EXPIRED

    # And the compatibility query no longer offers it.
    from app.repositories.inventory_repo import InventoryRepository

    pairs = await InventoryRepository(db).find_compatible_units_with_lock(
        compatible_blood_groups=["O-"],
        component_type=BloodComponentType.PRBC,
        limit=10,
    )
    assert "TEST-EXPIRED" not in [u.batch_number for u, _ in pairs]


async def test_recently_donated_donor_is_not_alerted(db, seeded):
    """A donor inside the 56-day whole-blood window must not be offered to a patient."""
    from app.repositories.donor_repo import DonorRepository

    alice = (await db.execute(select(Donor).where(Donor.blood_group == "O-"))).scalars().first()
    alice.last_donation_date = date.today() - timedelta(days=3)
    await db.commit()

    donors = await DonorRepository(db).find_eligible_donors_in_proximity(
        compatible_blood_groups=["O-"],
        hospital_lat=12.9716,
        hospital_lng=77.5946,
        radius_km=15.0,
        component_type=BloodComponentType.PRBC,
    )
    assert alice.id not in [d.id for d, _ in donors]

    # Applying the same rule at accept time raises rather than silently proceeding.
    from app.core.exceptions import DonorIneligibleError
    from app.services.donor_service import ensure_donor_eligible

    with pytest.raises(DonorIneligibleError):
        ensure_donor_eligible(alice, BloodComponentType.PRBC)
