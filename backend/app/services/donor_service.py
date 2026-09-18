"""
Donor eligibility and reliability policy.

These rules were previously declared but never enforced: ``DonorIneligibleError``
existed unused, and ``find_eligible_donors_in_proximity`` only checked
``is_available`` and blood group, so a donor who gave blood the previous day
could still be alerted and could still accept.
"""
from datetime import date, timedelta
from typing import Optional

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


def eligibility_failure_reason(
    donor: Donor, component_type: Optional[BloodComponentType] = None
) -> Optional[str]:
    """Human-readable reason the donor is ineligible, or None when eligible."""
    if not donor.is_available:
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


def is_donor_eligible(donor: Donor, component_type: Optional[BloodComponentType] = None) -> bool:
    """Whether the donor currently satisfies every clinical eligibility rule."""
    return eligibility_failure_reason(donor, component_type) is None


def ensure_donor_eligible(donor: Donor, component_type: Optional[BloodComponentType] = None) -> None:
    """Raise ``DonorIneligibleError`` when the donor may not donate right now."""
    reason = eligibility_failure_reason(donor, component_type)
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
