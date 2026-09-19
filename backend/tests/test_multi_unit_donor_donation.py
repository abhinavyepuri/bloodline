import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from app.models.allocation import Allocation, AllocationStatus
from app.models.inventory import BloodComponentType
from app.models.request import BloodRequest, RequestStatus
from tests.conftest import auth


def _deadline(minutes: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


async def _quarantine_all_o_neg_prbc(client, blood_bank_token) -> int:
    inventory = (await client.get("/api/v1/inventory", headers=auth(blood_bank_token))).json()
    targets = [
        u for u in inventory if u["blood_group"] == "O-" and u["component_type"] == "PRBC"
    ]
    for unit in targets:
        await client.patch(
            f"/api/v1/inventory/units/{unit['id']}/status",
            headers=auth(blood_bank_token),
            json={"status": "QUARANTINED"},
        )
    return len(targets)


@pytest.mark.asyncio
async def test_single_donor_commits_multiple_bags_atomically(
    client, blood_bank_token, hospital_token, db
):
    """
    When a volunteer offers N bags, the system claims N unit slots atomically,
    creates N Allocation records, updates coverage by N, and stands down remaining alert zone.
    """
    await _quarantine_all_o_neg_prbc(client, blood_bank_token)

    # 1. Hospital requests 2 units of O- PRBC
    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-MULTI-BAG-1",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 2,
            "triage_level": "ACTIVE_TRAUMA",
            "deadline_at": _deadline(30),
        },
    )
    assert created.status_code == 201, created.text
    req_data = created.json()
    request_id = req_data["id"]

    # 2. Alice (O- donor) logs in
    token = (
        await client.post(
            "/api/v1/auth/login", json={"email": "alice@donor.org", "password": "password123"}
        )
    ).json()["access_token"]

    # Active alerts contains this request
    active_alerts = (
        await client.get("/api/v1/donors/requests/active", headers=auth(token))
    ).json()
    assert any(a["id"] == request_id for a in active_alerts)

    # 3. Alice accepts committing 2 bags
    respond = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(token),
        json={"action": "ACCEPT", "bags_offered": 2},
    )
    assert respond.status_code == 200, respond.text
    res_json = respond.json()

    assert res_json["status"] == "HARD_LOCKED_COMMITTED"
    assert res_json["bags_committed"] == 2
    assert res_json["units_covered"] == 2
    assert res_json["units_requested"] == 2
    assert res_json["shortfall"] == 0
    assert res_json["request_status"] == "COMMITTED_IN_TRANSIT"
    assert len(res_json["allocation_ids"]) == 2

    # 4. Verify 2 Allocation records in DB
    alloc_res = await db.execute(
        select(Allocation).where(Allocation.request_id == request_id)
    )
    allocs = alloc_res.scalars().all()
    assert len(allocs) == 2
    for a in allocs:
        assert a.status == AllocationStatus.HARD_LOCKED
        assert a.donor_id == res_json["donor_id"]

    # 5. Alice checks active alerts again: the request MUST NOT appear anymore
    active_after = (
        await client.get("/api/v1/donors/requests/active", headers=auth(token))
    ).json()
    assert not any(a["id"] == request_id for a in active_after)

    # 6. Idempotency: repeating ACCEPT returns ALREADY_CLAIMED without adding allocations
    repeat = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(token),
        json={"action": "ACCEPT", "bags_offered": 2},
    )
    assert repeat.status_code == 200
    assert repeat.json()["status"] == "ALREADY_CLAIMED"

    alloc_res2 = await db.execute(
        select(Allocation).where(Allocation.request_id == request_id)
    )
    assert len(alloc_res2.scalars().all()) == 2

    # 7. Blood Bank desk views orders: volunteer allocations are listed
    orders = (
        await client.get("/api/v1/inventory/orders", headers=auth(blood_bank_token))
    ).json()
    matched_order = next((o for o in orders if o["request_id"] == request_id), None)
    assert matched_order is not None
    assert matched_order["units_covered"] == 2
    assert matched_order["units_shortfall"] == 0
    assert len(matched_order["volunteer_donors"]) == 2


@pytest.mark.asyncio
async def test_bags_offered_capped_at_remaining_shortfall(
    client, blood_bank_token, hospital_token, db
):
    """
    If a request needs 3 units, Donor A offers 2 bags, and Donor B offers 3 bags:
    Donor A gets 2 bags (shortfall becomes 1).
    Donor B is capped at 1 bag (shortfall becomes 0).
    """
    await _quarantine_all_o_neg_prbc(client, blood_bank_token)

    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-MULTI-BAG-CAP",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 3,
            "triage_level": "ACTIVE_TRAUMA",
            "deadline_at": _deadline(30),
        },
    )
    assert created.status_code == 201
    request_id = created.json()["id"]

    alice_token = (
        await client.post(
            "/api/v1/auth/login", json={"email": "alice@donor.org", "password": "password123"}
        )
    ).json()["access_token"]

    bob_token = (
        await client.post(
            "/api/v1/auth/login", json={"email": "bob@donor.org", "password": "password123"}
        )
    ).json()["access_token"]

    # Alice offers 2 bags
    alice_res = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(alice_token),
        json={"action": "ACCEPT", "bags_offered": 2},
    )
    assert alice_res.status_code == 200
    assert alice_res.json()["bags_committed"] == 2
    assert alice_res.json()["units_covered"] == 2
    assert alice_res.json()["shortfall"] == 1
    assert alice_res.json()["request_status"] == "PROXIMITY_ZONE_NOTIFIED"

    # Bob offers 3 bags, but only 1 shortfall remains: capped at 1
    bob_res = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(bob_token),
        json={"action": "ACCEPT", "bags_offered": 3},
    )
    assert bob_res.status_code == 200
    assert bob_res.json()["bags_committed"] == 1
    assert bob_res.json()["units_covered"] == 3
    assert bob_res.json()["shortfall"] == 0
    assert bob_res.json()["request_status"] == "COMMITTED_IN_TRANSIT"


@pytest.mark.asyncio
async def test_donor_donation_history_endpoint(
    client, blood_bank_token, hospital_token
):
    """
    Test GET /api/v1/donors/me/history:
    Verifies that donor donation history returns structured records,
    aggregates multi-unit commits as '2 x O- (PRBC)', and orders descending by date.
    """
    token = (
        await client.post(
            "/api/v1/auth/login", json={"email": "alice@donor.org", "password": "password123"}
        )
    ).json()["access_token"]

    history_res = await client.get("/api/v1/donors/me/history", headers=auth(token))
    assert history_res.status_code == 200
    history = history_res.json()
    assert len(history) >= 1
    for item in history:
        assert "hospital_name" in item
        assert "blood_group" in item
        assert "component_type" in item
        assert "units" in item
        assert "status" in item
        assert "donated_at" in item
        assert "notes" in item
        assert f"{item['units']} x {item['blood_group']}" in item["notes"]
