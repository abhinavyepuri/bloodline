from enum import Enum
from typing import List
from fastapi import HTTPException, status


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
    """Dependency for enforcing Role-Based Access Control on endpoints."""

    def __init__(self, allowed_roles: List[UserRole]):
        self.allowed_roles = [r.value for r in allowed_roles]

    def __call__(self, current_user_role: str):
        normalized_role = str(current_user_role).strip().upper()
        if normalized_role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted for role: {current_user_role}"
            )

