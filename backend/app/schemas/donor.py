from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class DonorCreate(BaseModel):
    blood_group: str
    date_of_birth: date
    weight_kg: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class DonorUpdateAvailability(BaseModel):
    is_available: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None


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
