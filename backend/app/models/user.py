from sqlalchemy import Column, String, Boolean, Enum as SQLEnum, Index, func
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

    # Functional index: enables O(log n) case-insensitive email lookups via func.lower()
    # even if a future query uses func.lower(User.email) == value form
    __table_args__ = (
        Index("ix_users_email_lower", func.lower(email)),
    )
