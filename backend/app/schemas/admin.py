from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

class AdminOverviewOut(BaseModel):
    active_requests_count: int = Field(..., description='Count of currently pending or in-transit requests')
    available_inventory_units_count: int = Field(..., description='Count of available blood inventory units')
    active_donors_count: int = Field(..., description='Count of registered available donors')
    recent_allocations_count: int = Field(..., description='Count of recent allocations')
    system_status: str = Field(default='HEALTHY', description='Overall system operating health')

    model_config = ConfigDict(from_attributes=True)

class AdminOverrideRequest(BaseModel):
    allocation_id: Optional[str] = Field(None, description='Specific allocation to override')
    donor_id: Optional[str] = Field(None, description='Donor ID to manually assign')
    inventory_unit_id: Optional[str] = Field(None, description='Inventory unit ID to manually assign')
    reason: str = Field(..., min_length=5, description='Clinical justification for manual coordinator override')

    model_config = ConfigDict(
        extra='forbid',
        str_strip_whitespace=True
    )

class AdminOverrideOut(BaseModel):
    status: str
    message: str
    request_id: str
    allocation_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class AdminMetricsOut(BaseModel):
    mean_time_to_secure_seconds: float = Field(..., description="Mean Time to Secure (MTTS) in seconds")
    donor_acceptance_conversion_rate: float = Field(..., description="Percentage of alerted donors who accepted")
    replan_rate: float = Field(..., description="Percentage of requests that required re-planning")
    total_requests_processed: int = Field(..., description="Total emergency requests recorded")
    average_transit_distance_km: float = Field(..., description="Average distance to recipient hospital in km")

    model_config = ConfigDict(from_attributes=True)

