"""
Pydantic schemas and DTOs for ML Predictions, Decision Support, and Transfers.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class SeriesForecastOut(BaseModel):
    blood_bank_id: str
    blood_bank_name: str
    blood_group: str
    component_type: str
    target_date: str
    closing_inventory: float
    predicted_demand: float
    spike_headroom_demand: float
    is_spike_predicted: bool
    predicted_coverage_days: float
    spike_risk_score: float
    inventory_risk_score: float
    wastage_risk_score: float
    analytical_risk_score: float
    risk_band: str
    operational_status: str
    risk_level: str
    recommended_action: str
    safety_stock: float
    surplus_units: float
    deficit_units: float
    evaluation_source: str
    ml_supported: bool


class PredictionSummaryOut(BaseModel):
    total_series_evaluated: int
    critical_shortage_count: int
    high_shortage_risk_count: int
    high_wastage_risk_count: int
    demand_spike_risk_count: int
    monitor_inventory_count: int
    stable_count: int
    active_transfer_recommendations_count: int
    model_version: str


class TransferRecommendationOut(BaseModel):
    donor_bank_id: str
    donor_bank_name: str
    receiver_bank_id: str
    receiver_bank_name: str
    blood_group: str
    component_type: str
    recommended_units: int
    donor_wastage_risk: float
    receiver_risk_score: float
    receiver_deficit: float
    remaining_deficit: float
    distance_km: Optional[float] = None
    status: str
    recommended_action: str


class SimulationRequestIn(BaseModel):
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=5.0, description="Demand stress multiplier e.g. 1.2 (+20%) or 1.5 (+50%)")
    blood_bank_id: Optional[str] = None
    target_date: Optional[str] = None


class SimulationResponseOut(BaseModel):
    demand_multiplier: float
    total_series_simulated: int
    projected_critical_count: int
    projected_transfers_count: int
    total_transfer_units_needed: int
    summary_impact: str
    detailed_forecasts: List[SeriesForecastOut]
