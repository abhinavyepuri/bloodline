"""
Comprehensive Automated Unit Tests for SmartBlood ML Integration & Decision Engine.
"""

from datetime import date, timedelta
import pytest
import pandas as pd
import numpy as np

from app.services.ml.adapter import (
    BloodComponentType,
    to_ml_component,
    from_ml_component,
    get_safety_stock_multiplier,
    normalize_blood_group,
)
from app.services.ml.model_loader import ml_manager
from app.services.ml.feature_builder import FeatureBuilder, DEMAND_SPIKE_COLS, INVENTORY_COLS, WASTAGE_COLS
from app.services.ml.decision_engine import DecisionEngine
from app.services.ml.transfer_service import TransferRecommendationService, haversine_distance_km


class TestMLAdapter:
    """Test data harmonization and label mapping."""

    def test_component_label_harmonization(self):
        # Verify casing matches OneHotEncoder training
        assert to_ml_component(BloodComponentType.PLATELETS) == "Platelets"
        assert to_ml_component("PLATELETS") == "Platelets"
        assert to_ml_component(BloodComponentType.PRBC) == "PRBC"
        assert to_ml_component(BloodComponentType.FFP) == "FFP"

        # Unsupported components return None gracefully
        assert to_ml_component(BloodComponentType.WHOLE_BLOOD) is None
        assert to_ml_component(BloodComponentType.CRYOPRECIPITATE) is None

        # Bidirectional mapping back to enum
        assert from_ml_component("Platelets") == BloodComponentType.PLATELETS
        assert from_ml_component("PRBC") == BloodComponentType.PRBC
        assert from_ml_component("FFP") == BloodComponentType.FFP

    def test_shelf_life_safety_stock_multipliers(self):
        # Platelets: 5-day shelf life -> 1.5x
        assert get_safety_stock_multiplier(BloodComponentType.PLATELETS) == 1.5
        # PRBC: 42-day shelf life -> 2.0x
        assert get_safety_stock_multiplier(BloodComponentType.PRBC) == 2.0
        # FFP: 365-day shelf life -> 2.5x
        assert get_safety_stock_multiplier(BloodComponentType.FFP) == 2.5

    def test_blood_group_normalization(self):
        assert normalize_blood_group("o+") == "O+"
        assert normalize_blood_group("AB-") == "AB-"
        with pytest.raises(ValueError):
            normalize_blood_group("C+")


class TestFeatureBuilder:
    """Test feature construction, column ordering, and anti-leakage."""

    def test_calendar_features(self):
        # 2026-09-20 is a Sunday (weekday=6)
        cal = FeatureBuilder.build_calendar_features(date(2026, 9, 20))
        assert cal["target_day_of_week"] == 6
        assert cal["target_is_weekend"] == 1
        assert cal["target_month"] == 9

    def test_feature_assembly_and_column_integrity(self):
        features = FeatureBuilder.assemble_features_from_history(
            blood_bank_id="BB001",
            blood_group="A+",
            component_type="PRBC",
            current_closing_inventory=50.0,
            daily_demand_history_28d=[4.0] * 28,
            target_date=date(2026, 9, 20),
        )

        demand_df = FeatureBuilder.get_demand_dataframe(features)
        inv_df = FeatureBuilder.get_inventory_dataframe(features)
        wastage_df = FeatureBuilder.get_wastage_dataframe(features)

        # Ensure column lengths and names match exactly
        assert list(demand_df.columns) == DEMAND_SPIKE_COLS
        assert list(inv_df.columns) == INVENTORY_COLS
        assert list(wastage_df.columns) == WASTAGE_COLS

        assert not demand_df.isnull().values.any()
        assert not inv_df.isnull().values.any()
        assert not wastage_df.isnull().values.any()


