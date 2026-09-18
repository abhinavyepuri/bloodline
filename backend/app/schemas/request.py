from datetime import datetime, timezone
from typing import Optional, List, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.inventory import BloodComponentType
from app.models.request import TriageLevel, RequestStatus
from app.schemas.allocation import AllocationOut


def _as_utc(value: Any) -> Any:
    """
    Normalise datetimes to timezone-aware UTC.

    The rest of the system (DB columns, ``matching_service`` deadline maths) works
    in UTC, so a naive timestamp is interpreted as UTC rather than compared against
    an aware ``now`` — which raised ``TypeError`` and 500'd the request.
    """
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class BloodRequestCreate(BaseModel):
    patient_id_token: str = Field(..., min_length=1, description="Unique anonymized patient or case identifier")
    required_blood_group: str = Field(..., min_length=1, max_length=5, description="Blood group e.g. O+, O-, A+, AB-")
    component_type: BloodComponentType = Field(..., description="WHOLE_BLOOD, PRBC, PLATELETS, FFP, CRYOPRECIPITATE")
    units_requested: int = Field(default=1, ge=1, description="Number of blood units needed")
    triage_level: TriageLevel = Field(..., description="Triage priority level")
    deadline_at: datetime = Field(..., description="Clinical deadline / required-by timestamp (UTC; naive input is assumed UTC)")
    hospital_id: Optional[str] = Field(
        default=None,
        description=(
            "Target hospital. Required for coordinator/admin callers, who have no "
            "hospital profile of their own; ignored for hospital accounts, which "
            "always request on behalf of their own facility."
        ),
    )

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )

    @field_validator("required_blood_group", mode="before")
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

    @field_validator("triage_level", mode="before")
    @classmethod
    def normalize_triage_level(cls, v: Any) -> Any:
        if isinstance(v, str):
            return TriageLevel(v.strip().upper())
        return v

    @field_validator("deadline_at", mode="before")
    @classmethod
    def normalize_deadline(cls, v: Any) -> Any:
        return _as_utc(v)


class BloodRequestOut(BaseModel):
    id: str
    code: Optional[str] = Field(None, description="Clean human-readable short code (e.g. 'REQ-8492')")
    hospital_id: str
    hospital_name: Optional[str] = None
    hospital_address: Optional[str] = None
    patient_id_token: str
    required_blood_group: str
    component_type: BloodComponentType
    units_requested: int
    units_covered: int = 0
    units_shortfall: int = 0
    alert_expires_in_seconds: Optional[int] = Field(
        default=None,
        description=(
            "Seconds left for a donor to respond. Populated only on the donor-facing "
            "alert feed, where it drives the response countdown."
        ),
    )
    triage_level: TriageLevel
    calculated_urgency_score: float
    deadline_at: datetime
    status: RequestStatus
    created_at: datetime
    allocations: List[AllocationOut] = []

    model_config = ConfigDict(from_attributes=True)
