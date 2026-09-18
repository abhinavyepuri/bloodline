from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from sqlalchemy import Column, String, Integer, Float, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import TimestampedModel
from app.models.allocation import COVERING_ALLOCATION_STATUSES
from app.models.inventory import BloodComponentType


class TriageLevel(str, Enum):
    MASSIVE_TRANSFUSION_PROTOCOL = "MASSIVE_TRANSFUSION_PROTOCOL"  # Level 1: Immediate life threat (<15m)
    ACTIVE_TRAUMA = "ACTIVE_TRAUMA"                                # Level 2: Urgent (<1 hour)
    SCHEDULED_EMERGENCY_RESERVE = "SCHEDULED_EMERGENCY_RESERVE"    # Level 3: Scheduled urgent surgery (<4 hours)
    ROUTINE_CLINICAL = "ROUTINE_CLINICAL"                          # Level 4: Standard replenishment (<24 hours)

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            normalized = value.strip().upper()
            for member in cls:
                if member.value == normalized:
                    return member
        return super()._missing_(value)


class RequestStatus(str, Enum):
    PENDING_EVALUATION = "PENDING_EVALUATION"
    PROXIMITY_ZONE_NOTIFIED = "PROXIMITY_ZONE_NOTIFIED"
    COMMITTED_IN_TRANSIT = "COMMITTED_IN_TRANSIT"
    RE_PLANNING = "RE_PLANNING"
    FULFILLED = "FULFILLED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            normalized = value.strip().upper()
            for member in cls:
                if member.value == normalized:
                    return member
        return super()._missing_(value)



class BloodRequest(TimestampedModel):
    __tablename__ = "blood_requests"

    hospital_id = Column(String, ForeignKey("hospitals.id", ondelete="CASCADE"), nullable=False)
    patient_id_token = Column(String, index=True, nullable=False)
    required_blood_group = Column(String, index=True, nullable=False)
    component_type = Column(SQLEnum(BloodComponentType), nullable=False)
    units_requested = Column(Integer, nullable=False, default=1)
    triage_level = Column(SQLEnum(TriageLevel), nullable=False)
    calculated_urgency_score = Column(Float, default=0.0, nullable=False)  # 0 to 100
    deadline_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(SQLEnum(RequestStatus), default=RequestStatus.PENDING_EVALUATION, index=True, nullable=False)

    hospital = relationship("Hospital", backref="requests")
    allocations = relationship("Allocation", back_populates="request")

    # -- Derived read-only views -------------------------------------------------
    # These are plain properties so Pydantic's ``from_attributes`` picks them up
    # without any serialization-time mutation of the ORM object. Each reads through
    # ``self.__dict__`` so an unloaded relationship yields None/0 rather than
    # triggering a lazy load (which would raise under asyncio).

    @property
    def hospital_name(self) -> Optional[str]:
        hospital = self.__dict__.get("hospital")
        return hospital.name if hospital is not None else None

    @property
    def hospital_address(self) -> Optional[str]:
        hospital = self.__dict__.get("hospital")
        return hospital.address if hospital is not None else None

    @property
    def units_covered(self) -> int:
        """Units genuinely secured so far — drives the "2 of 4 covered" display."""
        allocations = self.__dict__.get("allocations")
        if not allocations:
            return 0
        return sum(1 for a in allocations if a.status in COVERING_ALLOCATION_STATUSES)

    @property
    def units_shortfall(self) -> int:
        """Units still outstanding; never negative."""
        return max(self.units_requested - self.units_covered, 0)
