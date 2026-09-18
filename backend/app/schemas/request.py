from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict
from app.models.inventory import BloodComponentType
from app.models.request import TriageLevel, RequestStatus
from app.schemas.allocation import AllocationOut


class BloodRequestCreate(BaseModel):
    patient_id_token: str
    required_blood_group: str
    component_type: BloodComponentType
    units_requested: int = 1
    triage_level: TriageLevel
    deadline_at: datetime


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
