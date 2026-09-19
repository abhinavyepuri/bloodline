import asyncio
from datetime import datetime, timezone, timedelta
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def update_db():
    async with AsyncSessionLocal() as session:
        # 1. Reset Alice last_donation_date to 2025-10-01
        await session.execute(text("""
            UPDATE donors 
            SET last_donation_date = '2025-10-01', is_available = true, location_updated_at = NOW() 
            WHERE user_id = '0889d60d-163d-4e43-bf50-e7dd18d38429'
        """))

        # 2. Update Phani donor blood group to O- as well so universal donor tests work
        await session.execute(text("""
            UPDATE donors 
            SET blood_group = 'O-', is_available = true, location_updated_at = NOW() 
            WHERE user_id = '09827788-ed1c-47d6-b5b2-425c5b13b843'
        """))

        # 3. Add fresh O- and O+ units into inventory
        bank_res = await session.execute(text("SELECT id FROM blood_banks LIMIT 1"))
        bank_id = bank_res.scalar()

        now = datetime.now(timezone.utc)
        exp_35 = now + timedelta(days=35)
        exp_40 = now + timedelta(days=40)

        # Delete existing BB-005 / BB-006 / BB-007 if any
        await session.execute(text("DELETE FROM inventory_units WHERE batch_number IN ('BB-005', 'BB-006', 'BB-007')"))

        await session.execute(text("""
            INSERT INTO inventory_units (id, blood_bank_id, batch_number, blood_group, component_type, volume_ml, status, collection_date, expiry_date, created_at, updated_at)
            VALUES 
            (gen_random_uuid(), :bank_id, 'BB-005', 'O-', 'PRBC', 350, 'AVAILABLE', :now, :exp_35, :now, :now),
            (gen_random_uuid(), :bank_id, 'BB-006', 'O-', 'PRBC', 350, 'AVAILABLE', :now, :exp_40, :now, :now),
            (gen_random_uuid(), :bank_id, 'BB-007', 'O+', 'PRBC', 350, 'AVAILABLE', :now, :exp_40, :now, :now)
        """), {'bank_id': bank_id, 'now': now, 'exp_35': exp_35, 'exp_40': exp_40})

        await session.commit()
        print("Database successfully refreshed with eligible donors and fresh O- units!")

if __name__ == '__main__':
    asyncio.run(update_db())
