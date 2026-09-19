import asyncio
from datetime import date, timedelta
from sqlalchemy import select
from app.core.database import AsyncSessionLocal, engine, Base
from app.models.donor import Donor
from app.models.donor_health_report import DonorHealthReport, HealthEligibilityStatus
from app.models.user import User


async def seed_health_reports():
    # 1. Ensure table exists
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    today = date.today()

    async with AsyncSessionLocal() as db:
        # Fetch all donors joined with user
        result = await db.execute(select(Donor).join(User, Donor.user_id == User.id))
        donors = result.scalars().all()

        print(f"Found {len(donors)} donors in database.")
        for donor in donors:
            # Check if donor already has health reports
            res = await db.execute(
                select(DonorHealthReport).where(DonorHealthReport.donor_id == donor.id)
            )
            existing = res.scalars().first()
            if existing:
                continue

            u_res = await db.execute(select(User).where(User.id == donor.user_id))
            user = u_res.scalars().first()
            email = user.email if user else ""

            # Jessica Taylor (O-) is deliberately deferred with mild anemia (Hb 11.4)
            if email == "jessica@donor.org":
                report = DonorHealthReport(
                    donor_id=donor.id,
                    report_code=f"HR-2026-0099",
                    hemoglobin_g_dl=11.4,
                    systolic_bp=118,
                    diastolic_bp=76,
                    pulse_bpm=74,
                    temperature_c=36.6,
                    weight_kg=donor.weight_kg or 60.0,
                    blood_glucose_mg_dl=92.0,
                    hiv_status="NEGATIVE",
                    hepb_status="NEGATIVE",
                    hepc_status="NEGATIVE",
                    syphilis_status="NEGATIVE",
                    malaria_status="NEGATIVE",
                    eligibility_status=HealthEligibilityStatus.TEMPORARILY_DEFERRED,
                    deferral_reason="Low hemoglobin (11.4 g/dL). Transfusion safety requires minimum 12.5 g/dL. Prescribed dietary iron.",
                    deferral_end_date=today + timedelta(days=30),
                    doctor_name="Dr. Sarah Lin, MD",
                    facility_name="Central Transfusion Clinical Lab",
                    doctor_remarks="Temporary clinical deferral. Patient has mild nutritional iron deficiency. Advised iron supplements and hydration. Recommended re-test in 30 days.",
                )
                donor.is_available = False
            else:
                report = DonorHealthReport(
                    donor_id=donor.id,
                    report_code=f"HR-2026-{donor.id[:4].upper()}",
                    hemoglobin_g_dl=14.2,
                    systolic_bp=120,
                    diastolic_bp=80,
                    pulse_bpm=72,
                    temperature_c=36.6,
                    weight_kg=donor.weight_kg or 65.0,
                    blood_glucose_mg_dl=95.0,
                    hiv_status="NEGATIVE",
                    hepb_status="NEGATIVE",
                    hepc_status="NEGATIVE",
                    syphilis_status="NEGATIVE",
                    malaria_status="NEGATIVE",
                    eligibility_status=HealthEligibilityStatus.ELIGIBLE,
                    doctor_name="Dr. Sarah Lin, MD",
                    facility_name="Central Transfusion Clinical Lab",
                    doctor_remarks="Clinical clearance verified. All vitals and serology within optimal bounds. Certified fit for blood donation.",
                )

            db.add(report)

        await db.commit()
        print("Donor health reports seeded successfully!")


if __name__ == "__main__":
    asyncio.run(seed_health_reports())
