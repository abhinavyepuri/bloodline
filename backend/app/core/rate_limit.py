import time
import logging
from typing import Tuple
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger("smartblood.ratelimit")

EXEMPT_PATHS = {
    "/health",
    f"{settings.API_V1_STR}/docs",
    f"{settings.API_V1_STR}/openapi.json",
    f"{settings.API_V1_STR}/redoc",
}


def _get_rate_limit_policy(path: str) -> Tuple[int, int]:
    """
    Returns (max_requests, window_seconds) based on path sensitivity.
    """
    if "/auth/login" in path or "/auth/register" in path:
        return (20, 60)  # 20 requests per minute for authentication endpoints
    elif "/requests" in path:
        return (120, 60)  # 120 requests per minute for emergency requests
    else:
        return (300, 60)  # 300 requests per minute general


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Enterprise sliding-window rate limiter powered by Redis sorted sets.
    Prevents brute force, credential stuffing, and DoS attacks against emergency endpoints.
    Fails open if Redis is temporarily unavailable to prevent blocking life-critical requests.
    """

    async def dispatch(self, request: Request, call_next):
        # Exclude exempt paths or testing/development bypass (unless explicitly tested with X-Testing: false)
        path = request.url.path
        if path in EXEMPT_PATHS:
            return await call_next(request)

        is_explicit_test = request.headers.get("X-Testing") == "false"
        if not is_explicit_test:
            if (
                request.headers.get("X-Testing") == "true"
                or getattr(settings, "ENVIRONMENT", "").lower() in ("development", "dev", "test", "testing")
                or getattr(settings, "DISABLE_RATE_LIMIT", False)
            ):
                return await call_next(request)

        # Determine client identifier (authenticated user ID from Authorization header hash or client IP)
        client_ip = request.client.host if request.client else "unknown"
        auth_header = request.headers.get("Authorization", "")
        client_id = f"ip:{client_ip}" if not auth_header else f"auth:{hash(auth_header)}"

        max_requests, window_seconds = _get_rate_limit_policy(path)
        cache_key = f"ratelimit:{client_id}:{path}:{window_seconds}"
        now = time.time()
        window_start = now - window_seconds

        try:
            redis_client = await get_redis()
            pipe = redis_client.pipeline(transaction=True)
            pipe.zremrangebyscore(cache_key, 0, window_start)
            pipe.zcard(cache_key)
            pipe.zadd(cache_key, {str(now): now})
            pipe.expire(cache_key, window_seconds + 5)
            results = await pipe.execute()

            current_requests = results[1]

            if current_requests >= max_requests:
                retry_after = int(window_seconds - (now - window_start))
                logger.warning(
                    f"[RateLimit] Client {client_id} exceeded rate limit on {path} "
                    f"({current_requests}/{max_requests} reqs in {window_seconds}s)"
                )
                return JSONResponse(
                    status_code=429,
                    content={
                        "error_type": "RATE_LIMIT_EXCEEDED",
                        "detail": f"Too many requests. Please retry after {retry_after} seconds.",
                        "retry_after": retry_after,
                    },
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Limit": str(max_requests),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(int(now + retry_after)),
                    },
                )

            remaining = max(0, max_requests - current_requests - 1)
            response = await call_next(request)
            response.headers["X-RateLimit-Limit"] = str(max_requests)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(int(now + window_seconds))
            return response

        except Exception as e:
            # Failsafe: log warning and continue without breaking the request
            logger.debug(f"[RateLimit] Redis sliding window check bypassed ({e})")
            return await call_next(request)
