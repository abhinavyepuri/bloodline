"""
Singleton model manager for loading and serving frozen SmartBlood ML artifacts.
"""

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger("bloodline.ml")


def get_default_artifact_dir() -> Path:
    """Resolve the directory containing frozen .pkl model artifacts."""
    if settings.ML_MODEL_DIR:
        custom_path = Path(settings.ML_MODEL_DIR)
        if custom_path.exists():
            return custom_path

    # Candidate 1: Workspace sibling 'prediction training bloodline/smartblood_outputs'
    base_dir = Path(__file__).resolve().parents[4]
    candidate_1 = base_dir / "prediction training bloodline" / "smartblood_outputs"
    if candidate_1.exists():
        return candidate_1

    # Candidate 2: Local app/ml_models fallback
    candidate_2 = Path(__file__).resolve().parents[2] / "ml_models"
    if candidate_2.exists():
        return candidate_2

    # Candidate 3: Current directory search
    candidate_3 = Path("prediction training bloodline/smartblood_outputs").resolve()
    if candidate_3.exists():
        return candidate_3

    return candidate_1


class MLModelManager:
    """
    Thread-safe cached loader for the 4 SmartBlood ML model and preprocessor pairs.
    """

    _instance: Optional["MLModelManager"] = None

    def __init__(self):
        self.artifact_dir: Path = get_default_artifact_dir()
        self.is_loaded: bool = False
        self.load_error: Optional[str] = None

        # Model and Preprocessor instances
        self.demand_model: Any = None
        self.demand_preprocessor: Any = None

        self.spike_model: Any = None
        self.spike_preprocessor: Any = None

        self.inventory_model: Any = None
        self.inventory_preprocessor: Any = None

        self.wastage_model: Any = None
        self.wastage_preprocessor: Any = None

    @classmethod
    def get_instance(cls) -> "MLModelManager":
        if cls._instance is None:
            cls._instance = MLModelManager()
        return cls._instance

    def load_models(self) -> bool:
        """
        Loads all 4 models and preprocessors from disk.
        Logs status and returns True on success, False on failure.
        """
        if self.is_loaded:
            return True

        try:
            import joblib
        except ImportError:
            self.load_error = "joblib or scikit-learn is not installed in the python environment."
            logger.warning(f"⚠️  [SmartBlood ML Warning]: {self.load_error}")
            return False

        if not self.artifact_dir.exists():
            self.load_error = f"ML artifact directory not found at: {self.artifact_dir}"
            logger.warning(f"⚠️  [SmartBlood ML Warning]: {self.load_error}")
            return False

        files = {
            "demand_model": "demand_forecast_model.pkl",
            "demand_preprocessor": "demand_forecast_preprocessor.pkl",
            "spike_model": "spike_risk_model.pkl",
            "spike_preprocessor": "spike_risk_preprocessor.pkl",
            "inventory_model": "inventory_risk_model.pkl",
            "inventory_preprocessor": "inventory_risk_preprocessor.pkl",
            "wastage_model": "wastage_risk_model.pkl",
            "wastage_preprocessor": "wastage_risk_preprocessor.pkl",
        }

        try:
            import sys
            try:
                import sklearn._loss._loss
                sys.modules['_loss'] = sklearn._loss._loss
            except (ImportError, AttributeError):
                pass

            logger.info(f"Loading SmartBlood ML artifacts ({settings.ML_MODEL_VERSION}) from: {self.artifact_dir}")
            self.demand_model = joblib.load(self.artifact_dir / files["demand_model"])
            self.demand_preprocessor = joblib.load(self.artifact_dir / files["demand_preprocessor"])

            self.spike_model = joblib.load(self.artifact_dir / files["spike_model"])
            self.spike_preprocessor = joblib.load(self.artifact_dir / files["spike_preprocessor"])

            self.inventory_model = joblib.load(self.artifact_dir / files["inventory_model"])
            self.inventory_preprocessor = joblib.load(self.artifact_dir / files["inventory_preprocessor"])

            self.wastage_model = joblib.load(self.artifact_dir / files["wastage_model"])
            self.wastage_preprocessor = joblib.load(self.artifact_dir / files["wastage_preprocessor"])

            self.is_loaded = True
            self.load_error = None
            logger.info("✅ All 4 SmartBlood ML models and preprocessors loaded successfully.")
            return True
        except Exception as e:
            self.load_error = f"Failed to load ML artifacts: {e}"
            logger.exception(f"❌ [SmartBlood ML Error]: {self.load_error}")
            return False

    def predict_demand(self, features_df) -> float:
        """Predict next-day demand units (nonnegative)."""
        if not self.is_loaded and not self.load_models():
            raise RuntimeError(f"ML models unavailable: {self.load_error}")
        import numpy as np

        X_encoded = self.demand_preprocessor.transform(features_df)
        preds = self.demand_model.predict(X_encoded)
        return float(np.maximum(preds[0], 0.0))

    def predict_spike_risk(self, features_df) -> float:
        """Predict probability/risk-score of demand >= 10."""
        if not self.is_loaded and not self.load_models():
            raise RuntimeError(f"ML models unavailable: {self.load_error}")
        X_encoded = self.spike_preprocessor.transform(features_df)
        proba = self.spike_model.predict_proba(X_encoded)
        return float(proba[0, 1])

    def predict_inventory_risk(self, features_df) -> float:
        """Predict probability/risk-score of shortage (inventory < demand)."""
        if not self.is_loaded and not self.load_models():
            raise RuntimeError(f"ML models unavailable: {self.load_error}")
        X_encoded = self.inventory_preprocessor.transform(features_df)
        proba = self.inventory_model.predict_proba(X_encoded)
        return float(proba[0, 1])

    def predict_wastage_risk(self, features_df) -> float:
        """Predict probability/risk-score of units expiring/wasting next day."""
        if not self.is_loaded and not self.load_models():
            raise RuntimeError(f"ML models unavailable: {self.load_error}")
        X_encoded = self.wastage_preprocessor.transform(features_df)
        proba = self.wastage_model.predict_proba(X_encoded)
        return float(proba[0, 1])


ml_manager = MLModelManager.get_instance()
