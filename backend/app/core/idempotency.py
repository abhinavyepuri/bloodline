import json
import logging
from typing import Optional
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from app.core.redis import get_redis

logger = logging.getLogger("smartblood.idempotency")

IDEMPOTENCY_PREFIX = "idempotency:"
IDEMPOTENCY_TTL_SECONDS = 86400  # 24 hours

# Endpoints requiring strict idempotency guarantees
IDEMPOTENT_PATHS = {
    "/api/v1/requests",
}


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Guarantees strict once-and-only-once execution for critical mutating clinical endpoints.
    In mobile or flaky networks, retried requests with the same Idempotency-Key return
    the cached response without re-executing allocation or donor reservation logic.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method != "POST":
            return await call_next(request)

        # Check if path or subpath matches critical endpoints
        path = request.url.path
        is_idempotent_target = any(path.startswith(p) for p in IDEMPOTENT_PATHS) or ("/respond" in path)

        idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("X-Idempotency-Key")
        if not is_idempotent_target or not idempotency_key:
            return await call_next(request)

        cache_key = f"{IDEMPOTENCY_PREFIX}{idempotency_key.strip()}"

        try:
            redis_client = await get_redis()
            cached_raw = await redis_client.get(cache_key)
            if cached_raw:
                cached_data = json.loads(cached_raw)
                logger.info(f"[Idempotency] Cache HIT for key '{idempotency_key}' on {path}")
                return JSONResponse(
                    content=cached_data.get("body"),
                    status_code=cached_data.get("status_code", 200),
                    headers={
                        "X-Cache-Lookup": "HIT",
                        "Idempotent-Replay": "true",
                    },
                )
        except Exception as e:
            logger.warning(f"[Idempotency] Redis lookup failed ({e}), proceeding without replay cache")

        # Execute downstream handler
        response = await call_next(request)

        # Cache successful 2xx responses
        if 200 <= response.status_code < 300:
            try:
                # Capture body from response streaming generator
                body_bytes = [chunk async for chunk in response.body_iterator]
                response.body_iterator = self._iterate_in_memory(body_bytes)
                body_content = json.loads(b"".join(body_bytes).decode("utf-8"))

                redis_client = await get_redis()
                record = {
                    "status_code": response.status_code,
                    "body": body_content,
                }
                await redis_client.set(cache_key, json.dumps(record, default=str), ex=IDEMPOTENCY_TTL_SECONDS)
                response.headers["X-Cache-Lookup"] = "MISS"
            except Exception as cache_err:
                logger.warning(f"[Idempotency] Failed to cache response ({cache_err})")

        return response

    @staticmethod
    async def _iterate_in_memory(chunks):
        for chunk in chunks:
            yield chunk
