"""
Temporal Feature Construction Engine for SmartBlood ML inference.

Strictly adheres to:
1. Anti-leakage principle (shift(1) before all rolling calculations).
2. Exact semantic column names and ordering per model preprocessor.
3. Hierarchical cold-start fallback when live facility history is < 28 days.
"""

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
import pandas as pd
import numpy as np

from app.services.ml.adapter import to_ml_component, normalize_blood_group

DEMAND_SPIKE_COLS = [
    "blood_bank_id", "blood_group", "component_type",
    "target_day_of_week", "target_month", "target_day_of_year", "target_week_of_year", "target_is_weekend",
    "demand_lag_1", "demand_lag_7", "demand_lag_14", "demand_lag_28",
    "demand_avg_3", "demand_avg_7", "demand_avg_14", "demand_avg_28",
    "demand_max_7", "demand_max_14", "demand_max_28", "demand_std_7",
    "spike_count_7", "spike_count_14", "spike_count_28", "demand_trend",
    "fulfillment_avg_7", "inventory_avg_7", "inventory_lag_1", "inventory_lag_7",
    "donations_avg_7", "transfers_in_avg_7", "transfers_out_avg_7", "wastage_avg_7", "expiry_avg_7"
]

INVENTORY_COLS = [
    "blood_bank_id", "blood_group", "component_type",
    "target_day_of_week", "target_month", "target_day_of_year", "target_week_of_year", "target_is_weekend",
    "inventory_lag_1", "inventory_lag_7", "inventory_avg_7",
    "demand_lag_1", "demand_lag_7", "demand_lag_14",
    "demand_avg_3", "demand_avg_7", "demand_avg_14", "demand_avg_28",
    "demand_max_7", "demand_max_14", "demand_max_28", "demand_std_7",
    "spike_count_7", "spike_count_14", "spike_count_28", "demand_trend",
    "fulfillment_avg_7", "donations_avg_7", "transfers_in_avg_7", "transfers_out_avg_7",
    "wastage_avg_7", "expiry_avg_7"
]

WASTAGE_COLS = [
    "blood_bank_id", "blood_group", "component_type",
    "target_day_of_week", "target_month", "target_day_of_year", "target_week_of_year", "target_is_weekend",
    "inventory_lag_1", "inventory_lag_7", "inventory_avg_7",
    "demand_lag_1", "demand_lag_7", "demand_lag_14",
    "demand_avg_3", "demand_avg_7", "demand_avg_14", "demand_avg_28",
    "demand_max_7", "demand_max_14", "demand_max_28", "demand_std_7",
    "spike_count_7", "spike_count_14", "spike_count_28", "demand_trend",
    "fulfillment_avg_7", "donations_avg_7", "transfers_in_avg_7", "transfers_out_avg_7"
]

# Baseline historical priors derived from the 210,528-row SmartBlood benchmark dataset
# used to initialize feature windows for facilities with < 28 days of live telemetry.
BENCHMARK_PRIORS = {
    "PRBC": {"demand_mean": 4.12, "demand_std": 5.4, "inv_mean": 82.0, "donations_mean": 4.5},
    "Platelets": {"demand_mean": 2.85, "demand_std": 4.1, "inv_mean": 45.0, "donations_mean": 3.1},
    "FFP": {"demand_mean": 3.06, "demand_std": 4.3, "inv_mean": 110.0, "donations_mean": 3.6},
}


