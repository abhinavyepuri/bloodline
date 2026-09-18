from datetime import datetime, timezone
from typing import List, Dict
from app.models.request import TriageLevel

# Strict ABO/Rh(D) Red Blood Cell compatibility matrix
RBC_COMPATIBILITY: Dict[str, List[str]] = {
    "O-": ["O-"],
    "O+": ["O-", "O+"],
    "A-": ["O-", "A-"],
    "A+": ["O-", "O+", "A-", "A+"],
    "B-": ["O-", "B-"],
    "B+": ["O-", "O+", "B-", "B+"],
    "AB-": ["O-", "A-", "B-", "AB-"],
    "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]
}

# Plasma compatibility matrix (inverse of RBC)
PLASMA_COMPATIBILITY: Dict[str, List[str]] = {
    "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
    "O+": ["O+", "A+", "B+", "AB+"],
    "A-": ["A-", "A+", "AB-", "AB+"],
    "A+": ["A+", "AB+"],
    "B-": ["B-", "B+", "AB-", "AB+"],
    "B+": ["B+", "AB+"],
    "AB-": ["AB-", "AB+"],
    "AB+": ["AB+"]
}


class MatchingEngineService:
    """Core mathematical and biological constraint engine."""

    @staticmethod
    def get_compatible_donor_types(recipient_blood_group: str, is_plasma: bool = False) -> List[str]:
        """Return all biologically safe donor blood types for recipient."""
        matrix = PLASMA_COMPATIBILITY if is_plasma else RBC_COMPATIBILITY
        return matrix.get(recipient_blood_group.upper(), [recipient_blood_group])

    @staticmethod
    def calculate_urgency_score(triage_level: TriageLevel, deadline_at: datetime) -> float:
        """
        Compute composite urgency score S_urgency in [0, 100].
        Weights clinical triage level against time remaining until deadline.
        """
        base_weights = {
            TriageLevel.MASSIVE_TRANSFUSION_PROTOCOL: 95.0,
            TriageLevel.ACTIVE_TRAUMA: 80.0,
            TriageLevel.SCHEDULED_EMERGENCY_RESERVE: 50.0,
            TriageLevel.ROUTINE_CLINICAL: 20.0
        }
        base_score = base_weights.get(triage_level, 30.0)

        now = datetime.now(timezone.utc)
        minutes_remaining = (deadline_at - now).total_seconds() / 60.0

        if minutes_remaining <= 15:
            time_penalty = 20.0
        elif minutes_remaining <= 60:
            time_penalty = 10.0
        elif minutes_remaining <= 240:
            time_penalty = 5.0
        else:
            time_penalty = 0.0

        return min(100.0, base_score + time_penalty)

    @staticmethod
    def compute_proximity_score(distance_km: float, max_radius_km: float = 15.0) -> float:
        """Score candidate distance from 1.0 (at hospital) down to 0.0 (at boundary)."""
        if distance_km <= 0:
            return 1.0
        return max(0.0, 1.0 - (distance_km / max_radius_km))
