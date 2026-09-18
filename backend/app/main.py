from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.core.redis import close_redis
from app.core.exceptions import DomainException, domain_exception_handler
from app.api.v1.router import api_router
from app.websocket.routes import router as ws_router


import logging

logger = logging.getLogger("smartblood")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize database schema (for dev/demo execution)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Successfully connected to PostgreSQL (PostGIS) and initialized tables.")
    except Exception as e:
        logger.warning(
            f"\n⚠️  [SmartBlood Startup Notice]: Could not connect to PostgreSQL on startup ({e}).\n"
            f"👉  Make sure PostgreSQL and Redis are running via Docker: 'docker compose up db redis -d'\n"
        )
    yield
    # Shutdown: Clean up Redis pool
    try:
        await close_redis()
    except Exception:
        pass


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan
)

# CORS middleware for React Web and Android Emulator
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom domain exception handler
app.add_exception_handler(DomainException, domain_exception_handler)

# Include API v1 and WebSocket gateways
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(ws_router, prefix=f"{settings.API_V1_STR}/realtime")
app.include_router(ws_router, prefix="")


@app.get("/health", tags=["Health"])
async def health_check():
    """Service health check endpoint."""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT
    }
