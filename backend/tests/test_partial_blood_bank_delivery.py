import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone, timedelta

from app.models.inventory import InventoryUnit, BloodComponentType, UnitStatus
from app.models.blood_bank import BloodBank
from app.models.request import BloodRequest, RequestStatus
from app.models.allocation import Allocation, AllocationStatus

pytestmark = pytest.mark.asyncio


async def test_partial_blood_bank_delivery_flow(
    client: AsyncClient,
    hospital_token: str,
    blood_bank_token: str,
    db: AsyncSession,
):
    """
    Verify scenario where blood bank possesses 1 or 2 units for a request needing more:
    - Automatic matching secures the available stock.
    - Blood bank can dispatch the secured units to the hospital courier.
    - Allocation details (batch number, blood group, status) are exposed to the hospital.
    - Hospital can confirm delivery/receipt and transfuse available emergency units.
    """
    auth_hosp = {"Authorization": f"Bearer {hospital_token}"}
    auth_bb = {"Authorization": f"Bearer {blood_bank_token}"}

    # 1. Ensure blood bank has exactly 1 available bag of O- PRBC
    bb_res = await db.execute(select(BloodBank))
    bb = bb_res.scalars().first()
    assert bb is not None

    now = datetime.now(timezone.utc)

    # Hospital creates request for 3 units of O- PRBC (seed has 2 units, so 1 shortfall)
    create_payload = {
        "patient_id_token": "PT-TRAUMA-PARTIAL-01",
        "required_blood_group": "O-",
        "component_type": "PRBC",
        "units_requested": 3,
        "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
        "deadline_at": (now + timedelta(minutes=30)).isoformat(),
    }
    resp = await client.post("/api/v1/requests", json=create_payload, headers=auth_hosp)
    assert resp.status_code == 201, resp.text
    req_data = resp.json()
    req_id = req_data["id"]

    assert req_data["units_requested"] == 3
    assert req_data["units_covered"] == 2
    assert req_data["units_shortfall"] == 1
    allocations = req_data.get("allocations", [])
    assert len(allocations) >= 1
    inv_alloc = next((a for a in allocations if a["source_type"] == "BLOOD_BANK_INVENTORY"), None)
    assert inv_alloc is not None
    assert inv_alloc["status"] == "HARD_LOCKED"
    assert inv_alloc["batch_number"] is not None

    # 3. Blood bank checks incoming orders and dispatches the available bags
    orders_resp = await client.get("/api/v1/inventory/orders", headers=auth_bb)
    assert orders_resp.status_code == 200
    orders = orders_resp.json()
    target_order = next((o for o in orders if o["request_id"] == req_id), None)
    assert target_order is not None
    assert len(target_order["allocated_units"]) >= 1

    # Blood bank dispatches to ambulance
    disp_resp = await client.post(f"/api/v1/inventory/orders/{req_id}/dispatch", headers=auth_bb)
    assert disp_resp.status_code == 200, disp_resp.text
    disp_data = disp_resp.json()
    assert disp_data["status"] == "DISPATCHED_TO_COURIER"
    assert len(disp_data["batches"]) >= 1

    # 4. Hospital checks request state — unit is now in transit
    hosp_view = await client.get(f"/api/v1/requests/{req_id}", headers=auth_hosp)
    assert hosp_view.status_code == 200
    hosp_data = hosp_view.json()
    inv_alloc_updated = next(
        a for a in hosp_data["allocations"] if a["source_type"] == "BLOOD_BANK_INVENTORY"
    )
    assert inv_alloc_updated["status"] == "IN_TRANSIT"
    assert inv_alloc_updated["batch_number"] is not None

    # 5. Calling standard fulfill without allow_partial returns 409 because shortfall remains
    fail_ful = await client.post(f"/api/v1/requests/{req_id}/fulfill", headers=auth_hosp)
    assert fail_ful.status_code == 409

    # 6. Hospital confirms receipt of the dispatched blood bank bags with allow_partial=True
    ful_resp = await client.post(
        f"/api/v1/requests/{req_id}/fulfill?allow_partial=true", headers=auth_hosp
    )
    assert ful_resp.status_code == 200, ful_resp.text
    ful_data = ful_resp.json()
    assert ful_data["status"] == "FULFILLED"

    # Verify allocation status updated to COMPLETED in database
    db_alloc = await db.get(Allocation, inv_alloc_updated["id"])
    assert db_alloc.status == AllocationStatus.COMPLETED
