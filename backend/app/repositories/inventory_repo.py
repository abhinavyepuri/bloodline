from datetime import datetime, timezone
from typing import List, Optional, Tuple
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2 import Geography
from app.models.inventory import InventoryUnit, BloodComponentType, UnitStatus
from app.models.blood_bank import BloodBank
from app.repositories.base import BaseRepository


class InventoryRepository(BaseRepository[InventoryUnit]):
    def __init__(self, db: AsyncSession):
        super().__init__(InventoryUnit, db)

    @staticmethod
    def _hospital_geography(hospital_lat: float, hospital_lng: float):
        """
        Hospital point cast to geography.

        ``ST_Point`` yields a geometry, and ``ST_Distance`` returns degrees for geometry
        but metres for geography. The cast is explicit so the metre-based division below
        is correct and PostGIS has no ambiguity between the two candidate signatures.
        """
        return func.ST_SetSRID(func.ST_Point(hospital_lng, hospital_lat), 4326).cast(
            Geography
        )

    async def find_compatible_units_with_lock(
        self,
        compatible_blood_groups: List[str],
        component_type: BloodComponentType,
        limit: int = 1,
        hospital_lat: Optional[float] = None,
        hospital_lng: Optional[float] = None,
    ) -> List[Tuple[InventoryUnit, Optional[float]]]:
        """
        Query available inventory units matching biological compatibility and shelf-life,
        applying row-level locking (SELECT ... FOR UPDATE SKIP LOCKED) to prevent
        double-reservation.

        Units are ordered by true PostGIS proximity to the requesting hospital, then by
        expiry (FEFO) as the tie-breaker. Returns ``(unit, distance_km)`` pairs; the
        distance is None when the hospital coordinates are unknown.
        """
        now = datetime.now(timezone.utc)

        conditions = [
            InventoryUnit.blood_group.in_(compatible_blood_groups),
            InventoryUnit.component_type == component_type,
            InventoryUnit.status == UnitStatus.AVAILABLE,
            InventoryUnit.expiry_date > now,
        ]

        has_location = hospital_lat is not None and hospital_lng is not None

        if has_location:
            hospital_point = self._hospital_geography(hospital_lat, hospital_lng)
            distance_km = (func.ST_Distance(BloodBank.location, hospital_point) / 1000.0).label(
                "distance_km"
            )
            query = (
                select(InventoryUnit, distance_km)
                .join(BloodBank, InventoryUnit.blood_bank_id == BloodBank.id)
                .where(and_(*conditions))
                .order_by(distance_km.asc(), InventoryUnit.expiry_date.asc())
                .limit(limit)
                # Lock only the inventory rows; the joined blood bank is read-only here.
                .with_for_update(skip_locked=True, of=InventoryUnit)
            )
        else:
            query = (
                select(InventoryUnit)
                .where(and_(*conditions))
                .order_by(InventoryUnit.expiry_date.asc())  # FEFO fallback
                .limit(limit)
                .with_for_update(skip_locked=True)
            )

        result = await self.db.execute(query)
        if has_location:
            return [(row[0], float(row[1]) if row[1] is not None else None) for row in result.all()]
        return [(unit, None) for unit in result.scalars().all()]

    async def get_by_blood_bank(self, blood_bank_id: str) -> List[InventoryUnit]:
        result = await self.db.execute(
            select(InventoryUnit).where(InventoryUnit.blood_bank_id == blood_bank_id)
        )
        return list(result.scalars().all())
