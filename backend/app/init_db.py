import asyncio
import logging
from sqlalchemy import text
from app.core.database import engine, Base
from app.models import user, hospital, blood_bank, donor, inventory, request, allocation, audit

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("init_db")

async def init():
    logger.info("Connecting to database and initializing PostGIS extension & tables...")
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
        await conn.run_sync(Base.metadata.create_all)
    logger.info("All tables created successfully!")

if __name__ == "__main__":
    asyncio.run(init())
