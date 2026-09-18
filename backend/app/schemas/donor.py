from datetime import date, datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class DonorOut(BaseModel):
    id: str
    user_id: str
    blood_group: str
    date_of_birth: date
    weight_kg: float
    last_donation_date: Optional[date] = None
    is_available: bool
    reliability_score: float
    total_successful_donations: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

