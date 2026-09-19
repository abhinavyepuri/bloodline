"""
Clinical & Operational Decision Engine.
Combines raw ML inferences, deterministic inventory conditions, and medical shelf-life constraints.
"""

import math
from typing import Any, Dict, Optional, Tuple
from app.core.config import settings
from app.services.ml.adapter import get_safety_stock_multiplier


class DecisionEngine:
    """
    Translates ML model predictions into operational statuses, risk bands,
    surge headroom, and recommended actions.
    """

    @classmethod
    def evaluate(
        cls,
        closing_inventory: float,
        predicted_demand: float,
        spike_risk: float,
        inventory_risk: float,
        wastage_risk: float,
        component_type: str,
        demand_max_7: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Executes unified decision evaluation.
        """
        # Ensure nonnegativity and ceil demand to integer units
        closing_inv = max(float(closing_inventory), 0.0)
        base_demand = float(math.ceil(max(float(predicted_demand), 0.0)))
        s_risk = max(min(float(spike_risk), 1.0), 0.0)
        inv_risk = max(min(float(inventory_risk), 1.0), 0.0)
        w_risk = max(min(float(wastage_risk), 1.0), 0.0)

        # 1. Dual-Head Demand Estimator (Surge Protection)
        # Prevents regression smoothing from under-sizing safety stock on spike days
        is_spike_predicted = s_risk >= settings.ML_SPIKE_THRESHOLD
        if is_spike_predicted:
            spike_headroom_demand = float(math.ceil(max(base_demand, 10.0, float(demand_max_7 * s_risk))))
        else:
            spike_headroom_demand = base_demand

        # 2. Predicted Days of Inventory Coverage
        if base_demand > 0.001:
            predicted_coverage = closing_inv / base_demand
        else:
            predicted_coverage = 999.0 if closing_inv > 0 else 0.0

        # 3. Operational Status (Deterministic inventory checks take precedence)
        if base_demand > 0 and closing_inv < base_demand:
            operational_status = "Critical Shortage"
            risk_level = "Critical"
            recommended_action = "Urgent stock replenishment or inter-facility transfer"
        elif predicted_coverage < 2.0:
            operational_status = "High Shortage Risk"
            risk_level = "High"
            recommended_action = "Monitor closely and prepare emergency replenishment"
        elif w_risk >= settings.ML_WASTAGE_THRESHOLD:
            operational_status = "High Wastage Risk"
            risk_level = "High"
            recommended_action = "High expiration risk: Prioritize first-expiry dispensing or network transfer-out"
        elif is_spike_predicted:
            operational_status = "Demand Spike Risk"
            risk_level = "High"
            recommended_action = "Anticipate demand surge: Secure donor reserves and hold stock"
        elif predicted_coverage < 5.0 or inv_risk >= settings.ML_INVENTORY_RISK_THRESHOLD:
            operational_status = "Monitor Inventory"
            risk_level = "Medium"
            recommended_action = "Monitor inventory levels and routine replenishment"
        else:
            operational_status = "Stable"
            risk_level = "Low"
            recommended_action = "Stable inventory: No immediate operational intervention required"

        # 4. Medical Shelf-Life-Aware Safety Stock
        safety_multiplier = get_safety_stock_multiplier(component_type)
        # For safety stock calculation, use spike headroom if spike predicted to protect clinical SLA
        effective_demand_for_safety = spike_headroom_demand if is_spike_predicted else base_demand
        safety_stock = effective_demand_for_safety * safety_multiplier

        surplus_units = max(closing_inv - safety_stock, 0.0)
        deficit_units = max(safety_stock - closing_inv, 0.0)

        # 5. Analytical Unified Risk Score (Heuristic 50% inv, 30% spike, 20% inv coverage)
        inv_cov_term = 1.0 / max(predicted_coverage, 1.0)
        analytical_risk_score = 0.50 * inv_risk + 0.30 * s_risk + 0.20 * inv_cov_term
        analytical_risk_score = max(min(analytical_risk_score, 1.0), 0.0)

        # Quintile risk bands
        if analytical_risk_score >= 0.60:
            risk_band = "Very High"
        elif analytical_risk_score >= 0.40:
            risk_band = "High"
        elif analytical_risk_score >= 0.25:
            risk_band = "Medium"
        elif analytical_risk_score >= 0.10:
            risk_band = "Low"
        else:
            risk_band = "Very Low"

        return {
            "closing_inventory": closing_inv,
            "predicted_demand": int(base_demand),
            "spike_headroom_demand": int(spike_headroom_demand),
            "is_spike_predicted": is_spike_predicted,
            "predicted_coverage_days": round(predicted_coverage, 2),
            "spike_risk_score": round(s_risk, 4),
            "inventory_risk_score": round(inv_risk, 4),
            "wastage_risk_score": round(w_risk, 4),
            "analytical_risk_score": round(analytical_risk_score, 4),
            "risk_band": risk_band,
            "operational_status": operational_status,
            "risk_level": risk_level,
            "recommended_action": recommended_action,
            "safety_stock": round(safety_stock, 2),
            "surplus_units": round(surplus_units, 2),
            "deficit_units": round(deficit_units, 2),
        }
