from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import Column, String, Integer, Float, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import TimestampedModel
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
