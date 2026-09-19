"""
Inter-facility Network Transfer Recommendation Engine.

Implements constraint-aware conservative stock rebalancing between donor facilities
(experiencing wastage risk) and receiver facilities (facing shortages), augmented with
geospatial proximity sorting.
"""

import math
from typing import Any, Dict, List, Optional
import numpy as np


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points in kilometers."""
    radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(radius_km * c, 1)


class TransferRecommendationService:
    """
    Computes inter-facility replenishment transfers across a network of facilities.
    """

    @classmethod
    def generate_recommendations(
        cls,
        evaluations: List[Dict[str, Any]],
        facility_locations: Optional[Dict[str, Dict[str, float]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Takes a list of series evaluations (one per facility x group x component)
        and outputs a list of actionable transfer recommendations.
        """
        if not evaluations:
            return []

        if facility_locations is None:
            facility_locations = {}

        # 1. Identify Donors & Receivers
        # Donor requirement: surplus >= 5 AND wastage_risk >= 0.50
        # Receiver requirement: deficit >= 1.0
        donors = []
        receivers = []

        for item in evaluations:
            item_copy = dict(item)
            surplus = item_copy.get("surplus_units", 0.0)
            wastage_risk = item_copy.get("wastage_risk_score", 0.0)
            deficit = item_copy.get("deficit_units", 0.0)

            if surplus >= 5.0 and wastage_risk >= 0.50:
                item_copy["available_surplus"] = float(surplus)
                donors.append(item_copy)

            if deficit >= 1.0:
                item_copy["remaining_deficit"] = float(deficit)
                receivers.append(item_copy)

        # 2. Sort receivers by risk priority
        # High risk score first, then largest deficit
        receivers.sort(
            key=lambda r: (
                r.get("analytical_risk_score", 0.0),
                r.get("deficit_units", 0.0),
            ),
            reverse=True,
        )

        # Maintain dynamic donor balance map
        # Key: (blood_bank_id, blood_group, component_type)
        donor_balances: Dict[tuple, float] = {
            (d["blood_bank_id"], d["blood_group"], d["component_type"]): d["available_surplus"]
            for d in donors
        }

        recommendations = []

        # 3. Matching algorithm
        for rec in receivers:
            group = rec["blood_group"]
            comp = rec["component_type"]
            rec_bank = rec["blood_bank_id"]
            rec_deficit = rec["remaining_deficit"]

            if rec_deficit < 1.0:
                continue

            # Candidate donors must share group and component, but have different bank ID
            candidate_donors = [
                d for d in donors
                if d["blood_group"] == group
                and d["component_type"] == comp
                and d["blood_bank_id"] != rec_bank
                and donor_balances.get((d["blood_bank_id"], group, comp), 0.0) >= 1.0
            ]

            if not candidate_donors:
                continue

            # Geospatial distance augmentation
            rec_loc = facility_locations.get(rec_bank)

            def donor_sort_key(d):
                donor_bank = d["blood_bank_id"]
                donor_loc = facility_locations.get(donor_bank)
                dist = 0.0
                if rec_loc and donor_loc:
                    dist = haversine_distance_km(
                        rec_loc["latitude"], rec_loc["longitude"],
                        donor_loc["latitude"], donor_loc["longitude"]
                    )
                # Primary: Higher wastage risk (urgency to offload before expiry)
                # Secondary: Lower physical transit distance (faster delivery)
                # Tertiary: Higher available surplus
                return (-d.get("wastage_risk_score", 0.0), dist, -donor_balances.get((donor_bank, group, comp), 0.0))

            candidate_donors.sort(key=donor_sort_key)

            # Match with top donor
            for best_donor in candidate_donors:
                donor_bank = best_donor["blood_bank_id"]
                donor_key = (donor_bank, group, comp)
                avail = donor_balances.get(donor_key, 0.0)

                if avail < 1.0 or rec_deficit < 1.0:
                    continue

                # Transfer quantity
                transfer_qty = math.floor(min(rec_deficit, avail))
                if transfer_qty < 1:
                    continue

                # Deduct from donor balance
                donor_balances[donor_key] -= transfer_qty
                rec["remaining_deficit"] -= transfer_qty
                rec_deficit = rec["remaining_deficit"]

                # Transit estimate
                dist_km = None
                donor_loc = facility_locations.get(donor_bank)
                if rec_loc and donor_loc:
                    dist_km = haversine_distance_km(
                        rec_loc["latitude"], rec_loc["longitude"],
                        donor_loc["latitude"], donor_loc["longitude"]
                    )

                status = "Resolved" if rec_deficit <= 0.5 else "Partially Resolved"

                recommendations.append({
                    "donor_bank_id": donor_bank,
                    "donor_bank_name": best_donor.get("blood_bank_name", donor_bank),
                    "receiver_bank_id": rec_bank,
                    "receiver_bank_name": rec.get("blood_bank_name", rec_bank),
                    "blood_group": group,
                    "component_type": comp,
                    "recommended_units": int(transfer_qty),
                    "donor_wastage_risk": best_donor.get("wastage_risk_score", 0.0),
                    "receiver_risk_score": rec.get("analytical_risk_score", 0.0),
                    "receiver_deficit": rec.get("deficit_units", 0.0),
                    "remaining_deficit": round(rec_deficit, 2),
                    "distance_km": dist_km,
                    "status": status,
                    "recommended_action": f"Transfer {int(transfer_qty)} unit(s) of {group} {comp} to {rec.get('blood_bank_name', rec_bank)} to prevent spoilage and eliminate stockout",
                })

                if rec_deficit < 1.0:
                    break

        return recommendations
