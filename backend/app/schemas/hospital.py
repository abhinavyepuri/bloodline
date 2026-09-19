from datetime import datetime
from pydantic import BaseModel, ConfigDict


class HospitalCreate(BaseModel):
    name: str
    license_number: str
    address: str
    contact_phone: str
    latitude: float
    longitude: float


class HospitalOut(BaseModel):
    id: str
    user_id: str
    name: str
    license_number: str
    address: str
    contact_phone: str
    is_accredited: bool
    latitude: float
    longitude: float
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HospitalDirectoryOut(BaseModel):
    """Facility directory entry — enough to identify and target a hospital, no contact PII."""

    id: str
    name: str
    address: str
    is_accredited: bool
    latitude: float
    longitude: float

    model_config = ConfigDict(from_attributes=True)
