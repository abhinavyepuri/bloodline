"""
Data Harmonization Adapter between SmartBlood transactional schema and frozen ML artifacts.
"""

from typing import Optional, Set, Union
from app.core.config import settings

try:
    from app.models.inventory import BloodComponentType
except ImportError:
    from enum import Enum
    class BloodComponentType(str, Enum):
        WHOLE_BLOOD = "WHOLE_BLOOD"
        PRBC = "PRBC"
        PLATELETS = "PLATELETS"
        FFP = "FFP"
        CRYOPRECIPITATE = "CRYOPRECIPITATE"

VALID_BLOOD_GROUPS: Set[str] = {"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}

ML_SUPPORTED_COMPONENTS: Set[str] = {"PRBC", "Platelets", "FFP"}

COMPONENT_SHELF_LIFE_DAYS = {
    "Platelets": 5,
    "PLATELETS": 5,
    "PRBC": 42,
    "FFP": 365,
    "WHOLE_BLOOD": 35,
    "CRYOPRECIPITATE": 365,
}


def to_ml_component(comp: Union[BloodComponentType, str]) -> Optional[str]:
    """
    Convert application BloodComponentType enum or string to exact casing expected
    by the trained OneHotEncoder preprocessors.

    Returns None for components outside the ML training set (WHOLE_BLOOD, CRYOPRECIPITATE).
    """
    raw = comp.value if isinstance(comp, BloodComponentType) else str(comp)
    normalized = raw.strip().upper()

    if normalized == "PLATELETS":
        return "Platelets"
    elif normalized == "PRBC":
        return "PRBC"
    elif normalized == "FFP":
        return "FFP"
    return None


def from_ml_component(ml_comp: str) -> BloodComponentType:
    """Map ML dataset component string back to application BloodComponentType enum."""
    normalized = ml_comp.strip().upper()
    if normalized in ("PLATELETS", "PLATELET"):
        return BloodComponentType.PLATELETS
    elif normalized == "PRBC":
        return BloodComponentType.PRBC
    elif normalized == "FFP":
        return BloodComponentType.FFP
    elif normalized == "WHOLE_BLOOD":
        return BloodComponentType.WHOLE_BLOOD
    elif normalized == "CRYOPRECIPITATE":
        return BloodComponentType.CRYOPRECIPITATE
    return BloodComponentType.PRBC


def get_safety_stock_multiplier(comp: Union[BloodComponentType, str]) -> float:
    """
    Returns medical shelf-life-calibrated safety stock multiplier:
    - Platelets (5-day viability): 1.5x demand (prevents catastrophic discard)
    - PRBC (42-day viability): 2.0x demand (standard clinical buffer)
    - FFP (365-day viability): 2.5x demand (durable frozen stock)
    """
    ml_comp = to_ml_component(comp)
    if ml_comp == "Platelets":
        return settings.ML_SAFETY_STOCK_MULTIPLIER_PLATELETS
    elif ml_comp == "PRBC":
        return settings.ML_SAFETY_STOCK_MULTIPLIER_PRBC
    elif ml_comp == "FFP":
        return settings.ML_SAFETY_STOCK_MULTIPLIER_FFP
    return 2.0


def normalize_blood_group(group: str) -> str:
    """Validates and trims blood group string."""
    cleaned = group.strip().upper()
    if cleaned not in VALID_BLOOD_GROUPS:
        raise ValueError(f"Invalid blood group '{group}'. Must be one of {sorted(VALID_BLOOD_GROUPS)}")
    return cleaned
