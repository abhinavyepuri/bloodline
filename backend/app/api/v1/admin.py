from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.seed import seed_data
from app.websocket.connection_manager import manager

router = APIRouter()


@router.post("/reset-seed")
async def reset_seed_data(db: AsyncSession = Depends(get_db)):
    """[DEMO SUPPORT] Reset database to Section 14 clean synthetic state."""
    await seed_data()
    await manager.broadcast({
        "type": "SYSTEM_RESET",
        "message": "Database reset to clean synthetic demo state (Section 14)."
    })
    return {"status": "SUCCESS", "message": "Database successfully re-seeded."}
