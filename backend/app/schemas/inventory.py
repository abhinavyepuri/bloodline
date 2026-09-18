from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict
from app.models.inventory import BloodComponentType, UnitStatus


class InventoryUnitCreate(BaseModel):
    batch_number: str
    blood_group: str
    component_type: BloodComponentType
    volume_ml: float = 450.0
    collection_date: datetime
    expiry_date: datetime


class InventoryUnitUpdateStatus(BaseModel):
    status: UnitStatus


class InventoryUnitOut(BaseModel):
    id: str
    blood_bank_id: str
    batch_number: str
    blood_group: str
    component_type: BloodComponentType
    volume_ml: float
    collection_date: datetime
    expiry_date: datetime
    status: UnitStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
