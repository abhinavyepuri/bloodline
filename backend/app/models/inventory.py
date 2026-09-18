from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import Column, String, Float, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import TimestampedModel


class BloodComponentType(str, Enum):
    WHOLE_BLOOD = "WHOLE_BLOOD"
    PRBC = "PRBC"  # Packed Red Blood Cells
    PLATELETS = "PLATELETS"
    FFP = "FFP"    # Fresh Frozen Plasma
    CRYOPRECIPITATE = "CRYOPRECIPITATE"


class UnitStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    LOCKED_RESERVE = "LOCKED_RESERVE"
    DISPATCHED = "DISPATCHED"
    TRANSFUSED = "TRANSFUSED"
    EXPIRED = "EXPIRED"
    QUARANTINED = "QUARANTINED"


class InventoryUnit(TimestampedModel):
    __tablename__ = "inventory_units"

    blood_bank_id = Column(String, ForeignKey("blood_banks.id", ondelete="CASCADE"), nullable=False)
    batch_number = Column(String, unique=True, index=True, nullable=False)
    blood_group = Column(String, index=True, nullable=False)  # e.g., "O-", "A+"
    component_type = Column(SQLEnum(BloodComponentType), nullable=False)
    volume_ml = Column(Float, nullable=False, default=450.0)
    collection_date = Column(DateTime(timezone=True), nullable=False)
    expiry_date = Column(DateTime(timezone=True), index=True, nullable=False)
    status = Column(SQLEnum(UnitStatus), default=UnitStatus.AVAILABLE, index=True, nullable=False)
    lock_expires_at = Column(DateTime(timezone=True), nullable=True)

    blood_bank = relationship("BloodBank", back_populates="inventory_units")
