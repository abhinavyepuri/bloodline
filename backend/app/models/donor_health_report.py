from datetime import date
from enum import Enum
from sqlalchemy import Column, String, Float, Integer, Date, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from app.models.base import TimestampedModel


class HealthEligibilityStatus(str, Enum):
    ELIGIBLE = "ELIGIBLE"
    TEMPORARILY_DEFERRED = "TEMPORARILY_DEFERRED"
    PERMANENTLY_DEFERRED = "PERMANENTLY_DEFERRED"


class DonorHealthReport(TimestampedModel):
    __tablename__ = "donor_health_reports"

    donor_id = Column(String, ForeignKey("donors.id", ondelete="CASCADE"), nullable=False, index=True)
    report_code = Column(String, unique=True, nullable=False, index=True)  # e.g., "HR-2026-0042"
    
    # Clinical Vitals
    hemoglobin_g_dl = Column(Float, nullable=False)  # Normal >= 12.5 g/dL
    systolic_bp = Column(Integer, nullable=False)     # Normal 90-140 mmHg
    diastolic_bp = Column(Integer, nullable=False)    # Normal 60-90 mmHg
    pulse_bpm = Column(Integer, nullable=False)       # Normal 60-100 bpm
    temperature_c = Column(Float, nullable=False)     # Normal 36.0 - 37.5 C
    weight_kg = Column(Float, nullable=False)         # Min >= 50.0 kg
    blood_glucose_mg_dl = Column(Float, nullable=True)

    # Infectious Disease Screening (Serology)
    hiv_status = Column(String, default="NEGATIVE", nullable=False)
    hepb_status = Column(String, default="NEGATIVE", nullable=False)
    hepc_status = Column(String, default="NEGATIVE", nullable=False)
    syphilis_status = Column(String, default="NEGATIVE", nullable=False)
    malaria_status = Column(String, default="NEGATIVE", nullable=False)

    # Clinical Decision & Clearance
    eligibility_status = Column(
        SQLEnum(HealthEligibilityStatus),
        default=HealthEligibilityStatus.ELIGIBLE,
        nullable=False,
        index=True
    )
    deferral_reason = Column(String, nullable=True)
    deferral_end_date = Column(Date, nullable=True)

    # Doctor / Facility Information
    doctor_name = Column(String, default="Dr. Sarah Lin, MD", nullable=True)
    facility_name = Column(String, default="Central Transfusion Clinical Lab", nullable=True)
    doctor_remarks = Column(String, nullable=True)
