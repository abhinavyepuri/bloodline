from datetime import date, timedelta
from typing import List, Optional, Tuple
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_Distance
from app.models.donor import Donor
from app.models.inventory import BloodComponentType
from app.repositories.base import BaseRepository
from app.services.donor_service import MIN_DONOR_WEIGHT_KG, donation_interval_days


class DonorRepository(BaseRepository[Donor]):
    def __init__(self, db: AsyncSession):
        super().__init__(Donor, db)

    async def get_by_user_id(self, user_id: str) -> Donor | None:
        result = await self.db.execute(select(Donor).where(Donor.user_id == user_id))
        return result.scalars().first()

    @staticmethod
    def _hospital_geography(hospital_lat: float, hospital_lng: float):
        """
        Hospital point cast to geography.

        The cast is explicit because ``ST_Point`` produces a *geometry*, and
        ``ST_Distance`` returns degrees for geometry but metres for geography. With one
        geography and one geometry argument PostGIS offers two equally good candidate
        functions, so leaving the cast implicit risks "function is not unique" — and
        silently changes the unit of the radius if it does resolve.
        """
        return func.ST_SetSRID(func.ST_Point(hospital_lng, hospital_lat), 4326).cast(
            Geography
        )

    async def find_eligible_donors_in_proximity(
        self,
        compatible_blood_groups: List[str],
        hospital_lat: float,
        hospital_lng: float,
        radius_km: float,
        component_type: Optional[BloodComponentType] = None,
    ) -> List[Tuple[Donor, float]]:
        """
        Find available, biologically compatible, clinically eligible donors within a
        spatial radius. Returns a list of ``(Donor, distance_in_km)`` ordered by
        proximity.

        Eligibility is enforced in SQL (availability, minimum weight, and the
        component-specific donation recovery window) so ineligible donors are never
        alerted. ``donor_service.is_donor_eligible`` applies the same rules again at
        accept time.
        """
        hospital_point = self._hospital_geography(hospital_lat, hospital_lng)
        radius_meters = radius_km * 1000.0

        # Recovery window: donors whose last donation is too recent are excluded.
        # A never-donated donor (NULL) always passes.
        cutoff_date = date.today() - timedelta(days=donation_interval_days(component_type))

        distance_km = (ST_Distance(Donor.location, hospital_point) / 1000.0).label("distance_km")

        query = (
            select(Donor, distance_km)
            .where(
                and_(
                    Donor.blood_group.in_(compatible_blood_groups),
                    Donor.is_available == True,  # noqa: E712 - SQLAlchemy needs ==
                    Donor.location.isnot(None),
                    Donor.weight_kg >= MIN_DONOR_WEIGHT_KG,
                    or_(
                        Donor.last_donation_date.is_(None),
                        Donor.last_donation_date <= cutoff_date,
                    ),
                    ST_DWithin(Donor.location, hospital_point, radius_meters),
                )
            )
            .order_by(distance_km.asc(), Donor.reliability_score.desc())
        )

        result = await self.db.execute(query)
        return [(row[0], float(row[1])) for row in result.all()]