class TestDecisionEngine:
    """Test decision engine operational statuses, dual-head demand, and safety stock."""

    def test_critical_shortage(self):
        # Closing inventory (2) < predicted demand (10)
        res = DecisionEngine.evaluate(
            closing_inventory=2.0,
            predicted_demand=10.0,
            spike_risk=0.10,
            inventory_risk=0.85,
            wastage_risk=0.05,
            component_type="PRBC",
        )
        assert res["operational_status"] == "Critical Shortage"
        assert res["risk_level"] == "Critical"
        assert res["deficit_units"] > 0

    def test_high_shortage_risk_coverage(self):
        # Coverage 1.5 days (< 2 days)
        res = DecisionEngine.evaluate(
            closing_inventory=15.0,
            predicted_demand=10.0,
            spike_risk=0.10,
            inventory_risk=0.55,
            wastage_risk=0.05,
            component_type="PRBC",
        )
        assert res["operational_status"] == "High Shortage Risk"
        assert res["risk_level"] == "High"

    def test_high_wastage_risk(self):
        # Wastage risk 0.82 >= 0.75 threshold
        res = DecisionEngine.evaluate(
            closing_inventory=120.0,
            predicted_demand=4.0,
            spike_risk=0.05,
            inventory_risk=0.05,
            wastage_risk=0.82,
            component_type="Platelets",
        )
        assert res["operational_status"] == "High Wastage Risk"
        assert res["risk_level"] == "High"

    def test_dual_head_demand_surge_headroom(self):
        # Spike risk 0.65 >= 0.30 threshold triggers surge headroom
        res = DecisionEngine.evaluate(
            closing_inventory=40.0,
            predicted_demand=5.0,
            spike_risk=0.65,
            inventory_risk=0.20,
            wastage_risk=0.10,
            component_type="PRBC",
            demand_max_7=25.0,
        )
        assert res["is_spike_predicted"] is True
        assert res["spike_headroom_demand"] >= 10.0
        assert res["operational_status"] == "Demand Spike Risk"

    def test_stable_inventory(self):
        # Coverage > 5 days, all risks low
        res = DecisionEngine.evaluate(
            closing_inventory=80.0,
            predicted_demand=5.0,
            spike_risk=0.05,
            inventory_risk=0.05,
            wastage_risk=0.10,
            component_type="PRBC",
        )
        assert res["operational_status"] == "Stable"
        assert res["risk_level"] == "Low"


class TestTransferRecommendationEngine:
    """Test constraint-aware inter-facility transfer matching."""

    def test_haversine_distance(self):
        # NYC to Philadelphia approx 130 km
        dist = haversine_distance_km(40.7128, -74.0060, 39.9526, -75.1652)
        assert 120.0 < dist < 145.0

    def test_transfer_rebalancing_matching(self):
        evaluations = [
            # Donor facility BB001: surplus 20, wastage risk 0.85
            {
                "blood_bank_id": "BB001",
                "blood_bank_name": "Central Metro Blood Bank",
                "blood_group": "O+",
                "component_type": "Platelets",
                "surplus_units": 20.0,
                "deficit_units": 0.0,
                "wastage_risk_score": 0.85,
                "analytical_risk_score": 0.20,
            },
            # Receiver facility BB002: deficit 8, risk score 0.75
            {
                "blood_bank_id": "BB002",
                "blood_bank_name": "St. Jude Logistics Wing",
                "blood_group": "O+",
                "component_type": "Platelets",
                "surplus_units": 0.0,
                "deficit_units": 8.0,
                "wastage_risk_score": 0.10,
                "analytical_risk_score": 0.75,
            },
        ]

        locations = {
            "BB001": {"latitude": 28.6139, "longitude": 77.2090},
            "BB002": {"latitude": 28.5355, "longitude": 77.3910},
        }

        recs = TransferRecommendationService.generate_recommendations(
            evaluations=evaluations,
            facility_locations=locations,
        )

        assert len(recs) == 1
        r = recs[0]
        assert r["donor_bank_id"] == "BB001"
        assert r["receiver_bank_id"] == "BB002"
        assert r["blood_group"] == "O+"
        assert r["component_type"] == "Platelets"
        assert r["recommended_units"] == 8
        assert r["status"] == "Resolved"
        assert r["distance_km"] is not None
        assert r["distance_km"] > 0


class TestModelLoader:
    """Test loading frozen .pkl artifacts."""

    def test_load_all_models(self):
        loaded = ml_manager.load_models()
        assert loaded is True, f"Failed to load models: {ml_manager.load_error}"
        assert ml_manager.demand_model is not None
        assert ml_manager.demand_preprocessor is not None
        assert ml_manager.spike_model is not None
        assert ml_manager.spike_preprocessor is not None
        assert ml_manager.inventory_model is not None
        assert ml_manager.inventory_preprocessor is not None
        assert ml_manager.wastage_model is not None
        assert ml_manager.wastage_preprocessor is not None

    def test_end_to_end_inference(self):
        if not ml_manager.is_loaded:
            ml_manager.load_models()

        features = FeatureBuilder.assemble_features_from_history(
            blood_bank_id="BB001",
            blood_group="O+",
            component_type="PRBC",
            current_closing_inventory=40.0,
            daily_demand_history_28d=[3.5] * 28,
            target_date=date(2026, 9, 20),
        )

        demand_df = FeatureBuilder.get_demand_dataframe(features)
        inv_df = FeatureBuilder.get_inventory_dataframe(features)
        wastage_df = FeatureBuilder.get_wastage_dataframe(features)

        demand = ml_manager.predict_demand(demand_df)
        spike_prob = ml_manager.predict_spike_risk(demand_df)
        inv_prob = ml_manager.predict_inventory_risk(inv_df)
        wastage_prob = ml_manager.predict_wastage_risk(wastage_df)

        assert isinstance(demand, float) and demand >= 0.0
        assert 0.0 <= spike_prob <= 1.0
        assert 0.0 <= inv_prob <= 1.0
        assert 0.0 <= wastage_prob <= 1.0
