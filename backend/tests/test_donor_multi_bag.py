import asyncio
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.request import BloodRequest, RequestStatus, TriageLevel
from app.models.hospital import Hospital
from app.models.donor import Donor
from app.services.allocation_service import AllocationService

async def run_multi_bag_test():
    print("=" * 60)
    print("TESTING MULTI-UNIT DONOR CLAIMS (2 UNITS)")
    print("=" * 60)

    async with AsyncSessionLocal() as db:
        hosp = (await db.execute(select(Hospital))).scalars().first()
        donor = (await db.execute(select(Donor).where(Donor.blood_group == "O-"))).scalars().first()
        assert hosp is not None, "Hospital must exist"
        assert donor is not None, "Donor must exist"

        req = BloodRequest(
            hospital_id=hosp.id,
            patient_id_token="TEST-2UNITS-MULTI",
            required_blood_group="O-",
            component_type="PRBC",
            units_requested=2,
            triage_level=TriageLevel.ACTIVE_TRAUMA,
            deadline_at=datetime.now(timezone.utc) + timedelta(hours=2),
            status=RequestStatus.PROXIMITY_ZONE_NOTIFIED,
        )
        db.add(req)
        await db.commit()
        await db.refresh(req)

        alloc_svc = AllocationService(db)
        print(f"Request ID: {req.id}, Units Requested: {req.units_requested}")

        # Donor responds accepting 2 units
        res = await alloc_svc.process_donor_response(
            request_id=req.id,
            donor_id=donor.id,
            action="ACCEPT",
            bags_offered=2,
        )
        print("Response result:", res)

        assert res["units_covered"] == 2, f"Expected 2 units covered, got {res['units_covered']}"
        assert res["bags_claimed"] == 2, f"Expected 2 bags claimed, got {res['bags_claimed']}"
        assert res["shortfall"] == 0, f"Expected shortfall 0, got {res['shortfall']}"
        assert res["request_status"] == "COMMITTED_IN_TRANSIT", f"Expected COMMITTED_IN_TRANSIT, got {res['request_status']}"

        # Verify DB allocations count
        db_covered = await alloc_svc.covered_unit_count(req.id)
        assert db_covered == 2, f"Expected DB covered count = 2, got {db_covered}"

        print("✅ MULTI-UNIT DONOR CLAIM PASSED: 2 units requested -> 2 units committed!")

if __name__ == "__main__":
    asyncio.run(run_multi_bag_test())
