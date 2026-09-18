from datetime import datetime
from pydantic import BaseModel, ConfigDict


class BloodBankCreate(BaseModel):
    name: str
    license_number: str
    address: str
    contact_phone: str
    latitude: float
    longitude: float


class BloodBankOut(BaseModel):
    id: str
    user_id: str
    name: str
    license_number: str
    address: str
    contact_phone: str
    latitude: float
    longitude: float
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
