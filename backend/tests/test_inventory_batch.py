import pytest
from datetime import datetime, timedelta, timezone
from app.models.inventory import BloodComponentType, UnitStatus
from app.schemas.inventory import (
    InventoryBatchCreate,
    InventoryBatchItem,
    InventoryUnitCreate,
    InventoryUnitOut,
)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_batch_schema_validation():
    item1 = InventoryBatchItem(
        blood_group="o+",
        component_type=BloodComponentType.PRBC,
        quantity=5,
        volume_ml=450.0,
        expiry_days=42,
    )
    assert item1.blood_group == "O+"
    assert item1.quantity == 5
    assert item1.volume_ml == 450.0

    batch = InventoryBatchCreate(
        items=[item1],
        batch_prefix="DRIVE-2026-",
    )
    assert len(batch.items) == 1
    assert batch.batch_prefix == "DRIVE-2026-"


@pytest.mark.asyncio
async def test_batch_add_packets_bulk_generator(client, blood_bank_token):
    """Blood bank adds 5 bags of O- PRBC at once using the bulk generator."""
    res = await client.post(
        "/api/v1/inventory/batch",
        headers=auth(blood_bank_token),
        json={
            "blood_group": "O-",
            "component_type": "PRBC",
            "quantity": 5,
            "batch_prefix": "BB-BULK-",
            "volume_ml": 450.0,
            "expiry_days": 42,
        },
    )
    assert res.status_code == 201
    created_units = res.json()
    assert len(created_units) == 5
    for unit in created_units:
        assert unit["blood_group"] == "O-"
        assert unit["component_type"] == "PRBC"
        assert unit["status"] == "AVAILABLE"
        assert unit["volume_ml"] == 450.0
        assert unit["batch_number"].startswith("BB-BULK-")


@pytest.mark.asyncio
async def test_batch_add_packets_multi_type_items(client, blood_bank_token):
    """Blood bank adds a multi-item batch with different blood groups and component types."""
    res = await client.post(
        "/api/v1/inventory/batch",
        headers=auth(blood_bank_token),
        json={
            "items": [
                {
                    "blood_group": "A+",
                    "component_type": "PLATELETS",
                    "quantity": 3,
                    "volume_ml": 300.0,
                    "expiry_days": 5,
                },
                {
                    "blood_group": "B-",
                    "component_type": "FFP",
                    "quantity": 2,
                    "volume_ml": 250.0,
                    "expiry_days": 365,
                },
                {
                    "blood_group": "AB+",
                    "component_type": "WHOLE_BLOOD",
                    "batch_number": "CUSTOM-BAG-001",
                    "quantity": 1,
                    "volume_ml": 450.0,
                    "expiry_days": 35,
                },
            ]
        },
    )
    assert res.status_code == 201
    units = res.json()
    assert len(units) == 6  # 3 + 2 + 1

    a_pos = [u for u in units if u["blood_group"] == "A+"]
    assert len(a_pos) == 3
    assert all(u["component_type"] == "PLATELETS" for u in a_pos)

    b_neg = [u for u in units if u["blood_group"] == "B-"]
    assert len(b_neg) == 2
    assert all(u["component_type"] == "FFP" for u in b_neg)

    ab_pos = [u for u in units if u["blood_group"] == "AB+"]
    assert len(ab_pos) == 1
    assert ab_pos[0]["batch_number"] == "CUSTOM-BAG-001"
