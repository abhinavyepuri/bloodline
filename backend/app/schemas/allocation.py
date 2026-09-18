from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.allocation import AllocationSourceType, AllocationStatus


class AllocationOut(BaseModel):
    id: str
    request_id: str
    source_type: AllocationSourceType
    inventory_unit_id: Optional[str] = None
    donor_id: Optional[str] = None
    status: AllocationStatus
    estimated_transit_minutes: Optional[float] = None
    distance_km: Optional[float] = None
    allocated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DonorRespondRequest(BaseModel):
    action: str = Field(..., description="Action: 'ACCEPT' or 'DECLINE'")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )

    @field_validator("action", mode="before")
    @classmethod
    def normalize_action(cls, v: Any) -> Any:
        if isinstance(v, str):
            normalized = v.strip().upper()
            if normalized not in ("ACCEPT", "DECLINE"):
                raise ValueError("Action must be either 'ACCEPT' or 'DECLINE'")
            return normalized
        return v


class DonorRespondOut(BaseModel):
    status: str
    allocation_id: Optional[str] = None
    donor_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

