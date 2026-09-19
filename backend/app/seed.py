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
from app.models.donor_health_report import DonorHealthReport, HealthEligibilityStatus
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
        await db.execute(delete(DonorHealthReport))
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
            full_name="Metro Blood Central Staff",
            phone_number="+1-555-0201",
            role=UserRole.BLOOD_BANK,
            is_verified=True
        )
        user_bb_2 = User(
            email="redcross@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="City Red Cross Blood Staff",
            phone_number="+1-555-0202",
            role=UserRole.BLOOD_BANK,
            is_verified=True
        )
        user_bb_3 = User(
            email="stjude.bb@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="St. Jude Blood Center Staff",
            phone_number="+1-555-0203",
            role=UserRole.BLOOD_BANK,
            is_verified=True
        )
        user_bb_4 = User(
            email="apex.bloodbank@smartblood.org",
            hashed_password=hashed_pwd,
            full_name="Apex Transfusion Logistics Staff",
            phone_number="+1-555-0204",
            role=UserRole.BLOOD_BANK,
            is_verified=True
        )
        user_donor_1 = User(
            email="alice@donor.org",
            hashed_password=hashed_pwd,
            full_name="Alice Chen",
            phone_number="+1-555-0301",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_2 = User(
            email="bob@donor.org",
            hashed_password=hashed_pwd,
            full_name="Bob Okafor",
            phone_number="+1-555-0302",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_3 = User(
            email="charlie@donor.org",
            hashed_password=hashed_pwd,
            full_name="Charlie Nguyen",
            phone_number="+1-555-0303",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_4 = User(
            email="diana@donor.org",
            hashed_password=hashed_pwd,
            full_name="Diana Patel",
            phone_number="+1-555-0304",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_5 = User(
            email="evan@donor.org",
            hashed_password=hashed_pwd,
            full_name="Evan Torres",
            phone_number="+1-555-0305",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_6 = User(
            email="fatima@donor.org",
            hashed_password=hashed_pwd,
            full_name="Fatima Al-Hassan",
            phone_number="+1-555-0306",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_7 = User(
            email="george@donor.org",
            hashed_password=hashed_pwd,
            full_name="George Mensah",
            phone_number="+1-555-0307",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_8 = User(
            email="helen@donor.org",
            hashed_password=hashed_pwd,
            full_name="Helen Kozlov",
            phone_number="+1-555-0308",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_9 = User(
            email="ian@donor.org",
            hashed_password=hashed_pwd,
            full_name="Ian Wright",
            phone_number="+1-555-0309",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_10 = User(
            email="jessica@donor.org",
            hashed_password=hashed_pwd,
            full_name="Jessica Taylor",
            phone_number="+1-555-0310",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_11 = User(
            email="kiran@donor.org",
            hashed_password=hashed_pwd,
            full_name="Kiran Patel",
            phone_number="+1-555-0311",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_12 = User(
            email="liam@donor.org",
            hashed_password=hashed_pwd,
            full_name="Liam O'Connor",
            phone_number="+1-555-0312",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_13 = User(
            email="maya@donor.org",
            hashed_password=hashed_pwd,
            full_name="Maya Sharma",
            phone_number="+1-555-0313",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_14 = User(
            email="noah@donor.org",
            hashed_password=hashed_pwd,
            full_name="Noah Kim",
            phone_number="+1-555-0314",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_15 = User(
            email="priya@donor.org",
            hashed_password=hashed_pwd,
            full_name="Priya Nair",
            phone_number="+1-555-0315",
            role=UserRole.DONOR,
            is_verified=True
        )
        user_donor_16 = User(
            email="samuel@donor.org",
            hashed_password=hashed_pwd,
            full_name="Samuel Green",
            phone_number="+1-555-0316",
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
            user_hosp_a, user_hosp_b,
            user_bb, user_bb_2, user_bb_3, user_bb_4,
            user_donor_1, user_donor_2, user_donor_3,
            user_donor_4, user_donor_5, user_donor_6,
            user_donor_7, user_donor_8,
            user_donor_9, user_donor_10, user_donor_11,
            user_donor_12, user_donor_13, user_donor_14,
            user_donor_15, user_donor_16,
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

        # 4. Create 4 Blood Banks across metropolitan sectors
        bb_1 = BloodBank(
            user_id=user_bb.id,
            name="Metro Blood Central",
            license_number="BB-BLR-001",
            address="45 Logistics Lane, Central District",
            contact_phone="+1-555-0201",
            latitude=12.9750,
            longitude=77.5990,
            location=ST_SetSRID(ST_Point(77.5990, 12.9750), 4326)
        )
        bb_2 = BloodBank(
            user_id=user_bb_2.id,
            name="City Red Cross Blood Bank",
            license_number="BB-BLR-002",
            address="120 Hope Avenue, West Wing",
            contact_phone="+1-555-0202",
            latitude=12.9680,
            longitude=77.5850,
            location=ST_SetSRID(ST_Point(77.5850, 12.9680), 4326)
        )
        bb_3 = BloodBank(
            user_id=user_bb_3.id,
            name="St. Jude Regional Blood Center",
            license_number="BB-BLR-003",
            address="255 North Boulevard, Medical Hub",
            contact_phone="+1-555-0203",
            latitude=12.9810,
            longitude=77.6020,
            location=ST_SetSRID(ST_Point(77.6020, 12.9810), 4326)
        )
        bb_4 = BloodBank(
            user_id=user_bb_4.id,
            name="Apex Transfusion & Trauma Logistics",
            license_number="BB-BLR-004",
            address="88 Ring Road, South Sector",
            contact_phone="+1-555-0204",
            latitude=12.9550,
            longitude=77.6150,
            location=ST_SetSRID(ST_Point(77.6150, 12.9550), 4326)
        )
        bb = bb_1  # Alias for backward-compatibility with downstream tests/seeds
        db.add_all([bb_1, bb_2, bb_3, bb_4])
        await db.flush()

        # 5. Create Inventory Units across blood banks
        now = datetime.now(timezone.utc)
        unit_1 = InventoryUnit(
            blood_bank_id=bb_1.id,
            batch_number="BB-001",
            blood_group="O-",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=10),
            expiry_date=now + timedelta(days=90),
            status=UnitStatus.AVAILABLE
        )
        unit_2 = InventoryUnit(
            blood_bank_id=bb_1.id,
            batch_number="BB-002",
            blood_group="O-",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=5),
            expiry_date=now + timedelta(days=120),
            status=UnitStatus.AVAILABLE
        )
        unit_3 = InventoryUnit(
            blood_bank_id=bb_1.id,
            batch_number="BB-003",
            blood_group="A+",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=2),
            expiry_date=now + timedelta(days=40),
            status=UnitStatus.AVAILABLE
        )
        unit_4 = InventoryUnit(
            blood_bank_id=bb_1.id,
            batch_number="BB-004",
            blood_group="B+",
            component_type=BloodComponentType.PLATELETS,
            volume_ml=250.0,
            collection_date=now - timedelta(days=1),
            expiry_date=now + timedelta(days=5),
            status=UnitStatus.AVAILABLE
        )
        # Red Cross Inventory (Surplus stock for transfer testing)
        unit_5 = InventoryUnit(
            blood_bank_id=bb_2.id,
            batch_number="RC-001",
            blood_group="O+",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=4),
            expiry_date=now + timedelta(days=60),
            status=UnitStatus.AVAILABLE
        )
        unit_6 = InventoryUnit(
            blood_bank_id=bb_2.id,
            batch_number="RC-002",
            blood_group="O-",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=8),
            expiry_date=now + timedelta(days=45),
            status=UnitStatus.AVAILABLE
        )
        unit_7 = InventoryUnit(
            blood_bank_id=bb_2.id,
            batch_number="RC-003",
            blood_group="A-",
            component_type=BloodComponentType.PLATELETS,
            volume_ml=250.0,
            collection_date=now - timedelta(days=1),
            expiry_date=now + timedelta(days=4),
            status=UnitStatus.AVAILABLE
        )
        # St. Jude BB Inventory
        unit_8 = InventoryUnit(
            blood_bank_id=bb_3.id,
            batch_number="SJ-001",
            blood_group="B-",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=3),
            expiry_date=now + timedelta(days=70),
            status=UnitStatus.AVAILABLE
        )
        unit_9 = InventoryUnit(
            blood_bank_id=bb_3.id,
            batch_number="SJ-002",
            blood_group="AB-",
            component_type=BloodComponentType.FFP,
            volume_ml=250.0,
            collection_date=now - timedelta(days=15),
            expiry_date=now + timedelta(days=300),
            status=UnitStatus.AVAILABLE
        )
        # Apex Logistics Inventory
        unit_10 = InventoryUnit(
            blood_bank_id=bb_4.id,
            batch_number="APX-001",
            blood_group="AB+",
            component_type=BloodComponentType.PRBC,
            volume_ml=350.0,
            collection_date=now - timedelta(days=2),
            expiry_date=now + timedelta(days=85),
            status=UnitStatus.AVAILABLE
        )
        unit_11 = InventoryUnit(
            blood_bank_id=bb_4.id,
            batch_number="APX-002",
            blood_group="O+",
            component_type=BloodComponentType.PLATELETS,
            volume_ml=250.0,
            collection_date=now - timedelta(days=1),
            expiry_date=now + timedelta(days=4),
            status=UnitStatus.AVAILABLE
        )
        db.add_all([unit_1, unit_2, unit_3, unit_4, unit_5, unit_6, unit_7, unit_8, unit_9, unit_10, unit_11])
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
            location=ST_SetSRID(ST_Point(77.6050, 12.9850), 4326),
            location_updated_at=now,
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
            location=ST_SetSRID(ST_Point(77.6150, 12.9950), 4326),
            location_updated_at=now,
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
            location=ST_SetSRID(ST_Point(77.5920, 12.9730), 4326),
            location_updated_at=now,
        )
        d4 = Donor(
            user_id=user_donor_4.id,
            blood_group="B-",
            date_of_birth=date(1990, 7, 8),
            weight_kg=65.0,
            last_donation_date=date(2025, 12, 20),
            is_available=True,
            reliability_score=0.89,
            total_successful_donations=3,
            latitude=12.9680,
            longitude=77.6100,
            location=ST_SetSRID(ST_Point(77.6100, 12.9680), 4326),
            location_updated_at=now,
        )
        d5 = Donor(
            user_id=user_donor_5.id,
            blood_group="B+",
            date_of_birth=date(1997, 3, 25),
            weight_kg=82.0,
            last_donation_date=date(2026, 3, 10),
            is_available=True,
            reliability_score=0.96,
            total_successful_donations=8,
            latitude=12.9800,
            longitude=77.5870,
            location=ST_SetSRID(ST_Point(77.5870, 12.9800), 4326),
            location_updated_at=now,
        )
        d6 = Donor(
            user_id=user_donor_6.id,
            blood_group="AB-",
            date_of_birth=date(1993, 11, 14),
            weight_kg=57.0,
            last_donation_date=date(2026, 1, 5),
            is_available=True,
            reliability_score=0.93,
            total_successful_donations=5,
            latitude=12.9620,
            longitude=77.6200,
            location=ST_SetSRID(ST_Point(77.6200, 12.9620), 4326),
            location_updated_at=now,
        )
        d7 = Donor(
            user_id=user_donor_7.id,
            blood_group="AB+",
            date_of_birth=date(1988, 5, 30),
            weight_kg=90.0,
            last_donation_date=date(2025, 10, 18),
            is_available=True,
            reliability_score=0.87,
            total_successful_donations=1,
            latitude=12.9900,
            longitude=77.5810,
            location=ST_SetSRID(ST_Point(77.5810, 12.9900), 4326),
            location_updated_at=now,
        )
        d8 = Donor(
            user_id=user_donor_8.id,
            blood_group="O+",
            date_of_birth=date(2000, 8, 19),
            weight_kg=68.0,
            last_donation_date=date(2026, 4, 1),
            is_available=True,
            reliability_score=0.97,
            total_successful_donations=7,
            latitude=12.9760,
            longitude=77.6080,
            location=ST_SetSRID(ST_Point(77.6080, 12.9760), 4326),
            location_updated_at=now,
        )
        d9 = Donor(
            user_id=user_donor_9.id,
            blood_group="A-",
            date_of_birth=date(1995, 6, 12),
            weight_kg=72.0,
            last_donation_date=date(2026, 2, 20),
            is_available=True,
            reliability_score=0.94,
            total_successful_donations=4,
            latitude=12.9750,
            longitude=77.5950,
            location=ST_SetSRID(ST_Point(77.5950, 12.9750), 4326),
            location_updated_at=now,
        )
        d10 = Donor(
            user_id=user_donor_10.id,
            blood_group="O-",
            date_of_birth=date(1998, 10, 5),
            weight_kg=60.0,
            last_donation_date=date(2026, 3, 1),
            is_available=True,
            reliability_score=0.98,
            total_successful_donations=9,
            latitude=12.9680,
            longitude=77.6010,
            location=ST_SetSRID(ST_Point(77.6010, 12.9680), 4326),
            location_updated_at=now,
        )
        d11 = Donor(
            user_id=user_donor_11.id,
            blood_group="A-",
            date_of_birth=date(1992, 4, 18),
            weight_kg=76.0,
            last_donation_date=date(2026, 1, 15),
            is_available=True,
            reliability_score=0.91,
            total_successful_donations=6,
            latitude=12.9810,
            longitude=77.5920,
            location=ST_SetSRID(ST_Point(77.5920, 12.9810), 4326),
            location_updated_at=now,
        )
        d12 = Donor(
            user_id=user_donor_12.id,
            blood_group="B+",
            date_of_birth=date(1994, 9, 28),
            weight_kg=84.0,
            last_donation_date=date(2026, 2, 10),
            is_available=True,
            reliability_score=0.95,
            total_successful_donations=7,
            latitude=12.9640,
            longitude=77.6150,
            location=ST_SetSRID(ST_Point(77.6150, 12.9640), 4326),
            location_updated_at=now,
        )
        d13 = Donor(
            user_id=user_donor_13.id,
            blood_group="AB+",
            date_of_birth=date(1996, 12, 3),
            weight_kg=63.0,
            last_donation_date=date(2026, 3, 22),
            is_available=True,
            reliability_score=0.93,
            total_successful_donations=3,
            latitude=12.9880,
            longitude=77.5840,
            location=ST_SetSRID(ST_Point(77.5840, 12.9880), 4326),
            location_updated_at=now,
        )
        d14 = Donor(
            user_id=user_donor_14.id,
            blood_group="O+",
            date_of_birth=date(1991, 7, 21),
            weight_kg=79.0,
            last_donation_date=date(2026, 4, 2),
            is_available=True,
            reliability_score=0.96,
            total_successful_donations=8,
            latitude=12.9730,
            longitude=77.6110,
            location=ST_SetSRID(ST_Point(77.6110, 12.9730), 4326),
            location_updated_at=now,
        )
        d15 = Donor(
            user_id=user_donor_15.id,
            blood_group="B-",
            date_of_birth=date(1997, 8, 14),
            weight_kg=58.0,
            last_donation_date=date(2026, 1, 30),
            is_available=True,
            reliability_score=0.97,
            total_successful_donations=5,
            latitude=12.9600,
            longitude=77.5980,
            location=ST_SetSRID(ST_Point(77.5980, 12.9600), 4326),
            location_updated_at=now,
        )
        d16 = Donor(
            user_id=user_donor_16.id,
            blood_group="A+",
            date_of_birth=date(1993, 3, 9),
            weight_kg=75.0,
            last_donation_date=date(2026, 3, 14),
            is_available=True,
            reliability_score=0.92,
            total_successful_donations=6,
            latitude=12.9840,
            longitude=77.6040,
            location=ST_SetSRID(ST_Point(77.6040, 12.9840), 4326),
            location_updated_at=now,
        )
        # Jessica Taylor (d10) is temporarily deferred for low hemoglobin (11.4 g/dL)
        d10.is_available = False

        db.add_all([d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16])
        await db.flush()

        # Seed Health Screening Reports for all donors
        health_reports = []
        for i, d in enumerate([d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15, d16], start=1):
            if d == d10:
                hr = DonorHealthReport(
                    donor_id=d.id,
                    report_code="HR-2026-0099",
                    hemoglobin_g_dl=11.4,
                    systolic_bp=118,
                    diastolic_bp=76,
                    pulse_bpm=74,
                    temperature_c=36.6,
                    weight_kg=d.weight_kg or 60.0,
                    blood_glucose_mg_dl=92.0,
                    hiv_status="NEGATIVE",
                    hepb_status="NEGATIVE",
                    hepc_status="NEGATIVE",
                    syphilis_status="NEGATIVE",
                    malaria_status="NEGATIVE",
                    eligibility_status=HealthEligibilityStatus.TEMPORARILY_DEFERRED,
                    deferral_reason="Low hemoglobin (11.4 g/dL). Minimum 12.5 g/dL required. Prescribed dietary iron.",
                    deferral_end_date=date.today() + timedelta(days=30),
                    doctor_name="Dr. Sarah Lin, MD",
                    facility_name="Central Transfusion Clinical Lab",
                    doctor_remarks="Temporary clinical deferral. Patient has mild nutritional iron deficiency. Advised iron supplements and hydration. Recommended re-test in 30 days.",
                )
            else:
                hr = DonorHealthReport(
                    donor_id=d.id,
                    report_code=f"HR-2026-{i:04d}",
                    hemoglobin_g_dl=14.2,
                    systolic_bp=120,
                    diastolic_bp=80,
                    pulse_bpm=72,
                    temperature_c=36.6,
                    weight_kg=d.weight_kg or 65.0,
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
            health_reports.append(hr)

        db.add_all(health_reports)
        await db.flush()

        # 7. Create Emergency Blood Requests & Allocations
        from app.models.request import TriageLevel, RequestStatus
        from app.models.allocation import AllocationSourceType, AllocationStatus

        # Request 1: Metro General - Massive Transfusion Protocol (O- PRBC 2 units)
        req_1 = BloodRequest(
            hospital_id=hosp_a.id,
            patient_id_token="PT-TRAUMA-9011",
            required_blood_group="O-",
            component_type=BloodComponentType.PRBC,
            units_requested=2,
            triage_level=TriageLevel.MASSIVE_TRANSFUSION_PROTOCOL,
            calculated_urgency_score=96.5,
            deadline_at=now + timedelta(minutes=45),
            status=RequestStatus.PROXIMITY_ZONE_NOTIFIED,
        )

        # Request 2: St. Jude Emergency - Active Trauma (A+ PRBC 3 units, 1 soft-locked from BB)
        req_2 = BloodRequest(
            hospital_id=hosp_b.id,
            patient_id_token="PT-SURG-4402",
            required_blood_group="A+",
            component_type=BloodComponentType.PRBC,
            units_requested=3,
            triage_level=TriageLevel.ACTIVE_TRAUMA,
            calculated_urgency_score=84.0,
            deadline_at=now + timedelta(hours=2),
            status=RequestStatus.PROXIMITY_ZONE_NOTIFIED,
        )

        # Request 3: Metro General - Scheduled Surgery (B+ Platelets 1 unit, fulfilled from BB-004)
        req_3 = BloodRequest(
            hospital_id=hosp_a.id,
            patient_id_token="PT-ONC-1123",
            required_blood_group="B+",
            component_type=BloodComponentType.PLATELETS,
            units_requested=1,
            triage_level=TriageLevel.SCHEDULED_EMERGENCY_RESERVE,
            calculated_urgency_score=62.0,
            deadline_at=now + timedelta(hours=6),
            status=RequestStatus.COMMITTED_IN_TRANSIT,
        )

        # Request 4: St. Jude Emergency - Urgent Cardiac (B- PRBC 1 unit)
        req_4 = BloodRequest(
            hospital_id=hosp_b.id,
            patient_id_token="PT-CARD-8819",
            required_blood_group="B-",
            component_type=BloodComponentType.PRBC,
            units_requested=1,
            triage_level=TriageLevel.ACTIVE_TRAUMA,
            calculated_urgency_score=79.0,
            deadline_at=now + timedelta(hours=3),
            status=RequestStatus.PROXIMITY_ZONE_NOTIFIED,
        )

        # Request 5: Metro General - Routine Orthopedic (AB- Whole Blood 1 unit)
        req_5 = BloodRequest(
            hospital_id=hosp_a.id,
            patient_id_token="PT-ORTHO-3041",
            required_blood_group="AB-",
            component_type=BloodComponentType.WHOLE_BLOOD,
            units_requested=1,
            triage_level=TriageLevel.ROUTINE_CLINICAL,
            calculated_urgency_score=35.0,
            deadline_at=now + timedelta(hours=24),
            status=RequestStatus.PROXIMITY_ZONE_NOTIFIED,
        )

        db.add_all([req_1, req_2, req_3, req_4, req_5])
        await db.flush()

        # Allocations
        alloc_1 = Allocation(
            request_id=req_2.id,
            source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
            inventory_unit_id=unit_3.id,
            status=AllocationStatus.SOFT_LOCKED,
            estimated_transit_minutes=18.5,
            distance_km=4.2,
            allocated_at=now - timedelta(minutes=10),
        )
        unit_3.status = UnitStatus.LOCKED_RESERVE
        unit_3.lock_expires_at = now + timedelta(minutes=20)

        alloc_2 = Allocation(
            request_id=req_3.id,
            source_type=AllocationSourceType.BLOOD_BANK_INVENTORY,
            inventory_unit_id=unit_4.id,
            status=AllocationStatus.IN_TRANSIT,
            estimated_transit_minutes=12.0,
            distance_km=2.8,
            allocated_at=now - timedelta(minutes=30),
        )
        unit_4.status = UnitStatus.DISPATCHED

        db.add_all([alloc_1, alloc_2])
        await db.flush()

        # Audit Logs
        audit_1 = AllocationAuditLog(
            request_id=req_1.id,
            decision_type="INITIAL_MATCH",
            urgency_score=96.5,
            candidate_scores_json={
                "proximity_weight": 0.45,
                "reliability_weight": 0.35,
                "urgency_weight": 0.20,
                "alerted_donors": [d1.id, d2.id],
            },
            selected_resource_id=f"DONOR_ZONE_O_NEG",
            rationale_summary="MTP Level 1 emergency broadcast. No O- inventory in immediate lock radius; proximity geofence alert dispatched to top reliable O- live donors.",
        )
        audit_2 = AllocationAuditLog(
            request_id=req_2.id,
            allocation_id=alloc_1.id,
            decision_type="INITIAL_MATCH",
            urgency_score=84.0,
            candidate_scores_json={
                "proximity_weight": 0.50,
                "expiry_weight": 0.30,
                "compatibility_weight": 0.20,
                "selected_unit": unit_3.id,
            },
            selected_resource_id=unit_3.id,
            rationale_summary="Unit BB-003 (A+ PRBC) soft-locked from Metro Blood Services. Remaining 2 units routed to live donor matching engine.",
        )
        db.add_all([audit_1, audit_2])

        await db.commit()

        print("Synthetic database seeded successfully!")
        print("Pre-configured accounts:")
        print("  System Admin:      admin@smartblood.org       / password123")
        print("  Coordinator:       coordinator@smartblood.org / password123")
        print("  Hospital Admin 1:  hospital@smartblood.org    / password123")
        print("  Hospital Admin 2:  stjude@smartblood.org      / password123")
        print("  Blood Bank 1:      bloodbank@smartblood.org   / password123 (Metro Blood Central)")
        print("  Blood Bank 2:      redcross@smartblood.org    / password123 (City Red Cross Blood Bank)")
        print("  Blood Bank 3:      stjude.bb@smartblood.org   / password123 (St. Jude Regional Blood Center)")
        print("  Blood Bank 4:      apex.bloodbank@smartblood.org / password123 (Apex Transfusion Logistics)")
        print("  Donor 1  – Alice   (O-):  alice@donor.org            / password123")
        print("  Donor 2  – Bob     (O-):  bob@donor.org              / password123")
        print("  Donor 3  – Charlie (A+):  charlie@donor.org          / password123")
        print("  Donor 4  – Diana   (B-):  diana@donor.org            / password123")
        print("  Donor 5  – Evan    (B+):  evan@donor.org             / password123")
        print("  Donor 6  – Fatima  (AB-): fatima@donor.org           / password123")
        print("  Donor 7  – George  (AB+): george@donor.org           / password123")
        print("  Donor 8  – Helen   (O+):  helen@donor.org            / password123")
        print("  Donor 9  – Ian     (A-):  ian@donor.org              / password123")
        print("  Donor 10 – Jessica (O-):  jessica@donor.org          / password123")
        print("  Donor 11 – Kiran   (A-):  kiran@donor.org            / password123")
        print("  Donor 12 – Liam    (B+):  liam@donor.org             / password123")
        print("  Donor 13 – Maya    (AB+): maya@donor.org             / password123")
        print("  Donor 14 – Noah    (O+):  noah@donor.org             / password123")
        print("  Donor 15 – Priya   (B-):  priya@donor.org            / password123")
        print("  Donor 16 – Samuel  (A+):  samuel@donor.org           / password123")


if __name__ == "__main__":
    asyncio.run(seed_data())
