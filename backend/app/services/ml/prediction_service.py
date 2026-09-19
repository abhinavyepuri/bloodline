"""
SmartBlood Unified Prediction & Decision Support Service.

Acts as the single entrypoint bridging database inventory records, feature engineering,
frozen ML models, decision engines, and transfer recommendations.
"""

from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any, Dict, List, Optional
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.blood_bank import BloodBank
from app.models.inventory import BloodComponentType, InventoryUnit, UnitStatus
from app.services.ml.adapter import (
    to_ml_component,
    from_ml_component,
    VALID_BLOOD_GROUPS,
    ML_SUPPORTED_COMPONENTS,
)
from app.services.ml.decision_engine import DecisionEngine
from app.services.ml.feature_builder import FeatureBuilder
from app.services.ml.model_loader import ml_manager
from app.services.ml.transfer_service import TransferRecommendationService

logger = logging.getLogger("smartblood.ml")


class PredictionService:
    """
    Unified prediction and clinical decision-support facade.
    """

    @classmethod
    async def get_live_closing_inventory(
        cls,
        db: AsyncSession,
        blood_bank_id: str,
        blood_group: str,
        component_type: BloodComponentType,
    ) -> int:
        """
        Calculates the true current on-shelf available inventory count from the database.
        Strictly read-only; does not mutate, lock, or hold records.
        """
        now = datetime.now(timezone.utc)
        query = (
            select(func.count(InventoryUnit.id))
            .where(
                InventoryUnit.blood_bank_id == blood_bank_id,
                InventoryUnit.blood_group == blood_group,
                InventoryUnit.component_type == component_type,
                InventoryUnit.status == UnitStatus.AVAILABLE,
                InventoryUnit.expiry_date > now,
            )
        )
        res = await db.execute(query)
        count = res.scalar() or 0
        return int(count)

    @classmethod
    async def evaluate_single_series(
        cls,
        db: AsyncSession,
        blood_bank: BloodBank,
        blood_group: str,
        component_type: BloodComponentType,
        target_date: Optional[date] = None,
        simulated_demand_multiplier: float = 1.0,
        closing_inventory: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates next-day demand, coverage, risk, and operational status for a single series.
        """
        if target_date is None:
            target_date = date.today() + timedelta(days=1)

        # 1. Fetch live unexpired available inventory if not pre-fetched
        if closing_inventory is not None:
            current_inv = closing_inventory
        else:
            current_inv = await cls.get_live_closing_inventory(
                db=db,
                blood_bank_id=blood_bank.id,
                blood_group=blood_group,
                component_type=component_type,
            )

        ml_comp = to_ml_component(component_type)
        is_ml_supported = (ml_comp is not None) and (ml_comp in ML_SUPPORTED_COMPONENTS)

        # 2. Build feature vector
        features = FeatureBuilder.assemble_features_from_history(
            blood_bank_id=blood_bank.id,
            blood_group=blood_group,
            component_type=ml_comp or "PRBC",
            current_closing_inventory=float(current_inv),
            target_date=target_date,
        )

        # Apply simulation multiplier if running what-if scenario
        if simulated_demand_multiplier != 1.0:
            features["demand_lag_1"] *= simulated_demand_multiplier
            features["demand_avg_7"] *= simulated_demand_multiplier
            features["demand_avg_3"] *= simulated_demand_multiplier

        # 3. Model Inference or Deterministic Heuristic Fallback
        is_model_available = ml_manager.is_loaded or ml_manager.load_models()

        if is_ml_supported and is_model_available:
            try:
                demand_df = FeatureBuilder.get_demand_dataframe(features)
                inventory_df = FeatureBuilder.get_inventory_dataframe(features)
                wastage_df = FeatureBuilder.get_wastage_dataframe(features)

                predicted_demand = ml_manager.predict_demand(demand_df) * simulated_demand_multiplier
                spike_risk = ml_manager.predict_spike_risk(demand_df)
                inventory_risk = ml_manager.predict_inventory_risk(inventory_df)
                wastage_risk = ml_manager.predict_wastage_risk(wastage_df)
                eval_source = "FROZEN_ML_ENSEMBLE"
            except Exception as e:
                logger.warning(f"ML inference fallback for {blood_bank.id}/{blood_group}/{component_type}: {e}")
                predicted_demand = features["demand_avg_7"] * simulated_demand_multiplier
                spike_risk = 0.15
                inventory_risk = 0.10 if current_inv > predicted_demand * 2 else 0.65
                wastage_risk = 0.15
                eval_source = "FALLBACK_HEURISTIC"
        else:
            # Deterministic clinical baseline for unsupported components (WHOLE_BLOOD, CRYOPRECIPITATE)
            predicted_demand = features["demand_avg_7"] * simulated_demand_multiplier
            spike_risk = 0.05
            inventory_risk = 0.10 if current_inv >= predicted_demand * 2 else 0.70
            wastage_risk = 0.05
            eval_source = "DETERMINISTIC_HEURISTIC"

        # 4. Decision Engine Evaluation
        decision = DecisionEngine.evaluate(
            closing_inventory=float(current_inv),
            predicted_demand=predicted_demand,
            spike_risk=spike_risk,
            inventory_risk=inventory_risk,
            wastage_risk=wastage_risk,
            component_type=ml_comp or "PRBC",
            demand_max_7=features["demand_max_7"],
        )

        return {
            "blood_bank_id": blood_bank.id,
            "blood_bank_name": blood_bank.name,
            "blood_group": blood_group,
            "component_type": component_type.value,
            "target_date": target_date.isoformat(),
            "evaluation_source": eval_source,
            "ml_supported": is_ml_supported,
            **decision,
        }

    @classmethod
    async def evaluate_network(
        cls,
        db: AsyncSession,
        blood_bank_id: Optional[str] = None,
        target_date: Optional[date] = None,
        simulated_demand_multiplier: float = 1.0,
    ) -> List[Dict[str, Any]]:
        """
        Runs batch evaluation for all banks (or a single bank) across standard components and groups.
        """
        bank_query = select(BloodBank)
        if blood_bank_id:
            bank_query = bank_query.where(BloodBank.id == blood_bank_id)

        res = await db.execute(bank_query)
        blood_banks = res.scalars().all()

        if not blood_banks:
            return []

        # Single batch query for live closing inventory across all evaluated banks
        now = datetime.now(timezone.utc)
        inv_query = (
            select(
                InventoryUnit.blood_bank_id,
                InventoryUnit.blood_group,
                InventoryUnit.component_type,
                func.count(InventoryUnit.id),
            )
            .where(
                InventoryUnit.status == UnitStatus.AVAILABLE,
                InventoryUnit.expiry_date > now,
            )
            .group_by(
                InventoryUnit.blood_bank_id,
                InventoryUnit.blood_group,
                InventoryUnit.component_type,
            )
        )
        if blood_bank_id:
            inv_query = inv_query.where(InventoryUnit.blood_bank_id == blood_bank_id)

        inv_res = await db.execute(inv_query)
        inventory_map = {
            (row[0], row[1], row[2]): int(row[3])
            for row in inv_res.all()
        }

        evaluations = []
        components = [
            BloodComponentType.PRBC,
            BloodComponentType.PLATELETS,
            BloodComponentType.FFP,
        ]

        for bank in blood_banks:
            for comp in components:
                for group in sorted(VALID_BLOOD_GROUPS):
                    inv_count = inventory_map.get((bank.id, group, comp), 0)
                    eval_res = await cls.evaluate_single_series(
                        db=db,
                        blood_bank=bank,
                        blood_group=group,
                        component_type=comp,
                        target_date=target_date,
                        simulated_demand_multiplier=simulated_demand_multiplier,
                        closing_inventory=inv_count,
                    )
                    evaluations.append(eval_res)

        return evaluations

    @classmethod
    async def get_transfer_recommendations(
        cls,
        db: AsyncSession,
        target_date: Optional[date] = None,
    ) -> List[Dict[str, Any]]:
        """
        Computes network-wide inter-facility transfer recommendations.
        """
        # Fetch all banks and their spatial coordinates
        banks_res = await db.execute(select(BloodBank))
        all_banks = banks_res.scalars().all()

        facility_locations = {
            b.id: {"latitude": float(b.latitude), "longitude": float(b.longitude)}
            for b in all_banks
            if b.latitude is not None and b.longitude is not None
        }

        # Evaluate complete network state
        evaluations = await cls.evaluate_network(db=db, target_date=target_date)

        # Run transfer recommendation engine
        recommendations = TransferRecommendationService.generate_recommendations(
            evaluations=evaluations,
            facility_locations=facility_locations,
        )

        return recommendations

    @classmethod
    async def get_transfer_recommendations_from_evaluations(
        cls,
        db: AsyncSession,
        evaluations: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Computes inter-facility transfer recommendations from pre-computed evaluations.
        Use this when you already have evaluate_network() results to avoid running it twice.
        """
        banks_res = await db.execute(select(BloodBank))
        all_banks = banks_res.scalars().all()

        facility_locations = {
            b.id: {"latitude": float(b.latitude), "longitude": float(b.longitude)}
            for b in all_banks
            if b.latitude is not None and b.longitude is not None
        }

        return TransferRecommendationService.generate_recommendations(
            evaluations=evaluations,
            facility_locations=facility_locations,
        )

