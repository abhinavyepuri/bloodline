from typing import Any
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict, field_validator
from app.core.permissions import UserRole


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    phone_number: str
    role: UserRole
    is_active: bool = True
    is_verified: bool = False

    model_config = ConfigDict(
        str_strip_whitespace=True
    )

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @field_validator("role", mode="before")
    @classmethod
    def normalize_role(cls, v: Any) -> Any:
        if isinstance(v, str):
            normalized = v.strip().upper()
            try:
                return UserRole(normalized)
            except ValueError:
                raise ValueError(f"Invalid role '{v}'. Allowed roles: {[r.value for r in UserRole]}")
        return v


class UserCreate(UserBase):
    password: str


class UserOut(UserBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

