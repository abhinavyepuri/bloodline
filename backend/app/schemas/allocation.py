from datetime import datetime
from typing import Optional, Any, List
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.allocation import AllocationSourceType, AllocationStatus


class AllocationOut(BaseModel):
    id: str
    request_id: str
    source_type: AllocationSourceType
    inventory_unit_id: Optional[str] = None
    donor_id: Optional[str] = None
    batch_number: Optional[str] = None
    blood_group: Optional[str] = None
    status: AllocationStatus
    estimated_transit_minutes: Optional[float] = None
    distance_km: Optional[float] = None
    allocated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DonorRespondRequest(BaseModel):
    action: str = Field(..., description="Action: 'ACCEPT' or 'DECLINE'")
    request_id: Optional[str] = Field(
        default=None,
        description="Optional request ID or short code (e.g. 'REQ-8492' or UUID). If omitted, resolves automatically to the active alert.",
    )
    bags_offered: Optional[int] = Field(
        default=1,
        ge=1,
        description="Number of bags the donor can supply (ACCEPT only). Capped server-side at the remaining shortfall.",
    )

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
    """
    Result of a donor accepting or declining an alert.

    ``process_donor_response`` already computes the distance, ETA and coverage
    figures; they were previously dropped on the floor because this schema did not
    declare them.
    """

    status: str
    allocation_id: Optional[str] = None
    allocation_ids: Optional[List[str]] = Field(default_factory=list, description="All allocation record IDs created for this donor response")
    donor_id: Optional[str] = None
    slot: Optional[int] = Field(None, description="Zero-based unit slot this donor claimed")
    bags_claimed: Optional[int] = Field(None, description="Number of units/bags claimed by the donor")
    distance_km: Optional[float] = None
    estimated_transit_minutes: Optional[float] = None
    bags_committed: Optional[int] = Field(None, description="Number of unit bags this donor committed to donate")
    units_covered: Optional[int] = Field(None, description="Units secured for the request so far")
    units_requested: Optional[int] = None
    shortfall: Optional[int] = Field(None, description="Units still outstanding")
    request_status: Optional[str] = Field(
        None,
        description=(
            "Status of the request itself after this response, as opposed to ``status``, "
            "which describes the outcome of the response."
        ),
    )

    model_config = ConfigDict(from_attributes=True)

