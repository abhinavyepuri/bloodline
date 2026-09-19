import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_multi_packet_registration(client: AsyncClient):
    # 1. Login as blood bank
    login_res = await client.post(
        "/api/v1/auth/login",
        json={"email": "bloodbank@smartblood.org", "password": "password123"},
    )
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Register 4 packets of B+ WHOLE_BLOOD at once
    payload = {
        "batch_number": "BB-MULTI-TEST",
        "blood_group": "B+",
        "component_type": "WHOLE_BLOOD",
        "volume_ml": 300,
        "collection_date": "2026-09-01T00:00:00Z",
        "expiry_date": "2026-11-01T00:00:00Z",
        "quantity": 4,
    }
    create_res = await client.post("/api/v1/inventory/units", json=payload, headers=headers)
    assert create_res.status_code == 201

    # 3. Verify all 4 packets are present in inventory
    inv_res = await client.get("/api/v1/inventory", headers=headers)
    assert inv_res.status_code == 200
    all_units = inv_res.json()

    multi_units = [u for u in all_units if u["batch_number"].startswith("BB-MULTI-TEST")]
    assert len(multi_units) == 4, f"Expected 4 units, found {len(multi_units)}"

    # Check indexed batch numbers
    batch_numbers = {u["batch_number"] for u in multi_units}
    assert "BB-MULTI-TEST-01" in batch_numbers
    assert "BB-MULTI-TEST-02" in batch_numbers
    assert "BB-MULTI-TEST-03" in batch_numbers
    assert "BB-MULTI-TEST-04" in batch_numbers
    assert all(u["blood_group"] == "B+" for u in multi_units)
    assert all(u["status"] == "AVAILABLE" for u in multi_units)
