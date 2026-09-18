"""
Wave 1 regression tests: every endpoint that used to be open now requires the right
role, and cross-tenant reads are refused.
"""

from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import auth

# Routes that were reachable with no token at all before Wave 1.
PROTECTED_ROUTES = [
    ("GET", "/api/v1/requests"),
    ("GET", "/api/v1/donors"),
    ("GET", "/api/v1/inventory"),
    ("GET", "/api/v1/inventory/orders"),
    ("GET", "/api/v1/audit/logs"),
    ("POST", "/api/v1/admin/reset-seed"),
]


@pytest.mark.parametrize("method,path", PROTECTED_ROUTES)
async def test_protected_routes_reject_anonymous(client, method, path):
    response = await client.request(method, path)
    assert response.status_code in (401, 403), (
        f"{method} {path} returned {response.status_code}; it must require a token"
    )


async def test_donor_cannot_read_the_request_board(client, donor_token):
    """Donors are fed targeted alerts, not the city-wide board."""
    response = await client.get("/api/v1/requests", headers=auth(donor_token))
    assert response.status_code == 403


async def test_donor_listing_is_restricted_and_reduced(client, donor_token, coordinator_token):
    """A donor may not enumerate other donors; staff get a PII-free shape."""
    assert (await client.get("/api/v1/donors", headers=auth(donor_token))).status_code == 403

    response = await client.get("/api/v1/donors", headers=auth(coordinator_token))
    assert response.status_code == 200
    for donor in response.json():
        # DonorPublicOut deliberately omits these.
        assert "date_of_birth" not in donor
        assert "weight_kg" not in donor
        assert "latitude" not in donor
        assert "longitude" not in donor
        assert "user_id" not in donor


async def test_coordinator_must_name_a_hospital(client, coordinator_token):
    """The old code silently attributed requests to whichever hospital came first."""
    response = await client.post(
        "/api/v1/requests",
        headers=auth(coordinator_token),
        json={
            "patient_id_token": "TEST-NO-HOSPITAL",
            "required_blood_group": "A+",
            "component_type": "PRBC",
            "units_requested": 1,
            "triage_level": "ROUTINE_CLINICAL",
            "deadline_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
        },
    )
    assert response.status_code == 422
    assert "hospital_id" in response.text


async def test_hospital_cannot_read_another_hospitals_request(client, hospital_token, coordinator_token):
    """A coordinator raises a request for the second hospital; the first must not see it."""
    hospitals = (await client.get("/api/v1/hospitals", headers=auth(coordinator_token))).json()
    assert len(hospitals) >= 2, "seed data should provide at least two hospitals"

    other = next(h for h in hospitals if h["name"] != "Metro General Hospital")
    created = await client.post(
        "/api/v1/requests",
        headers=auth(coordinator_token),
        json={
            "patient_id_token": "TEST-FOREIGN",
            "required_blood_group": "A+",
            "component_type": "PRBC",
            "units_requested": 1,
            "triage_level": "ROUTINE_CLINICAL",
            "deadline_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
            "hospital_id": other["id"],
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]

    # Metro General's own account may not read or cancel it.
    assert (
        await client.get(f"/api/v1/requests/{request_id}", headers=auth(hospital_token))
    ).status_code == 403
    assert (
        await client.patch(f"/api/v1/requests/{request_id}/cancel", headers=auth(hospital_token))
    ).status_code == 403


# --------------------------------------------------------------------------------------
# WebSocket authentication
# --------------------------------------------------------------------------------------
# httpx's ASGI transport cannot speak WebSocket, so these two use Starlette's sync
# TestClient. It is deliberately *not* entered as a context manager: doing so runs the
# app's lifespan, which would touch the application's own pooled engine from the client's
# portal thread — a connection the tests' event loop could then never reuse.

def _sync_client():
    from starlette.testclient import TestClient

    from app.main import app

    return TestClient(app)


async def test_anonymous_websocket_is_rejected():
    """
    The socket used to accept anyone and then broadcast the whole city's traffic.

    A rejected socket is accepted and then closed with policy code 1008 rather than
    failing the handshake, so a browser can tell "your token was refused" apart from a
    network blip instead of retrying forever.
    """
    import json

    from starlette.websockets import WebSocketDisconnect

    with _sync_client().websocket_connect("/api/v1/realtime/ws") as ws:
        payload = json.loads(ws.receive_text())
        assert payload["type"] == "AUTH_ERROR"

        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1008


async def test_invalid_token_websocket_is_rejected():
    """A syntactically valid but unverifiable JWT is refused the same way."""
    import json

    from starlette.websockets import WebSocketDisconnect

    with _sync_client().websocket_connect(
        "/api/v1/realtime/ws?token=not-a-real-jwt"
    ) as ws:
        assert json.loads(ws.receive_text())["type"] == "AUTH_ERROR"

        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1008


async def test_authenticated_websocket_is_accepted(hospital_token):
    """A valid token yields a live socket on the user's own targeted channel."""
    import json

    with _sync_client().websocket_connect(
        f"/api/v1/realtime/ws?token={hospital_token}"
    ) as ws:
        ws.send_text("ping")
        assert json.loads(ws.receive_text()) == {"type": "pong"}
