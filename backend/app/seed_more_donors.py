import asyncio
from datetime import datetime, timezone, date
from geoalchemy2.functions import ST_SetSRID, ST_Point
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.core.permissions import UserRole
from app.models.user import User
from app.models.donor import Donor

NEW_DONORS = [
    {
        "email": "ian@donor.org",
        "name": "Ian Wright",
        "phone": "+1-555-0309",
        "blood_group": "A-",
        "dob": date(1996, 6, 12),
        "weight": 68.0,
        "lat": 12.9770,
        "lng": 77.5970,
        "rel": 0.96,
        "donations": 5,
    },
    {
        "email": "jessica@donor.org",
        "name": "Jessica Taylor",
        "phone": "+1-555-0310",
        "blood_group": "O-",
        "dob": date(1994, 8, 22),
        "weight": 61.0,
        "lat": 12.9810,
        "lng": 77.6020,
        "rel": 0.99,
        "donations": 7,
    },
    {
        "email": "kiran@donor.org",
        "name": "Kiran Patel",
        "phone": "+1-555-0311",
        "blood_group": "A-",
        "dob": date(1999, 2, 17),
        "weight": 74.0,
        "lat": 12.9700,
        "lng": 77.5890,
        "rel": 0.94,
        "donations": 3,
    },
    {
        "email": "liam@donor.org",
        "name": "Liam O'Connor",
        "phone": "+1-555-0312",
        "blood_group": "B+",
        "dob": date(1991, 10, 5),
        "weight": 85.0,
        "lat": 12.9860,
        "lng": 77.6120,
        "rel": 0.91,
        "donations": 4,
    },
    {
        "email": "maya@donor.org",
        "name": "Maya Sharma",
        "phone": "+1-555-0313",
        "blood_group": "AB+",
        "dob": date(1995, 12, 11),
        "weight": 59.0,
        "lat": 12.9650,
        "lng": 77.6040,
        "rel": 0.95,
        "donations": 6,
    },
    {
        "email": "noah@donor.org",
        "name": "Noah Kim",
        "phone": "+1-555-0314",
        "blood_group": "O+",
        "dob": date(1993, 4, 18),
        "weight": 76.0,
        "lat": 12.9830,
        "lng": 77.5910,
        "rel": 0.97,
        "donations": 8,
    },
    {
        "email": "priya@donor.org",
        "name": "Priya Nair",
        "phone": "+1-555-0315",
        "blood_group": "B-",
        "dob": date(1997, 9, 29),
        "weight": 63.0,
        "lat": 12.9740,
        "lng": 77.6180,
        "rel": 0.93,
        "donations": 4,
    },
    {
        "email": "samuel@donor.org",
        "name": "Samuel Green",
        "phone": "+1-555-0316",
        "blood_group": "A+",
        "dob": date(1992, 7, 14),
        "weight": 79.0,
        "lat": 12.9890,
        "lng": 77.5960,
        "rel": 0.92,
        "donations": 5,
    },
]

async def seed_new_donors():
    now = datetime.now(timezone.utc)
    hashed_pwd = get_password_hash("password123")
    async with AsyncSessionLocal() as db:
        for d in NEW_DONORS:
            existing = await db.scalar(select(User).where(User.email == d["email"]))
            if existing:
                print(f"User {d['email']} already exists, skipping.")
                continue

            user = User(
                email=d["email"],
                hashed_password=hashed_pwd,
                full_name=d["name"],
                phone_number=d["phone"],
                role=UserRole.DONOR,
                is_verified=True,
            )
            db.add(user)
            await db.flush()

            donor = Donor(
                user_id=user.id,
                blood_group=d["blood_group"],
                date_of_birth=d["dob"],
                weight_kg=d["weight"],
                last_donation_date=date(2026, 1, 1),
                is_available=True,
                reliability_score=d["rel"],
                total_successful_donations=d["donations"],
                latitude=d["lat"],
                longitude=d["lng"],
                location=ST_SetSRID(ST_Point(d["lng"], d["lat"]), 4326),
                location_updated_at=now,
            )
            db.add(donor)
            print(f"Added donor {d['name']} ({d['blood_group']}) - {d['email']}")

        await db.commit()
        print("New blood group donors seeded successfully!")

if __name__ == "__main__":
    asyncio.run(seed_new_donors())
