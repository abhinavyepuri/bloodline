from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.inventory import BloodComponentType
from app.models.request import TriageLevel, RequestStatus
from app.schemas.allocation import AllocationOut


class BloodRequestCreate(BaseModel):
    patient_id_token: str = Field(..., min_length=1, description="Unique anonymized patient or case identifier")
    required_blood_group: str = Field(..., min_length=1, max_length=5, description="Blood group e.g. O+, O-, A+, AB-")
    component_type: BloodComponentType = Field(..., description="WHOLE_BLOOD, PRBC, PLATELETS, FFP, CRYOPRECIPITATE")
    units_requested: int = Field(default=1, ge=1, description="Number of blood units needed")
    triage_level: TriageLevel = Field(..., description="Triage priority level")
    deadline_at: datetime = Field(..., description="Clinical deadline / required-by timestamp")

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


class BloodRequestOut(BaseModel):
    id: str
    hospital_id: str
    patient_id_token: str
    required_blood_group: str
    component_type: BloodComponentType
    units_requested: int
    triage_level: TriageLevel
    calculated_urgency_score: float
    deadline_at: datetime
    status: RequestStatus
    created_at: datetime
    allocations: List[AllocationOut] = []

    model_config = ConfigDict(from_attributes=True)
