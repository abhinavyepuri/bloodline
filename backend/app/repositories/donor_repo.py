from typing import List, Tuple
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2.functions import ST_DWithin, ST_Distance, ST_SetSRID, ST_Point
from app.models.donor import Donor
from app.repositories.base import BaseRepository


class DonorRepository(BaseRepository[Donor]):
    def __init__(self, db: AsyncSession):
        super().__init__(Donor, db)

    async def get_by_user_id(self, user_id: str) -> Donor | None:
        result = await self.db.execute(select(Donor).where(Donor.user_id == user_id))
        return result.scalars().first()

    async def find_eligible_donors_in_proximity(
        self,
        compatible_blood_groups: List[str],
        hospital_lat: float,
        hospital_lng: float,
        radius_km: float
    ) -> List[Tuple[Donor, float]]:
        """
        Find available, biologically compatible donors within spatial radius (meters).
        Returns list of (Donor, distance_in_km).
        """
        # Convert hospital point to WGS84 geography point
        hospital_point = func.ST_SetSRID(func.ST_Point(hospital_lng, hospital_lat), 4326)
        radius_meters = radius_km * 1000.0

        query = (
            select(
                Donor,
                (func.ST_Distance(Donor.location, hospital_point) / 1000.0).label("distance_km")
            )
            .where(
                and_(
                    Donor.blood_group.in_(compatible_blood_groups),
                    Donor.is_available == True,
                    func.ST_DWithin(Donor.location, hospital_point, radius_meters)
                )
            )
            .order_by("distance_km")
        )

        result = await self.db.execute(query)
        return [(row[0], float(row[1])) for row in result.all()]
