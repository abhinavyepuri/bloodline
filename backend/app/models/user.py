from sqlalchemy import Column, String, Boolean, Enum as SQLEnum
from app.models.base import TimestampedModel
from app.core.permissions import UserRole


class User(TimestampedModel):
    __tablename__ = "users"

    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    phone_number = Column(String, unique=True, index=True, nullable=False)
    role = Column(SQLEnum(UserRole), nullable=False, default=UserRole.DONOR)
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
