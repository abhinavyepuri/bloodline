from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
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


# Include API v1 and WebSocket gateways
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

