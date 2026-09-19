from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.permissions import UserRole
from app.models.user import User
from app.schemas.auth import Token, LoginRequest, RegisterRequest
from app.schemas.user import UserOut
from app.api.deps import get_current_user

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register_user(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user (Donor, Hospital, Blood Bank, or Coordinator)."""
    normalized_email = req.email.lower().strip()
    normalized_phone = req.phone_number.strip()

    # Check email uniqueness (case-insensitive)
    existing_email = await db.execute(select(User).where(func.lower(User.email) == normalized_email))
    if existing_email.scalars().first():
        raise HTTPException(status_code=400, detail="User with this email already exists")

    # Check phone number uniqueness
    existing_phone = await db.execute(select(User).where(User.phone_number == normalized_phone))
    if existing_phone.scalars().first():
        raise HTTPException(status_code=400, detail="User with this phone number already exists")

    # Normalize role to UserRole enum (supports 'hospital', 'HOSPITAL', etc.)
    role_enum = UserRole(req.role) if isinstance(req.role, str) else req.role

    # Security check: Administrative and Coordinator accounts cannot be registered publicly
    if role_enum in (UserRole.ADMIN, UserRole.COORDINATOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative accounts cannot be created via public registration.",
        )

    user = User(
        email=normalized_email,
        hashed_password=get_password_hash(req.password),
        full_name=req.full_name.strip(),
        phone_number=normalized_phone,
        role=role_enum,
        is_verified=True  # Auto-verify in dev/demo mode
    )
    db.add(user)
    await db.flush()

    # Auto-provision corresponding profile for instant testing
    from datetime import date
    from app.models.hospital import Hospital
    from app.models.donor import Donor
    from app.models.blood_bank import BloodBank

    if role_enum == UserRole.HOSPITAL:
        hospital = Hospital(
            user_id=user.id,
            name=f"{req.full_name.strip()}",
            license_number=f"HOSP-{user.id[:8].upper()}",
            address=req.facility_address or "100 Medical Center Way",
            contact_phone=normalized_phone,
            latitude=12.9716,
            longitude=77.5946,
            location=func.ST_SetSRID(func.ST_Point(77.5946, 12.9716), 4326)
        )
        db.add(hospital)
    elif role_enum == UserRole.DONOR:
        valid_bg = req.blood_group.strip().upper() if req.blood_group else "O-"
        donor = Donor(
            user_id=user.id,
            blood_group=valid_bg,
            date_of_birth=date(1995, 1, 1),
            weight_kg=70.0,
            is_available=True,
            latitude=12.9716,
            longitude=77.5946,
            location=func.ST_SetSRID(func.ST_Point(77.5946, 12.9716), 4326)
        )
        db.add(donor)
    elif role_enum == UserRole.BLOOD_BANK:
        bank = BloodBank(
            user_id=user.id,
            name=f"{req.full_name.strip()}",
            license_number=f"BB-{user.id[:8].upper()}",
            address=req.facility_address or "200 Red Cross Blvd",
            contact_phone=normalized_phone,
            latitude=12.9716,
            longitude=77.5946,
            location=func.ST_SetSRID(func.ST_Point(77.5946, 12.9716), 4326)
        )
        db.add(bank)

    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/login", response_model=Token)
async def login_user(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate and obtain JWT access token."""
    normalized_email = req.email.lower().strip()
    result = await db.execute(select(User).where(func.lower(User.email) == normalized_email))
    user = result.scalars().first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
    access_token = create_access_token(subject=user.id, role=role_val)
    return Token(
        access_token=access_token,
        token_type="bearer",
        role=UserRole(role_val),
        user_id=user.id,
        full_name=user.full_name,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
async def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """Fetch profile of current authenticated user."""
    return UserOut.model_validate(current_user)

