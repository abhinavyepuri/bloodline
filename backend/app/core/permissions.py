from enum import Enum


class UserRole(str, Enum):
    HOSPITAL = "HOSPITAL"
    BLOOD_BANK = "BLOOD_BANK"
    DONOR = "DONOR"
    COORDINATOR = "COORDINATOR"
    ADMIN = "ADMIN"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            normalized = value.strip().upper()
            for member in cls:
                if member.value == normalized:
                    return member
        return super()._missing_(value)



class RoleChecker:
    """Helper for checking role membership dynamically."""
    def __init__(self, allowed_roles: list[UserRole]):
        self.allowed_roles = [r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles]

    def __call__(self, role: str):
        from fastapi import HTTPException, status
        normalized = str(role).strip().upper()
        if normalized not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {role} is not permitted to perform this operation."
            )
        return True

