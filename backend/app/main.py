import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.core.redis import close_redis, ping_redis
from app.core.exceptions import DomainException, domain_exception_handler
from app.core.idempotency import IdempotencyMiddleware
from app.core.tracing import CorrelationIdMiddleware
from app.core.rate_limit import RateLimitMiddleware
from app.api.v1.router import api_router
from app.websocket.routes import router as ws_router
from app.websocket.connection_manager import manager
from app.services.event_sweeper import start_event_sweepers, stop_event_sweepers

logger = logging.getLogger("bloodline")
logging.basicConfig(level=logging.INFO)

# How often the inventory lifecycle sweep runs.
SWEEP_INTERVAL_SECONDS = 900


async def _periodic_lifecycle_sweep() -> None:
    """
    Expire stale inventory on a timer, then re-plan anything that was holding it.

    Runs immediately at startup and then on an interval. Cancelled during shutdown.
    """
    from app.services.inventory_service import run_lifecycle_sweep

    while True:
        try:
            result = await run_lifecycle_sweep()
            if result["expired_units"]:
                logger.info("Inventory lifecycle sweep: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Inventory lifecycle sweep iteration failed")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema management belongs to Alembic (`python -m app.init_db`). Outside development
    # it is never applied implicitly: a model change used to reach a fresh database but
    # silently never reach an existing one, which is how a deployed instance drifts from
    # its own code. In development the convenience is kept so a first run "just works".
    if settings.DEBUG:
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info(
                "Development mode: schema ensured via create_all. "
                "Run 'python -m app.init_db' to apply versioned migrations instead."
            )
        except Exception as e:
            logger.warning(
                f"\n⚠️  [Bloodline Startup Notice]: Could not connect to PostgreSQL on startup ({e}).\n"
                f"👉  Make sure PostgreSQL and Redis are running via Docker: 'docker compose up db redis -d'\n"
            )
    else:
        logger.info("Startup: expecting the schema to have been migrated (python -m app.init_db).")

    # Redis carries the alert zones and per-unit locks. Without it, donor dispatch
    # cannot arbitrate claims, so fail loudly here rather than on the first emergency.
    if await ping_redis():
        logger.info("Connected to Redis (distributed locking and real-time alert zones).")
    else:
        logger.warning(
            f"\n⚠️  [Bloodline Startup Notice]: Could not reach Redis at {settings.REDIS_URL}.\n"
            f"👉  Donor alerting and per-unit locking will fail until Redis is available: "
            f"'docker compose up redis -d'\n"
        )

    # Initialize frozen ML models and preprocessors in background thread
    from app.services.ml.model_loader import ml_manager
    asyncio.get_running_loop().run_in_executor(None, ml_manager.load_models)

    sweep_task = asyncio.create_task(_periodic_lifecycle_sweep())
    start_event_sweepers()
    manager.start_pubsub_listener()

    yield

    # Shutdown: stop sweepers and clean up pools
    manager.stop_pubsub_listener()
    stop_event_sweepers()
    sweep_task.cancel()

    try:
        await sweep_task
    except (asyncio.CancelledError, Exception):
        pass
    try:
        await close_redis()
    except Exception:
        pass


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json" if settings.DOCS_ENABLED else None,
    docs_url=f"{settings.API_V1_STR}/docs" if settings.DOCS_ENABLED else None,
    redoc_url=f"{settings.API_V1_STR}/redoc" if settings.DOCS_ENABLED else None,
    lifespan=lifespan
)

# Distributed tracing: Request ID propagation for end-to-end clinical observability
app.add_middleware(CorrelationIdMiddleware)

# Network reliability: Idempotency-Key protection for mobile clients and retried mutations
app.add_middleware(IdempotencyMiddleware)

# Enterprise DDoS and brute-force protection: Redis sliding-window rate limiting
app.add_middleware(RateLimitMiddleware)


# Defensive security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if not settings.DEBUG:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# CORS middleware for React Web, LAN devices, and Android Emulator
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom domain exception handler
app.add_exception_handler(DomainException, domain_exception_handler)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Strict JSON formatting for request body and query parameter validation errors."""
    formatted_errors = []
    for err in exc.errors():
        loc = " -> ".join(str(item) for item in err.get("loc", []))
        msg = err.get("msg", "Invalid input")
        formatted_errors.append({"field": loc, "message": msg, "type": err.get("type")})

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error_type": "VALIDATION_ERROR",
            "detail": formatted_errors,
            "message": "Input validation failed. Please adhere strictly to the JSON schema."
        }
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Strict JSON formatting for HTTPExceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error_type": "HTTP_ERROR",
            "detail": exc.detail,
            "status_code": exc.status_code
        },
        headers=exc.headers
    )


# Include API v1 and WebSocket gateways (WebSocket strictly namespaced under /api/v1/realtime)
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(ws_router, prefix=f"{settings.API_V1_STR}/realtime")


@app.get("/health", tags=["Health"])
async def health_check():
    """Service health check endpoint."""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT
    }

