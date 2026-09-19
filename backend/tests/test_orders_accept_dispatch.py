import pytest
from httpx import AsyncClient
from tests.conftest import login


@pytest.mark.asyncio
async def test_incoming_hospital_orders_and_accept(seeded: None, client: AsyncClient):
    # 1. Login as Hospital and Blood Bank
    hosp_token = await login(client, "HOSPITAL")
    bb_token = await login(client, "BLOOD_BANK")

    hosp_headers = {"Authorization": f"Bearer {hosp_token}"}
    bb_headers = {"Authorization": f"Bearer {bb_token}"}

    # 2. Hospital creates an emergency request for 1 unit of O- PRBC
    req_payload = {
        "patient_id_token": "PT-TEST-ACCEPT-1",
        "required_blood_group": "O-",
        "component_type": "PRBC",
        "units_requested": 1,
        "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
        "deadline_at": "2026-10-01T00:00:00Z",
    }
    create_res = await client.post("/api/v1/requests", json=req_payload, headers=hosp_headers)
    assert create_res.status_code == 201
    created_order = create_res.json()
    request_id = created_order["id"]

    # 3. Blood Bank lists incoming orders
    orders_res = await client.get("/api/v1/inventory/orders", headers=bb_headers)
    assert orders_res.status_code == 200
    orders = orders_res.json()
    target_order = next((o for o in orders if o["request_id"] == request_id), None)
    assert target_order is not None
    assert target_order["units_requested"] == 1
    assert "available_compatible_units" in target_order
    assert "units_shortfall" in target_order
    assert "units_covered" in target_order

    # 4. Dispatch the order
    dispatch_res = await client.post(
        f"/api/v1/inventory/orders/{request_id}/dispatch", headers=bb_headers
    )
    assert dispatch_res.status_code == 200
    dispatch_data = dispatch_res.json()
    assert dispatch_data["status"] in ("DISPATCHED_TO_COURIER", "DISPATCHED")
    assert len(dispatch_data["batches"]) >= 1

    # 5. Check order status after dispatch
    orders_res2 = await client.get("/api/v1/inventory/orders", headers=bb_headers)
    assert orders_res2.status_code == 200
    target_order2 = next((o for o in orders_res2.json() if o["request_id"] == request_id), None)
    assert target_order2 is not None
    assert all(u["unit_status"] == "DISPATCHED" for u in target_order2["allocated_units"])


@pytest.mark.asyncio
async def test_accept_order_explicit_auto_dispatch(seeded: None, client: AsyncClient):
    hosp_token = await login(client, "HOSPITAL")
    bb_token = await login(client, "BLOOD_BANK")

    hosp_headers = {"Authorization": f"Bearer {hosp_token}"}
    bb_headers = {"Authorization": f"Bearer {bb_token}"}

    # Hospital creates request for A+ PRBC (BB-003 exists in seed)
    req_payload = {
        "patient_id_token": "PT-TEST-ACCEPT-2",
        "required_blood_group": "A+",
        "component_type": "PRBC",
        "units_requested": 1,
        "triage_level": "ACTIVE_TRAUMA",
        "deadline_at": "2026-10-01T00:00:00Z",
    }
    create_res = await client.post("/api/v1/requests", json=req_payload, headers=hosp_headers)
    assert create_res.status_code == 201
    request_id = create_res.json()["id"]

    # Blood bank accepts order with auto_dispatch=True
    accept_res = await client.post(
        f"/api/v1/inventory/orders/{request_id}/accept",
        json={"auto_dispatch": True},
        headers=bb_headers,
    )
    assert accept_res.status_code == 200
    accept_data = accept_res.json()
    assert accept_data["status"] in ("DISPATCHED", "DISPATCHED_TO_COURIER", "ACCEPTED")


@pytest.mark.asyncio
async def test_add_new_stock_auto_matches_open_request(seeded: None, client: AsyncClient):
    hosp_token = await login(client, "HOSPITAL")
    bb_token = await login(client, "BLOOD_BANK")

    hosp_headers = {"Authorization": f"Bearer {hosp_token}"}
    bb_headers = {"Authorization": f"Bearer {bb_token}"}

    # Hospital creates request for AB- Whole Blood (not in seed stock)
    req_payload = {
        "patient_id_token": "PT-TEST-ACCEPT-3",
        "required_blood_group": "AB-",
        "component_type": "WHOLE_BLOOD",
        "units_requested": 1,
        "triage_level": "ROUTINE_CLINICAL",
        "deadline_at": "2026-10-01T00:00:00Z",
    }
    create_res = await client.post("/api/v1/requests", json=req_payload, headers=hosp_headers)
    assert create_res.status_code == 201
    request_id = create_res.json()["id"]

    # Blood Bank adds new matching stock to storage
    new_unit_payload = {
        "batch_number": "BB-NEW-999",
        "blood_group": "AB-",
        "component_type": "WHOLE_BLOOD",
        "volume_ml": 300,
        "collection_date": "2026-09-01T00:00:00Z",
        "expiry_date": "2026-11-01T00:00:00Z",
    }
    add_res = await client.post("/api/v1/inventory/units", json=new_unit_payload, headers=bb_headers)
    assert add_res.status_code == 201

    # Now verify the request was re-planned and matched
    orders_res = await client.get("/api/v1/inventory/orders", headers=bb_headers)
    assert orders_res.status_code == 200
    target_order = next((o for o in orders_res.json() if o["request_id"] == request_id), None)
    assert target_order is not None
    # Now it can be accepted and dispatched
    accept_res = await client.post(
        f"/api/v1/inventory/orders/{request_id}/accept",
        json={"auto_dispatch": True},
        headers=bb_headers,
    )
    assert accept_res.status_code == 200

