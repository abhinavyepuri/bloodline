from fastapi import Request, status
from fastapi.responses import JSONResponse


class DomainException(Exception):
    """Base domain exception."""
    def __init__(self, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class IncompatibleBloodTypeError(DomainException):
    def __init__(self, donor_type: str, recipient_type: str):
        super().__init__(
            f"Biological incompatibility: Donor blood type {donor_type} is not compatible with recipient {recipient_type}",
            status.HTTP_422_UNPROCESSABLE_ENTITY
        )


class DonorIneligibleError(DomainException):
    def __init__(self, reason: str):
        super().__init__(f"Donor is currently ineligible: {reason}", status.HTTP_400_BAD_REQUEST)


class AllocationRaceConditionError(DomainException):
    def __init__(self, request_id: str):
        super().__init__(
            f"This emergency request has already been claimed by another nearby donor.",
            status.HTTP_409_CONFLICT
        )


async def domain_exception_handler(request: Request, exc: DomainException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "type": exc.__class__.__name__}
    )
