from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.inventory import BloodComponentType, UnitStatus


class InventoryUnitCreate(BaseModel):
    batch_number: str = Field(..., min_length=1, description="Unique unit batch number")
    blood_group: str = Field(..., min_length=1, max_length=5, description="Blood group e.g. O+, A-")
    component_type: BloodComponentType = Field(..., description="WHOLE_BLOOD, PRBC, PLATELETS, FFP, CRYOPRECIPITATE")
    volume_ml: float = Field(default=450.0, gt=0.0, description="Unit volume in mL")
    collection_date: datetime = Field(..., description="Date/time of blood collection")
    expiry_date: datetime = Field(..., description="Expiration timestamp under cold storage")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )

    @field_validator("blood_group", mode="before")
    @classmethod
    def normalize_blood_group(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip().upper()
        return v

    @field_validator("component_type", mode="before")
    @classmethod
    def normalize_component_type(cls, v: Any) -> Any:
        if isinstance(v, str):
            return BloodComponentType(v.strip().upper())
        return v

    @field_validator("batch_number", mode="before")
    @classmethod
    def normalize_batch(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip().upper()
        return v


class InventoryUnitUpdateStatus(BaseModel):
    status: UnitStatus = Field(..., description="Target unit status: AVAILABLE, LOCKED_RESERVE, DISPATCHED, TRANSFUSED, EXPIRED, QUARANTINED")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, v: Any) -> Any:
        if isinstance(v, str):
            return UnitStatus(v.strip().upper())
        return v


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

