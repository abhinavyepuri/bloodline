from datetime import date, datetime
from typing import Optional
from enum import Enum
from pydantic import BaseModel, ConfigDict, Field


class HealthEligibilityStatus(str, Enum):
    ELIGIBLE = "ELIGIBLE"
    TEMPORARILY_DEFERRED = "TEMPORARILY_DEFERRED"
    PERMANENTLY_DEFERRED = "PERMANENTLY_DEFERRED"


class HealthReportCreate(BaseModel):
    hemoglobin_g_dl: float = Field(..., ge=5.0, le=25.0, description="Hemoglobin level in g/dL (min 12.5 required for donation)")
    systolic_bp: int = Field(..., ge=60, le=240, description="Systolic blood pressure mmHg (safe: 90-140)")
    diastolic_bp: int = Field(..., ge=40, le=140, description="Diastolic blood pressure mmHg (safe: 60-90)")
    pulse_bpm: int = Field(..., ge=40, le=180, description="Resting heart rate in beats per minute (safe: 60-100)")
    temperature_c: float = Field(..., ge=34.0, le=42.0, description="Body temperature in Celsius (normal: 36.0-37.5)")
    weight_kg: float = Field(..., ge=30.0, le=250.0, description="Donor body weight in kilograms (min 50.0kg required)")
    blood_glucose_mg_dl: Optional[float] = Field(None, ge=40.0, le=500.0, description="Blood glucose mg/dL")

    # Infectious disease screening tests
    hiv_status: str = Field(default="NEGATIVE", description="HIV I/II screening result")
    hepb_status: str = Field(default="NEGATIVE", description="Hepatitis B (HBsAg) result")
    hepc_status: str = Field(default="NEGATIVE", description="Hepatitis C (HCV) result")
    syphilis_status: str = Field(default="NEGATIVE", description="Syphilis (VDRL) result")
    malaria_status: str = Field(default="NEGATIVE", description="Malaria screening result")

    doctor_remarks: Optional[str] = Field(None, description="Doctor or clinical notes")
    doctor_name: Optional[str] = Field(default="Dr. Sarah Lin, MD", description="Examining physician name")
    facility_name: Optional[str] = Field(default="Central Transfusion Clinical Lab", description="Testing clinical facility")

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class HealthReportOut(BaseModel):
    id: str
    donor_id: str
    report_code: str
    hemoglobin_g_dl: float
    systolic_bp: int
    diastolic_bp: int
    pulse_bpm: int
    temperature_c: float
    weight_kg: float
    blood_glucose_mg_dl: Optional[float] = None
    hiv_status: str
    hepb_status: str
    hepc_status: str
    syphilis_status: str
    malaria_status: str
    eligibility_status: HealthEligibilityStatus
    deferral_reason: Optional[str] = None
    deferral_end_date: Optional[date] = None
    doctor_name: Optional[str] = None
    facility_name: Optional[str] = None
    doctor_remarks: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
