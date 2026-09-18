import uuid
import contextvars
import logging
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

CORRELATION_ID_CTX: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="")

logger = logging.getLogger("smartblood.tracing")


class CorrelationLogFilter(logging.Filter):
    """Injects correlation_id into all logging records."""
    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = CORRELATION_ID_CTX.get() or "no-trace"
        return True


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """
    Middleware that captures or generates a unique correlation ID (X-Request-ID)
    for every HTTP transaction, establishing an end-to-end audit trace.
    """
    async def dispatch(self, request: Request, call_next):
        req_id = (
            request.headers.get("X-Request-ID")
            or request.headers.get("X-Correlation-ID")
            or f"req_{uuid.uuid4().hex[:12]}"
        )
        token = CORRELATION_ID_CTX.set(req_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = req_id
            return response
        finally:
            CORRELATION_ID_CTX.reset(token)
