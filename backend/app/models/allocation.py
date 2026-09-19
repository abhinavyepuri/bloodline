from enum import Enum
from typing import Optional
from sqlalchemy import Column, String, Float, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import TimestampedModel


class AllocationSourceType(str, Enum):
    BLOOD_BANK_INVENTORY = "BLOOD_BANK_INVENTORY"
    LIVE_DONOR = "LIVE_DONOR"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            normalized = value.strip().upper()
            for member in cls:
                if member.value == normalized:
                    return member
        return super()._missing_(value)


class AllocationStatus(str, Enum):
    SOFT_LOCKED = "SOFT_LOCKED"
    HARD_LOCKED = "HARD_LOCKED"
    IN_TRANSIT = "IN_TRANSIT"
    COMPLETED = "COMPLETED"
    CANCELLED_BY_DONOR = "CANCELLED_BY_DONOR"
    TIMED_OUT = "TIMED_OUT"
    RE_OPTIMIZED = "RE_OPTIMIZED"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            normalized = value.strip().upper()
            for member in cls:
                if member.value == normalized:
                    return member
        return super()._missing_(value)


# Allocation states that mean a unit is genuinely secured for the request. Both the
# allocation service and the request model derive coverage from this single tuple so
# the two can never disagree about what "covered" means.
COVERING_ALLOCATION_STATUSES = (
    AllocationStatus.HARD_LOCKED,
    AllocationStatus.IN_TRANSIT,
    AllocationStatus.COMPLETED,
)



class Allocation(TimestampedModel):
    __tablename__ = "allocations"

    request_id = Column(String, ForeignKey("blood_requests.id", ondelete="CASCADE"), nullable=False)
    source_type = Column(SQLEnum(AllocationSourceType), nullable=False)
    
    # Target resource references
    inventory_unit_id = Column(String, ForeignKey("inventory_units.id"), nullable=True)
    donor_id = Column(String, ForeignKey("donors.id"), nullable=True)
    
    status = Column(SQLEnum(AllocationStatus), default=AllocationStatus.SOFT_LOCKED, index=True, nullable=False)
    estimated_transit_minutes = Column(Float, nullable=True)
    distance_km = Column(Float, nullable=True)
    allocated_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    request = relationship("BloodRequest", back_populates="allocations")
    inventory_unit = relationship("InventoryUnit")
    donor = relationship("Donor")

    @property
    def batch_number(self) -> Optional[str]:
        unit = self.__dict__.get("inventory_unit")
        return unit.batch_number if unit is not None else None

    @property
    def blood_group(self) -> Optional[str]:
        unit = self.__dict__.get("inventory_unit")
        if unit is not None:
            return unit.blood_group
        donor = self.__dict__.get("donor")
        if donor is not None:
            return donor.blood_group
        return None
