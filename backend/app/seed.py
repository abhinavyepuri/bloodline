import asyncio
from datetime import datetime, timezone, timedelta, date
from geoalchemy2.functions import ST_SetSRID, ST_Point
from sqlalchemy import delete
from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.core.permissions import UserRole
from app.models.user import User
from app.models.hospital import Hospital
from app.models.blood_bank import BloodBank
from app.models.donor import Donor
from app.models.inventory import InventoryUnit, BloodComponentType, UnitStatus
from app.models.request import BloodRequest
from app.models.allocation import Allocation
from app.models.audit import AllocationAuditLog


async def seed_data():
    """
    Reset the database to the Section 14 synthetic scenario.

    Everything runs in a single transaction: a failure part-way through leaves the
    previous data intact rather than a half-wiped database. Intermediate ``flush``
    calls assign primary keys without ending the transaction.
    """
    print("Seeding SmartBlood database with Section 14 synthetic scenario...")
    async with AsyncSessionLocal() as db:
        # 1. Clean existing records in reverse dependency order
        await db.execute(delete(AllocationAuditLog))
        await db.execute(delete(Allocation))
        await db.execute(delete(BloodRequest))
        await db.execute(delete(InventoryUnit))
        await db.execute(delete(Donor))
        await db.execute(delete(BloodBank))
        await db.execute(delete(Hospital))
        await db.execute(delete(User))

        # 2. Create Users
        hashed_pwd = get_password_hash("password123")

        user_hosp_a = User(
            email="hospital@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="Dr. Sarah Mitchell (Metro General)",
            phone_number="+1-555-0101",
            role=UserRole.HOSPITAL,
            is_verified=True
        )
        user_hosp_b = User(
            email="stjude@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="Dr. Marcus Vance (St. Jude)",
            phone_number="+1-555-0102",
            role=UserRole.HOSPITAL,
            is_verified=True
        )
        user_bb = User(
            email="bloodbank@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="Metro Blood Logistics Staff",
            phone_number="+1-555-0201",
            role=UserRole.BLOOD_BANK,
            is_verified=True
        )
        user_donor_1 = User(
            email="alice@donor.org",
            hashed_password=hashed_pwd,
            full_name="Alice Donor (D1)",
            phone_number="+1-555-0301",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_2 = User(
            email="bob@donor.org",
            hashed_password=hashed_pwd,
            full_name="Bob Donor (D2)",
            phone_number="+1-555-0302",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_3 = User(
            email="charlie@donor.org",
            hashed_password=hashed_pwd,
            full_name="Charlie Donor (D3)",
            phone_number="+1-555-0303",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_coordinator = User(
            email="coordinator@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="Chief Coordinator Alan Turing",
            phone_number="+1-555-0001",
            role=UserRole.COORDINATOR,
            is_verified=True
        )
        # The ADMIN role existed but no account could ever hold it, leaving admin-only
        # routes unreachable even in the demo environment.
        user_admin = User(
            email="admin@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="System Administrator",
            phone_number="+1-555-0000",
            role=UserRole.ADMIN,
            is_verified=True
        )

        db.add_all([
            user_hosp_a, user_hosp_b, user_bb,
            user_donor_1, user_donor_2, user_donor_3,
            user_coordinator, user_admin
        ])
        await db.flush()

        # 3. Create Hospitals (Point geometry SRID 4326: WGS84 - lng, lat)
        hosp_a = Hospital(
            user_id=user_hosp_a.id,
            name="Metro General Hospital",
            license_number="HOSP-BLR-001",
            address="100 Hospital Way, Central District",
            contact_phone="+1-555-0101",
            is_accredited=True,
            latitude=12.9716,
            longitude=77.5946,
            location=ST_SetSRID(ST_Point(77.5946, 12.9716), 4326)
        )
        hosp_b = Hospital(
            user_id=user_hosp_b.id,
            name="St. Jude Emergency Center",
            license_number="HOSP-BLR-002",
            address="250 North Boulevard, Medical Hub",
            contact_phone="+1-555-0102",
            is_accredited=True,
            latitude=12.9780,
            longitude=77.6000,
            location=ST_SetSRID(ST_Point(77.6000, 12.9780), 4326)
        )
        db.add_all([hosp_a, hosp_b])
        await db.flush()

        # 4. Create Blood Bank (~0.9 km from Hospital A)
        bb = BloodBank(
            user_id=user_bb.id,
            name="Metro Blood Services",
            license_number="BB-BLR-001",
            address="45 Logistics Lane, Central District",
            contact_phone="+1-555-0201",
            latitude=12.9750,
            longitude=77.5990,
            location=ST_SetSRID(ST_Point(77.5990, 12.9750), 4326)
        )
        db.add(bb)
        await db.flush()

        # 5. Create Inventory Units
        # Exactly matching Section 14: BB-001 and BB-002 are O- PRBC units
        now = datetime.now(timezone.utc)
        unit_1 = InventoryUnit(
            blood_bank_id=bb.id,
            batch_number="BB-001",
            blood_group="O-",
            component_type=BloodComponentType.PRBC,
            volume_ml=300.0,
            collection_date=now - timedelta(days=10),
            expiry_date=now + timedelta(days=90),  # exp ~3 months
            status=UnitStatus.AVAILABLE
        )
        unit_2 = InventoryUnit(
            blood_bank_id=bb.id,
            batch_number="BB-002",
            blood_group="O-",
            component_type=BloodComponentType.PRBC,
            volume_ml=300.0,
            collection_date=now - timedelta(days=5),
            expiry_date=now + timedelta(days=120),  # exp ~4 months
            status=UnitStatus.AVAILABLE
        )
        unit_3 = InventoryUnit(
            blood_bank_id=bb.id,
            batch_number="BB-003",
            blood_group="A+",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=2),
            expiry_date=now + timedelta(days=40),
            status=UnitStatus.AVAILABLE
        )
        unit_4 = InventoryUnit(
            blood_bank_id=bb.id,
            batch_number="BB-004",
            blood_group="B+",
            component_type=BloodComponentType.PLATELETS,
            volume_ml=250.0,
            collection_date=now - timedelta(days=1),
            expiry_date=now + timedelta(days=5),
            status=UnitStatus.AVAILABLE
        )
        db.add_all([unit_1, unit_2, unit_3, unit_4])
        await db.flush()

        # 6. Create Donors (Matching Section 14: D1 at 2.1km, D2 at 3.8km)
        d1 = Donor(
            user_id=user_donor_1.id,
            blood_group="O-",
            date_of_birth=date(1995, 4, 12),
            weight_kg=62.0,
            last_donation_date=date(2026, 1, 15),
            is_available=True,
            reliability_score=0.98,
            total_successful_donations=4,
            latitude=12.9850,
            longitude=77.6050,
            location=ST_SetSRID(ST_Point(77.6050, 12.9850), 4326)
        )
        d2 = Donor(
            user_id=user_donor_2.id,
            blood_group="O-",
            date_of_birth=date(1992, 9, 20),
            weight_kg=78.0,
            last_donation_date=date(2025, 11, 10),
            is_available=True,
            reliability_score=0.92,
            total_successful_donations=2,
            latitude=12.9950,
            longitude=77.6150,
            location=ST_SetSRID(ST_Point(77.6150, 12.9950), 4326)
        )
        d3 = Donor(
            user_id=user_donor_3.id,
            blood_group="A+",
            date_of_birth=date(1998, 1, 15),
            weight_kg=70.0,
            last_donation_date=date(2026, 2, 1),
            is_available=True,
            reliability_score=0.95,
            total_successful_donations=6,
            latitude=12.9730,
            longitude=77.5920,
            location=ST_SetSRID(ST_Point(77.5920, 12.9730), 4326)
        )
        db.add_all([d1, d2, d3])
        await db.commit()

        print("Synthetic database seeded successfully!")
        print("Pre-configured accounts:")
        print("  System Admin:      admin@smartblood.org       / password123")
        print("  Hospital Admin:    hospital@smartblood.org    / password123")
        print("  Hospital Admin 2:  stjude@smartblood.org      / password123")
        print("  Blood Bank Staff:  bloodbank@smartblood.org   / password123")
        print("  Donor 1 (D1):      alice@donor.org            / password123")
        print("  Donor 2 (D2):      bob@donor.org              / password123")
        print("  Coordinator:       coordinator@smartblood.org / password123")


if __name__ == "__main__":
    asyncio.run(seed_data())
