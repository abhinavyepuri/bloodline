from fastapi import APIRouter
from app.api.v1 import auth, requests, donors, inventory, audit

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication & Verification"])
api_router.include_router(requests.router, prefix="/requests", tags=["Emergency Requests"])
api_router.include_router(donors.router, prefix="/donors", tags=["Donors & Dispatch"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["Blood Bank Inventory"])
api_router.include_router(audit.router, prefix="/audit", tags=["Explainability & Audit Logs"])
