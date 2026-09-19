from datetime import date, datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator


class DonorCreate(BaseModel):
    blood_group: str = Field(..., min_length=1, max_length=5, description="Donor blood group e.g. O+, A-")
    date_of_birth: date = Field(..., description="Date of birth")
    weight_kg: float = Field(..., gt=40.0, le=300.0, description="Weight in kilograms (min 40kg for safety)")
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0, description="Latitude in degrees")
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0, description="Longitude in degrees")

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


class DonorUpdateAvailability(BaseModel):
    is_available: bool = Field(..., description="Availability toggle for emergency dispatch")
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0, description="Current GPS latitude")
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0, description="Current GPS longitude")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )


from app.schemas.health_report import HealthReportOut


class DonationHistoryItem(BaseModel):
    id: str
    request_id: Optional[str] = None
    request_code: Optional[str] = None
    hospital_name: Optional[str] = None
    hospital_address: Optional[str] = None
    component_type: str = "WHOLE_BLOOD"
    blood_group: str
    units: int = 1
    status: str
    donated_at: str
    distance_km: Optional[float] = None
    notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DonorOut(BaseModel):
    id: str
    user_id: str
    blood_group: str
    date_of_birth: date
    weight_kg: float
    last_donation_date: Optional[date] = None
    next_eligible_date: Optional[date] = None
    days_until_eligible: Optional[int] = 0
    interval_days_since_last_donation: Optional[int] = None
    account_donation_status: Optional[str] = None
    cooling_period_active: bool = False
    is_fit_to_donate: bool = True
    clinical_eligibility_reason: Optional[str] = None
    is_available: bool
    reliability_score: float
    total_successful_donations: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_updated_at: Optional[datetime] = None
    latest_health_report: Optional[HealthReportOut] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DonorHeartbeatIn(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Current GPS latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Current GPS longitude")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class DonorPublicOut(BaseModel):
    """
    Cross-tenant view of a donor.

    ``DonorOut`` carries date of birth, body weight, exact home coordinates and the
    owning ``user_id``. None of that is needed to plan a donation, so any listing
    that crosses tenants returns this reduced shape instead. ``reliability_score``
    stays because the blood bank and coordinator dashboards rank candidates by it.
    """

    id: str
    blood_group: str
    is_available: bool
    reliability_score: float
    total_successful_donations: int
    last_donation_date: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)


class DonorTelemetryIn(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Current GPS latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Current GPS longitude")
    speed_kmh: Optional[float] = Field(None, ge=0.0, description="Current movement speed in km/h")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class DonorTelemetryOut(BaseModel):
    donor_id: str
    latitude: float
    longitude: float
    active_allocation_id: Optional[str] = None
    hospital_id: Optional[str] = None
    hospital_name: Optional[str] = None
    distance_to_hospital_km: Optional[float] = None
    estimated_eta_minutes: Optional[int] = None
    is_approaching_ward: bool = False
    message: str

    model_config = ConfigDict(from_attributes=True)

    # Web client historically read allocation-style names (distance_km / ETA /
    # geofence_triggered). Emit both so the dashboard never shows 0 km / 1 min
    # just because it looked at the wrong key.
    @computed_field
    @property
    def distance_km(self) -> Optional[float]:
        return self.distance_to_hospital_km

    @computed_field
    @property
    def estimated_transit_minutes(self) -> Optional[int]:
        return self.estimated_eta_minutes

    @computed_field
    @property
    def geofence_triggered(self) -> bool:
        return self.is_approaching_ward


