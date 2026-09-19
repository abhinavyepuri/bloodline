from typing import List, Optional, Union
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Development-only default. Refused outside development (see _require_real_secret).
DEV_SECRET_KEY = "development-secret-key-change-in-production-minimum-32-characters"


class Settings(BaseSettings):
    PROJECT_NAME: str = "PS-1 Smart Blood & Emergency Donor Network"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    ENVIRONMENT: str = "development"

    # Security
    SECRET_KEY: str = DEV_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    # CORS — comma-separated in the environment, e.g.
    #   BACKEND_CORS_ORIGINS="https://app.example.org,https://admin.example.org"
    BACKEND_CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
        "http://10.0.2.2:8000",  # Android emulator default host loopback
    ]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        """Accept either a JSON list or a comma-separated string."""
        if isinstance(v, str):
            if not v.strip():
                return []
            if v.lstrip().startswith("["):
                import json

                return json.loads(v)
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @model_validator(mode="after")
    def _validate_and_assemble(self) -> "Settings":
        """Validate secrets in production and assemble connection URIs."""
        if self.ENVIRONMENT.lower() not in ("development", "dev", "test"):
            if self.SECRET_KEY == DEV_SECRET_KEY or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be set to a unique value of at least 32 characters "
                    f"when ENVIRONMENT={self.ENVIRONMENT!r}. Generate one with "
                    "'python -c \"import secrets; print(secrets.token_urlsafe(48))\"'."
                )

        if not self.DATABASE_URL:
            self.DATABASE_URL = (
                f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@"
                f"{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            )

        if not self.REDIS_URL:
            auth_part = f":{self.REDIS_PASSWORD}@" if self.REDIS_PASSWORD else ""
            self.REDIS_URL = f"redis://{auth_part}{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

        if self.DOCS_ENABLED is None:
            self.DOCS_ENABLED = self.DEBUG

        return self

    DOCS_ENABLED: Optional[bool] = None

    # Database (PostgreSQL + PostGIS)
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "smartblood_db"
    DATABASE_URL: Optional[str] = None

    # Redis (Locks, Cache, Event Bus)
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""
    REDIS_URL: Optional[str] = None

    # Clinical Optimization & Proximity Settings
    DEFAULT_GEOFENCE_RADIUS_KM: float = 5.0
    EXPANDED_GEOFENCE_RADIUS_KM: float = 15.0
    DONOR_RESPONSE_TTL_SECONDS: int = 86400  # 24 hours — donors can accept any time they see the request
    DONOR_LOCATION_TTL_MINUTES: int = 60  # Maximum age before location is considered stale
    WHOLE_BLOOD_DONATION_INTERVAL_DAYS: int = 56
    PLATELET_DONATION_INTERVAL_DAYS: int = 14

    # Enterprise Rate Limiting & Protection
    RATE_LIMIT_ENABLED: bool = True
    DISABLE_RATE_LIMIT: bool = False

    # Machine Learning & Decision Support System
    ML_MODEL_DIR: Optional[str] = None
    ML_MODEL_VERSION: str = "smartblood-ml-v1"
    ML_SPIKE_THRESHOLD: float = 0.30
    ML_INVENTORY_RISK_THRESHOLD: float = 0.50
    ML_WASTAGE_THRESHOLD: float = 0.75
    ML_SAFETY_STOCK_MULTIPLIER_PLATELETS: float = 1.5
    ML_SAFETY_STOCK_MULTIPLIER_PRBC: float = 2.0
    ML_SAFETY_STOCK_MULTIPLIER_FFP: float = 2.5
    ML_BENCHMARK_DATA_PATH: Optional[str] = None


    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="allow"
    )


settings = Settings()