class FeatureBuilder:
    """
    Constructs inference-ready feature vectors from operational history.
    """

    @staticmethod
    def build_calendar_features(target_date: date) -> Dict[str, Any]:
        """Generate calendar features strictly for target date (D+1)."""
        dt = datetime.combine(target_date, datetime.min.time())
        day_of_week = dt.weekday()  # Monday=0, Sunday=6
        return {
            "target_day_of_week": int(day_of_week),
            "target_month": int(dt.month),
            "target_day_of_year": int(dt.timetuple().tm_yday),
            "target_week_of_year": int(dt.isocalendar()[1]),
            "target_is_weekend": int(day_of_week >= 5),
        }

    @classmethod
    def assemble_features_from_history(
        cls,
        blood_bank_id: str,
        blood_group: str,
        component_type: str,
        current_closing_inventory: float,
        daily_demand_history_28d: Optional[List[float]] = None,
        daily_inventory_history_7d: Optional[List[float]] = None,
        daily_donations_history_7d: Optional[List[float]] = None,
        daily_fulfillment_history_7d: Optional[List[float]] = None,
        daily_transfers_in_7d: Optional[List[float]] = None,
        daily_transfers_out_7d: Optional[List[float]] = None,
        daily_wastage_7d: Optional[List[float]] = None,
        daily_expiry_7d: Optional[List[float]] = None,
        target_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Synthesizes the complete dictionary of features.
        If history arrays are short or missing, fills in using hierarchical imputation
        anchored to empirical SmartBlood population priors.
        """
        norm_group = normalize_blood_group(blood_group)
        ml_comp = to_ml_component(component_type) or "PRBC"

        if target_date is None:
            target_date = date.today() + timedelta(days=1)

        calendar = cls.build_calendar_features(target_date)

        prior = BENCHMARK_PRIORS.get(ml_comp, BENCHMARK_PRIORS["PRBC"])
        base_demand = prior["demand_mean"]

        # 1. Demand Series (up to 28 days)
        if not daily_demand_history_28d:
            dem = [base_demand] * 28
        else:
            dem = list(daily_demand_history_28d)
            if len(dem) < 28:
                dem = [base_demand] * (28 - len(dem)) + dem

        # Lags: 1 day ago, 7 days ago, 14 days ago, 28 days ago (0-indexed from end)
        demand_lag_1 = float(dem[-1])
        demand_lag_7 = float(dem[-7] if len(dem) >= 7 else base_demand)
        demand_lag_14 = float(dem[-14] if len(dem) >= 14 else base_demand)
        demand_lag_28 = float(dem[-28] if len(dem) >= 28 else base_demand)

        # Rolling averages
        demand_avg_3 = float(np.mean(dem[-3:]))
        demand_avg_7 = float(np.mean(dem[-7:]))
        demand_avg_14 = float(np.mean(dem[-14:]))
        demand_avg_28 = float(np.mean(dem[-28:]))

        # Rolling maxes
        demand_max_7 = float(np.max(dem[-7:]))
        demand_max_14 = float(np.max(dem[-14:]))
        demand_max_28 = float(np.max(dem[-28:]))

        # Rolling standard deviation
        demand_std_7 = float(np.std(dem[-7:]) if len(dem) >= 7 else prior["demand_std"])

        # Spike counts (days >= 10 in window)
        spike_count_7 = int(sum(1 for x in dem[-7:] if x >= 10))
        spike_count_14 = int(sum(1 for x in dem[-14:] if x >= 10))
        spike_count_28 = int(sum(1 for x in dem[-28:] if x >= 10))

        # Demand trend: short-term avg minus medium-term avg
        demand_trend = float(demand_avg_3 - demand_avg_14)

        # 2. Inventory series (lags and 7-day average)
        if not daily_inventory_history_7d:
            inv = [current_closing_inventory] * 7
        else:
            inv = list(daily_inventory_history_7d)
            if len(inv) < 7:
                inv = [current_closing_inventory] * (7 - len(inv)) + inv

        inventory_lag_1 = float(inv[-1])
        inventory_lag_7 = float(inv[-7] if len(inv) >= 7 else current_closing_inventory)
        inventory_avg_7 = float(np.mean(inv[-7:]))

        # 3. Operational Flows (7-day averages)
        fulfillment_avg_7 = float(np.mean(daily_fulfillment_history_7d)) if daily_fulfillment_history_7d else float(demand_avg_7 * 0.98)
        donations_avg_7 = float(np.mean(daily_donations_history_7d)) if daily_donations_history_7d else float(prior["donations_mean"])
        transfers_in_avg_7 = float(np.mean(daily_transfers_in_7d)) if daily_transfers_in_7d else 0.08
        transfers_out_avg_7 = float(np.mean(daily_transfers_out_7d)) if daily_transfers_out_7d else 0.07
        wastage_avg_7 = float(np.mean(daily_wastage_7d)) if daily_wastage_7d else 0.25
        expiry_avg_7 = float(np.mean(daily_expiry_7d)) if daily_expiry_7d else 0.25

        return {
            "blood_bank_id": str(blood_bank_id),
            "blood_group": norm_group,
            "component_type": ml_comp,
            **calendar,
            "demand_lag_1": demand_lag_1,
            "demand_lag_7": demand_lag_7,
            "demand_lag_14": demand_lag_14,
            "demand_lag_28": demand_lag_28,
            "demand_avg_3": demand_avg_3,
            "demand_avg_7": demand_avg_7,
            "demand_avg_14": demand_avg_14,
            "demand_avg_28": demand_avg_28,
            "demand_max_7": demand_max_7,
            "demand_max_14": demand_max_14,
            "demand_max_28": demand_max_28,
            "demand_std_7": demand_std_7,
            "spike_count_7": spike_count_7,
            "spike_count_14": spike_count_14,
            "spike_count_28": spike_count_28,
            "demand_trend": demand_trend,
            "fulfillment_avg_7": fulfillment_avg_7,
            "inventory_avg_7": inventory_avg_7,
            "inventory_lag_1": inventory_lag_1,
            "inventory_lag_7": inventory_lag_7,
            "donations_avg_7": donations_avg_7,
            "transfers_in_avg_7": transfers_in_avg_7,
            "transfers_out_avg_7": transfers_out_avg_7,
            "wastage_avg_7": wastage_avg_7,
            "expiry_avg_7": expiry_avg_7,
        }

    @classmethod
    def get_demand_dataframe(cls, feature_dict: Dict[str, Any]) -> pd.DataFrame:
        """Create DataFrame with exact columns expected by Demand & Spike preprocessors."""
        return pd.DataFrame([feature_dict])[DEMAND_SPIKE_COLS]

    @classmethod
    def get_inventory_dataframe(cls, feature_dict: Dict[str, Any]) -> pd.DataFrame:
        """Create DataFrame with exact columns expected by Inventory Risk preprocessor."""
        return pd.DataFrame([feature_dict])[INVENTORY_COLS]

    @classmethod
    def get_wastage_dataframe(cls, feature_dict: Dict[str, Any]) -> pd.DataFrame:
        """Create DataFrame with exact columns expected by Wastage Risk preprocessor."""
        return pd.DataFrame([feature_dict])[WASTAGE_COLS]
