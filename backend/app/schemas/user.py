from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict
from app.core.permissions import UserRole


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    phone_number: str
    role: UserRole
    is_active: bool = True
    is_verified: bool = False


class UserCreate(UserBase):
    password: str


class UserOut(UserBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
