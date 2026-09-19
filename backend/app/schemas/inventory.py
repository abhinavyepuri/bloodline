from datetime import datetime, timezone
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.inventory import BloodComponentType, UnitStatus


def _as_utc(value: Any) -> Any:
    """Shelf-life comparisons are done against an aware ``now``; naive input means UTC."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class InventoryUnitCreate(BaseModel):
    batch_number: str = Field(..., min_length=1, description="Unique unit batch number")
    blood_group: str = Field(..., min_length=1, max_length=5, description="Blood group e.g. O+, A-")
    component_type: BloodComponentType = Field(..., description="WHOLE_BLOOD, PRBC, PLATELETS, FFP, CRYOPRECIPITATE")
    volume_ml: float = Field(default=450.0, gt=0.0, description="Unit volume in mL")
    collection_date: datetime = Field(..., description="Date/time of blood collection (UTC; naive input is assumed UTC)")
    expiry_date: datetime = Field(..., description="Expiration timestamp under cold storage (UTC; naive input is assumed UTC)")
    blood_bank_id: Optional[str] = Field(
        default=None,
        description=(
            "Owning blood bank. Required for coordinator/admin callers; ignored for "
            "blood bank accounts, whose own bank always owns the stock they register."
        ),
    )

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

    @field_validator("collection_date", "expiry_date", mode="before")
    @classmethod
    def normalize_timestamps(cls, v: Any) -> Any:
        return _as_utc(v)



class InventoryBatchItem(BaseModel):
    batch_number: Optional[str] = Field(default=None, description="Unique batch number, auto-generated if omitted")
    blood_group: str = Field(..., min_length=1, max_length=5, description="Blood group e.g. O+, A-")
    component_type: BloodComponentType = Field(..., description="WHOLE_BLOOD, PRBC, PLATELETS, FFP, CRYOPRECIPITATE")
    volume_ml: float = Field(default=450.0, gt=0.0, description="Unit volume in mL")
    collection_date: Optional[datetime] = Field(default=None, description="Collection timestamp (UTC, defaults to now)")
    expiry_date: Optional[datetime] = Field(default=None, description="Expiry timestamp (UTC, computed from expiry_days if omitted)")
    expiry_days: Optional[int] = Field(default=None, ge=1, le=365, description="Shelf life in days")
    quantity: int = Field(default=1, ge=1, le=200, description="Number of packets with this configuration")
    blood_bank_id: Optional[str] = Field(default=None, description="Target blood bank for elevated roles")

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
        if isinstance(v, str) and v.strip():
            return v.strip().upper()
        return None

    @field_validator("collection_date", "expiry_date", mode="before")
    @classmethod
    def normalize_timestamps(cls, v: Any) -> Any:
        return _as_utc(v)


class InventoryBatchCreate(BaseModel):
    """
    Supports either:
    1) An explicit list of batch items (`items`)
    2) A bulk generator specification (`blood_group`, `component_type`, `quantity`, etc.)
    3) Or both combined
    """
    items: Optional[list[InventoryBatchItem]] = Field(
        default=None,
        description="Explicit list of batch item specifications"
    )
    # Bulk generator fields for single-type batch additions
    blood_group: Optional[str] = Field(default=None, min_length=1, max_length=5, description="Blood group e.g. O+, A-")
    component_type: Optional[BloodComponentType] = Field(default=None, description="Component type")
    quantity: Optional[int] = Field(default=None, ge=1, le=200, description="Number of packets to create")
    batch_prefix: Optional[str] = Field(default=None, description="Prefix for generated batch codes (e.g. BB-DRIVE-)")
    volume_ml: Optional[float] = Field(default=450.0, gt=0.0, description="Volume per unit in mL")
    collection_date: Optional[datetime] = Field(default=None, description="Collection timestamp (UTC, defaults to now)")
    expiry_date: Optional[datetime] = Field(default=None, description="Expiry timestamp (UTC, defaults to collection + expiry_days)")
    expiry_days: Optional[int] = Field(default=None, ge=1, le=365, description="Shelf life in days")
    blood_bank_id: Optional[str] = Field(default=None, description="Owning blood bank id (for admin/coordinator)")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )

    @field_validator("blood_group", mode="before")
    @classmethod
    def normalize_blood_group(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip():
            return v.strip().upper()
        return v

    @field_validator("component_type", mode="before")
    @classmethod
    def normalize_component_type(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip():
            return BloodComponentType(v.strip().upper())
        return v

    @field_validator("batch_prefix", mode="before")
    @classmethod
    def normalize_batch_prefix(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip():
            return v.strip().upper()
        return v

    @field_validator("collection_date", "expiry_date", mode="before")
    @classmethod
    def normalize_timestamps(cls, v: Any) -> Any:
        return _as_utc(v)


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


