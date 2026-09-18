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
    ("GET", "/api/v1/admin/metrics"),
    ("GET", "/api/v1/admin/overview"),
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


async def test_admin_self_registration_is_forbidden(client):
    """Anonymous callers cannot register as ADMIN or COORDINATOR."""
    for forbidden_role in ("ADMIN", "COORDINATOR"):
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"attacker_{forbidden_role.lower()}@test.org",
                "password": "attackpassword123",
                "full_name": "Unauthorized Escalator",
                "phone_number": "+19998887776",
                "role": forbidden_role,
            },
        )
        assert resp.status_code == 403, (
            f"Registration with role {forbidden_role} returned {resp.status_code}; expected 403 Forbidden"
        )


async def test_security_headers_are_present(client):
    """Defensive HTTP headers must be present on responses."""
    resp = await client.get("/health")
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"


async def test_admin_metrics_rbac_and_schema(client, donor_token, hospital_token, coordinator_token, admin_token):
    """Clinical SLA metrics endpoint enforces strict RBAC and returns required telemetry schema."""
    # Non-staff roles forbidden
    assert (await client.get("/api/v1/admin/metrics", headers=auth(donor_token))).status_code == 403
    assert (await client.get("/api/v1/admin/metrics", headers=auth(hospital_token))).status_code == 403

    # Coordinator and Admin permitted
    for token in (coordinator_token, admin_token):
        resp = await client.get("/api/v1/admin/metrics", headers=auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "mean_time_to_secure_seconds" in data
        assert "donor_acceptance_conversion_rate" in data
        assert "replan_rate" in data
        assert "total_requests_processed" in data
        assert "average_transit_distance_km" in data
        assert isinstance(data["mean_time_to_secure_seconds"], (int, float))
        assert isinstance(data["donor_acceptance_conversion_rate"], (int, float))
        assert isinstance(data["replan_rate"], (int, float))
        assert isinstance(data["total_requests_processed"], int)
        assert isinstance(data["average_transit_distance_km"], (int, float))


async def test_request_correlation_id_propagated(client):
    """Correlation tracing ensures every request has an auditable X-Request-ID trace."""
    # Auto-generated ID
    resp1 = await client.get("/health")
    assert "x-request-id" in resp1.headers
    assert resp1.headers["x-request-id"].startswith("req_")

    # Custom caller trace ID propagation
    custom_trace = "trace-emergency-audit-uuid-99"
    resp2 = await client.get("/health", headers={"X-Request-ID": custom_trace})
    assert resp2.headers.get("x-request-id") == custom_trace


async def test_rate_limiting_headers_present(client, coordinator_token):
    """Rate limit headers are present on API responses."""
    resp = await client.get("/api/v1/donors", headers={**auth(coordinator_token), "X-Testing": "false"})
    assert resp.status_code == 200
    assert "x-ratelimit-limit" in resp.headers
    assert "x-ratelimit-remaining" in resp.headers
    assert "x-ratelimit-reset" in resp.headers


async def test_rate_limit_exceeded_returns_429(client):
    """When a client exceeds the sliding window threshold, HTTP 429 is returned."""
    fake_token = "Bearer test_attacker_rate_limit_token_999"
    headers = {"Authorization": fake_token, "X-Testing": "false"}
    hit_429 = False
    for _ in range(25):
        resp = await client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={"email": "bad@attempt.com", "password": "wrong"},
        )
        if resp.status_code == 429:
            hit_429 = True
            assert "retry-after" in resp.headers
            assert resp.json()["error_type"] == "RATE_LIMIT_EXCEEDED"
            break
    assert hit_429, "Expected rate limiter to return HTTP 429 when threshold exceeded"






