from enum import Enum
from typing import List
from fastapi import HTTPException, status


class UserRole(str, Enum):
    HOSPITAL = "HOSPITAL"
    BLOOD_BANK = "BLOOD_BANK"
    DONOR = "DONOR"
    COORDINATOR = "COORDINATOR"
    ADMIN = "ADMIN"


class RoleChecker:
    """Dependency for enforcing Role-Based Access Control on endpoints."""

    def __init__(self, allowed_roles: List[UserRole]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user_role: str):
        if current_user_role not in [role.value for role in self.allowed_roles]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted for role: {current_user_role}"
            )
