from typing import Optional, Any
from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict
from app.core.permissions import UserRole
from app.schemas.user import UserOut


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: str
    full_name: str
    user: Optional[UserOut] = None

    model_config = ConfigDict(from_attributes=True)


class TokenPayload(BaseModel):
    sub: Optional[str] = None
    role: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr = Field(..., description="Registered email address")
    password: str = Field(..., min_length=1, description="Account password")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True
    )

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip().lower()
        return v


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="User unique email address")
    password: str = Field(..., min_length=6, description="Account password (min 6 chars)")
    full_name: str = Field(..., min_length=1, max_length=120, description="Full name or entity name")
    phone_number: str = Field(..., min_length=5, max_length=30, description="Contact phone number")
    role: UserRole = Field(..., description="Role: HOSPITAL, BLOOD_BANK, DONOR, COORDINATOR, ADMIN")
    blood_group: Optional[str] = Field(None, description="Donor blood group (e.g. O-, O+, A-, A+, B-, B+, AB-, AB+)")
    facility_address: Optional[str] = Field(None, description="Hospital or Blood Bank physical address")

    model_config = ConfigDict(
        extra="forbid",
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

