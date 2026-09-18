from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict
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
    action: str  # "ACCEPT" or "DECLINE"
