import pytest
from datetime import datetime, timedelta, timezone
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
async def test_health_report_retrieval_and_deferral(client, hospital_token, blood_bank_token):
    await _quarantine_all_o_neg_prbc(client, blood_bank_token)

    # 1. Login as Alice (Eligible donor, Hb 14.2)
    alice_token = (
        await client.post(
            "/api/v1/auth/login",
            json={"email": "alice@donor.org", "password": "password123"},
        )
    ).json()["access_token"]

    alice_report = (
        await client.get("/api/v1/donors/me/health-report", headers=auth(alice_token))
    ).json()
    assert alice_report["eligibility_status"] == "ELIGIBLE"
    assert alice_report["hemoglobin_g_dl"] >= 12.5
    assert alice_report["deferral_reason"] is None

    # 2. Login as Jessica (Deferred donor, Hb 11.4)
    jessica_token = (
        await client.post(
            "/api/v1/auth/login",
            json={"email": "jessica@donor.org", "password": "password123"},
        )
    ).json()["access_token"]

    jessica_report = (
        await client.get("/api/v1/donors/me/health-report", headers=auth(jessica_token))
    ).json()
    assert jessica_report["eligibility_status"] == "TEMPORARILY_DEFERRED"
    assert jessica_report["hemoglobin_g_dl"] < 12.5
    assert "Low hemoglobin" in jessica_report["deferral_reason"]
    assert jessica_report["deferral_end_date"] is not None

    # 3. Hospital creates emergency blood request for O-
    created = await client.post(
        "/api/v1/requests",
        headers=auth(hospital_token),
        json={
            "patient_id_token": "TEST-HEALTH-SCREEN-1",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 1,
            "triage_level": "ACTIVE_TRAUMA",
            "deadline_at": _deadline(30),
        },
    )
    assert created.status_code == 201
    request_id = created.json()["id"]

    # 4. Jessica has active deferral, so active alerts feed MUST be empty for her
    jessica_alerts = (
        await client.get("/api/v1/donors/requests/active", headers=auth(jessica_token))
    ).json()
    assert len(jessica_alerts) == 0

    # 5. Jessica attempting to respond directly must be rejected due to clinical deferral
    respond_attempt = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(jessica_token),
        json={"action": "ACCEPT", "bags_offered": 1},
    )
    assert respond_attempt.status_code == 400
    assert "deferred" in respond_attempt.text.lower() or "hemoglobin" in respond_attempt.text.lower()

    # 6. Jessica updates her vitals with cleared medical report (Hb 13.5 g/dL, Weight 62 kg, BP 120/80)
    update_res = await client.post(
        "/api/v1/donors/me/health-report",
        headers=auth(jessica_token),
        json={
            "hemoglobin_g_dl": 13.5,
            "systolic_bp": 120,
            "diastolic_bp": 80,
            "pulse_bpm": 72,
            "temperature_c": 36.6,
            "weight_kg": 62.0,
            "hiv_status": "NEGATIVE",
            "hepb_status": "NEGATIVE",
            "hepc_status": "NEGATIVE",
            "syphilis_status": "NEGATIVE",
            "malaria_status": "NEGATIVE",
            "doctor_remarks": "Repeat Hb test normal (13.5 g/dL). Clinically cleared for blood donation.",
        },
    )
    assert update_res.status_code == 200
    cleared_report = update_res.json()
    assert cleared_report["eligibility_status"] == "ELIGIBLE"
    assert cleared_report["deferral_reason"] is None

    # Toggle Jessica online now that health report is cleared
    avail = await client.patch(
        "/api/v1/donors/availability",
        headers=auth(jessica_token),
        json={"is_available": True},
    )
    assert avail.status_code == 200, avail.text
    assert avail.json()["is_available"] is True

    # 7. Now Jessica can see and accept the emergency request!
    jessica_alerts_after = (
        await client.get("/api/v1/donors/requests/active", headers=auth(jessica_token))
    ).json()
    assert any(a["id"] == request_id for a in jessica_alerts_after)

    accept_res = await client.post(
        f"/api/v1/donors/requests/{request_id}/respond",
        headers=auth(jessica_token),
        json={"action": "ACCEPT", "bags_offered": 1},
    )
    assert accept_res.status_code == 200
    assert accept_res.json()["status"] == "HARD_LOCKED_COMMITTED"
