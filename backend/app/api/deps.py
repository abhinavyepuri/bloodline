from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import UserRole
from app.models.user import User
from app.models.hospital import Hospital
from app.models.blood_bank import BloodBank
from app.models.donor import Donor
from app.schemas.auth import TokenPayload

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


def resolve_role(user: User) -> str:
    """Normalize a user's role to its uppercase string value."""
    raw = user.role.value if hasattr(user.role, "value") else str(user.role)
    return raw.strip().upper()


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    token: str = Depends(oauth2_scheme)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        token_data = TokenPayload(sub=user_id, role=payload.get("role"))
    except JWTError:
        raise credentials_exception

    user = await db.get(User, token_data.sub)
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_roles(*allowed_roles: UserRole):
    """
    Dependency factory enforcing role-based access control.

    Usage:
        @router.post("/x", dependencies=[Depends(require_roles(UserRole.ADMIN))])
        or, when the caller identity is needed:
        current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.COORDINATOR))
    """
    allowed = {r.value for r in allowed_roles}

    async def _guard(current_user: User = Depends(get_current_user)) -> User:
        role = resolve_role(current_user)
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted for role: {role}",
            )
        return current_user

    return _guard


def is_elevated(user: User) -> bool:
    """True when the user may act across tenants (coordinator or admin)."""
    return resolve_role(user) in {UserRole.ADMIN.value, UserRole.COORDINATOR.value}


async def get_current_hospital(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Hospital:
    """Resolve the hospital profile owned by the authenticated user."""
    res = await db.execute(select(Hospital).where(Hospital.user_id == current_user.id))
    hospital = res.scalars().first()
    if not hospital:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No hospital profile is linked to this account",
        )
    return hospital


async def get_current_blood_bank(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BloodBank:
    """Resolve the blood bank profile owned by the authenticated user."""
    res = await db.execute(select(BloodBank).where(BloodBank.user_id == current_user.id))
    bank = res.scalars().first()
    if not bank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No blood bank profile is linked to this account",
        )
    return bank


async def get_current_donor(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Donor:
    """Resolve the donor profile owned by the authenticated user."""
    res = await db.execute(select(Donor).where(Donor.user_id == current_user.id))
    donor = res.scalars().first()
    if not donor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No donor profile is linked to this account",
        )
    return donor
