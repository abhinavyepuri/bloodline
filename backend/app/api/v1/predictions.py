"""
API v1 Router for Machine Learning Predictions, Operational Decision Support, and Transfers.
"""

from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_blood_bank, resolve_role
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.blood_bank import BloodBank
from app.models.user import User
from app.schemas.ml import (
    PredictionSummaryOut,
    SeriesForecastOut,
    TransferRecommendationOut,
    SimulationRequestIn,
    SimulationResponseOut,
)
from app.services.ml.prediction_service import PredictionService

router = APIRouter()


@router.get("/summary", response_model=PredictionSummaryOut)
async def get_prediction_summary(
    blood_bank_id: Optional[str] = Query(None, description="Optional facility filter"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    [DECISION-SUPPORT] Returns high-level operational counts (critical shortages,
    spike risks, high wastage risks, stable series) across the blood network.
    """
    # If caller is a blood bank, restrict to their facility by default unless coordinator/admin
    user_role = resolve_role(current_user)
    if user_role == UserRole.BLOOD_BANK.value and not blood_bank_id:
        bb = await get_current_blood_bank(db=db, current_user=current_user)
        if bb:
            blood_bank_id = bb.id

    evaluations = await PredictionService.evaluate_network(
        db=db, blood_bank_id=blood_bank_id
    )

    critical_count = sum(1 for e in evaluations if e["operational_status"] == "Critical Shortage")
    high_shortage_count = sum(1 for e in evaluations if e["operational_status"] == "High Shortage Risk")
    high_wastage_count = sum(1 for e in evaluations if e["operational_status"] == "High Wastage Risk")
    spike_risk_count = sum(1 for e in evaluations if e["operational_status"] == "Demand Spike Risk")
    monitor_count = sum(1 for e in evaluations if e["operational_status"] == "Monitor Inventory")
    stable_count = sum(1 for e in evaluations if e["operational_status"] == "Stable")

    transfers = await PredictionService.get_transfer_recommendations(db=db)

    return PredictionSummaryOut(
        total_series_evaluated=len(evaluations),
        critical_shortage_count=critical_count,
        high_shortage_risk_count=high_shortage_count,
        high_wastage_risk_count=high_wastage_count,
        demand_spike_risk_count=spike_risk_count,
        monitor_inventory_count=monitor_count,
        stable_count=stable_count,
        active_transfer_recommendations_count=len(transfers),
        model_version=settings.ML_MODEL_VERSION,
    )


@router.get("/forecast", response_model=List[SeriesForecastOut])
async def get_series_forecast(
    blood_bank_id: Optional[str] = Query(None, description="Filter by facility ID"),
    blood_group: Optional[str] = Query(None, description="Filter by blood group e.g. O+, A-"),
    component_type: Optional[str] = Query(None, description="Filter by component e.g. PRBC, PLATELETS, FFP"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    [DECISION-SUPPORT] Returns next-day demand forecasts, coverage days, risk scores,
    and recommended operational actions for each series.
    """
    user_role = resolve_role(current_user)
    if user_role == UserRole.BLOOD_BANK.value and not blood_bank_id:
        bb = await get_current_blood_bank(db=db, current_user=current_user)
        if bb:
            blood_bank_id = bb.id

    evaluations = await PredictionService.evaluate_network(
        db=db, blood_bank_id=blood_bank_id
    )

    # Apply optional client filters
    if blood_group:
        bg_norm = blood_group.strip().upper()
        evaluations = [e for e in evaluations if e["blood_group"] == bg_norm]

    if component_type:
        comp_norm = component_type.strip().upper()
        evaluations = [e for e in evaluations if e["component_type"] == comp_norm]

    return [SeriesForecastOut(**e) for e in evaluations]


@router.get("/transfers", response_model=List[TransferRecommendationOut])
async def get_transfer_recommendations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    [DECISION-SUPPORT] Returns constraint-aware inter-facility transfer recommendations
    pairing facilities with surplus/wastage-risk to facilities facing shortages.
    """
    recs = await PredictionService.get_transfer_recommendations(db=db)
    return [TransferRecommendationOut(**r) for r in recs]


@router.post("/simulate", response_model=SimulationResponseOut)
async def run_what_if_simulation(
    payload: SimulationRequestIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    [SIMULATION] Runs a what-if operational stress test with configurable demand multipliers
    (e.g. +20%, +50%) and projects resulting shortages and required transfers.
    """
    evaluations = await PredictionService.evaluate_network(
        db=db,
        blood_bank_id=payload.blood_bank_id,
        simulated_demand_multiplier=payload.demand_multiplier,
    )

    projected_critical = sum(1 for e in evaluations if e["operational_status"] == "Critical Shortage")

    # Simulate transfer response
    recs = await PredictionService.get_transfer_recommendations(db=db)
    total_units = sum(r["recommended_units"] for r in recs)

    multiplier_pct = int((payload.demand_multiplier - 1.0) * 100)
    stress_sign = f"+{multiplier_pct}%" if multiplier_pct >= 0 else f"{multiplier_pct}%"

    summary = (
        f"Simulated {stress_sign} demand surge: Projected {projected_critical} series at critical shortage risk. "
        f"Network transfer rebalancing can mobilize {total_units} unit(s) across {len(recs)} inter-facility route(s)."
    )

    return SimulationResponseOut(
        demand_multiplier=payload.demand_multiplier,
        total_series_simulated=len(evaluations),
        projected_critical_count=projected_critical,
        projected_transfers_count=len(recs),
        total_transfer_units_needed=total_units,
        summary_impact=summary,
        detailed_forecasts=[SeriesForecastOut(**e) for e in evaluations],
    )
