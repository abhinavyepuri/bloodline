import os
from typing import List, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "PS-1 Smart Blood & Emergency Donor Network"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    ENVIRONMENT: str = "development"
    
    # Security
    SECRET_KEY: str = "development-secret-key-change-in-production-minimum-32-characters"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://10.0.2.2:8000",  # Android emulator default host loopback
    ]

    # Database (PostgreSQL + PostGIS)
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "smartblood_db"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/smartblood_db"

    # Redis (Locks, Cache, Event Bus)
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""
    REDIS_URL: str = "redis://localhost:6379/0"

    # Clinical Optimization & Proximity Settings
    DEFAULT_GEOFENCE_RADIUS_KM: float = 5.0
    EXPANDED_GEOFENCE_RADIUS_KM: float = 15.0
    DONOR_RESPONSE_TTL_SECONDS: int = 180  # 3 minutes
    WHOLE_BLOOD_DONATION_INTERVAL_DAYS: int = 56
    PLATELET_DONATION_INTERVAL_DAYS: int = 14

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="allow"
    )


settings = Settings()
