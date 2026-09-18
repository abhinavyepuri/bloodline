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


# Role enforcement lives in ``app.api.deps.require_roles``, which is a real FastAPI
# dependency and therefore cannot be forgotten the way the old ``RoleChecker`` could —
# it used to be instantiated and called by hand at the top of an endpoint body, so
# omitting the call silently left the route open. It is not defined here because
# ``deps`` imports this module, and the reverse import would be circular.

