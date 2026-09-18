from fastapi import APIRouter
from app.api.v1 import auth, requests, donors, inventory, audit, admin
from app.core.config import settings

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication & Verification"])
api_router.include_router(requests.router, prefix="/requests", tags=["Emergency Requests"])
api_router.include_router(donors.router, prefix="/donors", tags=["Donors & Dispatch"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["Blood Bank Inventory"])
api_router.include_router(audit.router, prefix="/audit", tags=["Explainability & Audit Logs"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin & Coordination Control"])


@api_router.get("/health", tags=["Health"])
async def api_health_check():
    """Service health check endpoint under API v1."""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT,
        "api_version": "v1"
    }

