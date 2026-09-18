from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.inventory import InventoryUnit, BloodComponentType, UnitStatus
from app.repositories.base import BaseRepository


class InventoryRepository(BaseRepository[InventoryUnit]):
    def __init__(self, db: AsyncSession):
        super().__init__(InventoryUnit, db)

    async def find_compatible_units_with_lock(
        self,
        compatible_blood_groups: List[str],
        component_type: BloodComponentType,
        limit: int = 1
    ) -> List[InventoryUnit]:
        """
        Query available inventory units matching biological compatibility and shelf-life,
        applying row-level locking (SELECT ... FOR UPDATE SKIP LOCKED) to prevent double-reservation.
        """
        now = datetime.now(timezone.utc)
        query = (
            select(InventoryUnit)
            .where(
                and_(
                    InventoryUnit.blood_group.in_(compatible_blood_groups),
                    InventoryUnit.component_type == component_type,
                    InventoryUnit.status == UnitStatus.AVAILABLE,
                    InventoryUnit.expiry_date > now
                )
            )
            .order_by(InventoryUnit.expiry_date.asc())  # FEFO: First-Expiring-First-Out
            .limit(limit)
            .with_for_update(skip_locked=True)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_by_blood_bank(self, blood_bank_id: str) -> List[InventoryUnit]:
        result = await self.db.execute(
            select(InventoryUnit).where(InventoryUnit.blood_bank_id == blood_bank_id)
        )
        return list(result.scalars().all())
