"""
Donor eligibility and reliability policy.

These rules were previously declared but never enforced: ``DonorIneligibleError``
existed unused, and ``find_eligible_donors_in_proximity`` only checked
``is_available`` and blood group, so a donor who gave blood the previous day
could still be alerted and could still accept.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from app.core.config import settings
from app.core.exceptions import DonorIneligibleError
from app.models.donor import Donor
from app.models.inventory import BloodComponentType

# Components that follow the plasma compatibility matrix. Note this is narrower
# than the short-interval set below: platelets carry ABO antigens and do not
# follow plasma rules.
PLASMA_MATRIX_COMPONENTS = frozenset(
    {BloodComponentType.FFP, BloodComponentType.CRYOPRECIPITATE}
)

# Components collected by apheresis, which use the shorter recovery window.
SHORT_INTERVAL_COMPONENTS = frozenset(
    {
        BloodComponentType.PLATELETS,
        BloodComponentType.FFP,
        BloodComponentType.CRYOPRECIPITATE,
    }
)

# Whole-blood donors must meet a minimum body weight for a safe draw.
MIN_DONOR_WEIGHT_KG = 50.0

# Clinical health screening safety thresholds (AABB & Transfusion Medicine standards)
MIN_HEMOGLOBIN_G_DL = 12.5
MIN_SYSTOLIC_BP = 90
MAX_SYSTOLIC_BP = 140
MIN_DIASTOLIC_BP = 60
MAX_DIASTOLIC_BP = 90
MAX_TEMPERATURE_C = 37.5
MIN_PULSE_BPM = 50
MAX_PULSE_BPM = 100

# Exponential moving average weight applied to each dispatch outcome.
RELIABILITY_LEARNING_RATE = 0.1


def is_plasma_derived(component_type: Optional[BloodComponentType]) -> bool:
    """Whether this component uses the plasma compatibility matrix."""
    return component_type in PLASMA_MATRIX_COMPONENTS


def donation_interval_days(component_type: Optional[BloodComponentType] = None) -> int:
    """Recovery window required between donations for the given component."""
    if component_type in SHORT_INTERVAL_COMPONENTS:
        return settings.PLATELET_DONATION_INTERVAL_DAYS
    return settings.WHOLE_BLOOD_DONATION_INTERVAL_DAYS


def next_eligible_date(
    donor: Donor, component_type: Optional[BloodComponentType] = None
) -> Optional[date]:
    """The earliest date this donor may donate again, or None if never donated."""
    if not donor.last_donation_date:
        return None
    return donor.last_donation_date + timedelta(days=donation_interval_days(component_type))


from app.models.donor_health_report import HealthEligibilityStatus


def evaluate_health_vitals(
    hemoglobin_g_dl: float,
    systolic_bp: int,
    diastolic_bp: int,
    pulse_bpm: int,
    temperature_c: float,
    weight_kg: float,
    hiv_status: str = "NEGATIVE",
    hepb_status: str = "NEGATIVE",
    hepc_status: str = "NEGATIVE",
    syphilis_status: str = "NEGATIVE",
    malaria_status: str = "NEGATIVE",
) -> tuple[HealthEligibilityStatus, Optional[str], Optional[date]]:
    """
    Clinically evaluate volunteer vital signs and lab results according to
    AABB / Transfusion Medicine safety protocols.
    Returns (HealthEligibilityStatus, deferral_reason, deferral_end_date).
    """
    today = date.today()

    # 1. Chronic Infectious Disease Screenings (Permanent Deferral)
    chronic_reactive = []
    if hiv_status.upper() in ("POSITIVE", "REACTIVE"):
        chronic_reactive.append("HIV")
    if hepb_status.upper() in ("POSITIVE", "REACTIVE"):
        chronic_reactive.append("Hepatitis B")
    if hepc_status.upper() in ("POSITIVE", "REACTIVE"):
        chronic_reactive.append("Hepatitis C")
    if chronic_reactive:
        return (
            HealthEligibilityStatus.PERMANENTLY_DEFERRED,
            f"Reactive serology test result ({', '.join(chronic_reactive)}). Permanent deferral.",
            None,
        )

    # 2. Treatable Infectious Screenings (Temporary Deferral)
    if syphilis_status.upper() in ("POSITIVE", "REACTIVE"):
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            "Reactive Syphilis (VDRL) screening. 12-month deferral post-treatment required.",
            today + timedelta(days=365),
        )
    if malaria_status.upper() in ("POSITIVE", "REACTIVE"):
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            "Positive Malaria screening. 90-day recovery window required.",
            today + timedelta(days=90),
        )

    # 3. Hemoglobin Safety Threshold (minimum 12.5 g/dL)
    if hemoglobin_g_dl < MIN_HEMOGLOBIN_G_DL:
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            f"Low hemoglobin ({hemoglobin_g_dl} g/dL). Minimum {MIN_HEMOGLOBIN_G_DL} g/dL required for donor safety.",
            today + timedelta(days=30),
        )

    # 4. Donor Body Weight (minimum 50.0 kg)
    if weight_kg < MIN_DONOR_WEIGHT_KG:
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            f"Body weight ({weight_kg} kg) is below the {MIN_DONOR_WEIGHT_KG} kg minimum for safe donation draw.",
            today + timedelta(days=30),
        )

    # 5. Blood Pressure Parameters (90-140 systolic / 60-90 diastolic)
    if systolic_bp > MAX_SYSTOLIC_BP or systolic_bp < MIN_SYSTOLIC_BP or diastolic_bp > MAX_DIASTOLIC_BP or diastolic_bp < MIN_DIASTOLIC_BP:
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            f"Blood pressure ({systolic_bp}/{diastolic_bp} mmHg) outside safe range ({MIN_SYSTOLIC_BP}-{MAX_SYSTOLIC_BP}/{MIN_DIASTOLIC_BP}-{MAX_DIASTOLIC_BP} mmHg).",
            today + timedelta(days=14),
        )

    # 6. Body Temperature (normal <= 37.5 C)
    if temperature_c > MAX_TEMPERATURE_C:
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            f"Elevated body temperature ({temperature_c}°C). Possible active infection.",
            today + timedelta(days=7),
        )

    # 7. Pulse Rate (60-100 bpm)
    if pulse_bpm < MIN_PULSE_BPM or pulse_bpm > MAX_PULSE_BPM:
        return (
            HealthEligibilityStatus.TEMPORARILY_DEFERRED,
            f"Resting pulse rate ({pulse_bpm} bpm) outside safe clinical bounds ({MIN_PULSE_BPM}-{MAX_PULSE_BPM} bpm).",
            today + timedelta(days=7),
        )

    # All vitals verified within clinical specifications
    return HealthEligibilityStatus.ELIGIBLE, None, None


def eligibility_failure_reason(
    donor: Donor,
    component_type: Optional[BloodComponentType] = None,
    latest_report: Optional[Any] = None,
    ignore_availability: bool = False,
) -> Optional[str]:
    """Human-readable reason the donor is ineligible, or None when eligible."""
    # Check Clinical Health Report FIRST so specific medical reasons are returned
    report = latest_report
    if report is None and hasattr(donor, "health_reports") and donor.health_reports:
        report = max(
            donor.health_reports,
            key=lambda r: getattr(r, "created_at", None) or datetime.min.replace(tzinfo=timezone.utc),
        )

    if report is not None:
        if report.eligibility_status == HealthEligibilityStatus.PERMANENTLY_DEFERRED:
            return f"Volunteer is permanently deferred from blood donation: {report.deferral_reason or 'clinical ineligibility'}"
        
        if report.eligibility_status == HealthEligibilityStatus.TEMPORARILY_DEFERRED:
            if report.deferral_end_date and date.today() < report.deferral_end_date:
                days_left = (report.deferral_end_date - date.today()).days
                return (
                    f"Volunteer is temporarily deferred for {days_left} more day(s) until {report.deferral_end_date}: "
                    f"{report.deferral_reason or 'health recovery required'}"
                )
            elif not report.deferral_end_date:
                return f"Volunteer is temporarily deferred: {report.deferral_reason or 'medical clearance required'}"

        if report.hemoglobin_g_dl is not None and report.hemoglobin_g_dl < MIN_HEMOGLOBIN_G_DL:
            return f"Volunteer hemoglobin {report.hemoglobin_g_dl} g/dL is below the required {MIN_HEMOGLOBIN_G_DL} g/dL safety threshold"

        if report.weight_kg is not None and report.weight_kg < MIN_DONOR_WEIGHT_KG:
            return f"Volunteer body weight {report.weight_kg} kg is below the required {MIN_DONOR_WEIGHT_KG} kg threshold"

    if not ignore_availability and not donor.is_available:
        return "donor is not currently marked available"

    if donor.weight_kg is None or donor.weight_kg < MIN_DONOR_WEIGHT_KG:
        return (
            f"donor weight {donor.weight_kg}kg is below the "
            f"{MIN_DONOR_WEIGHT_KG}kg minimum for a safe donation"
        )

    eligible_from = next_eligible_date(donor, component_type)
    if eligible_from is not None and date.today() < eligible_from:
        days_left = (eligible_from - date.today()).days
        return (
            f"donor must wait {days_left} more day(s) before donating again "
            f"({donation_interval_days(component_type)}-day recovery window)"
        )

    return None


def is_donor_eligible(
    donor: Donor,
    component_type: Optional[BloodComponentType] = None,
    latest_report: Optional[Any] = None,
    ignore_availability: bool = False,
) -> bool:
    """Whether the donor currently satisfies every clinical eligibility rule."""
    return eligibility_failure_reason(donor, component_type, latest_report, ignore_availability) is None


def ensure_donor_eligible(
    donor: Donor,
    component_type: Optional[BloodComponentType] = None,
    latest_report: Optional[Any] = None,
    ignore_availability: bool = False,
) -> None:
    """Raise ``DonorIneligibleError`` when the donor may not donate right now."""
    reason = eligibility_failure_reason(donor, component_type, latest_report, ignore_availability)
    if reason:
        raise DonorIneligibleError(reason)


def record_donor_outcome(donor: Donor, success: bool) -> None:
    """
    Fold one dispatch outcome into the donor's reliability score using an
    exponential moving average, and advance donation history on success.
    """
    target = 1.0 if success else 0.0
    current = donor.reliability_score if donor.reliability_score is not None else 0.5
    updated = current + RELIABILITY_LEARNING_RATE * (target - current)
    donor.reliability_score = round(min(1.0, max(0.0, updated)), 4)

    if success:
        donor.total_successful_donations = (donor.total_successful_donations or 0) + 1
        donor.last_donation_date = date.today()
