import asyncio
import time
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import get_settings

API_PREFIX = "/api/v1"
# Only these reads are safe to store on a shared CDN. Everything else — sessions,
# notifications, member notices, reservations — must stay private, so the list is
# an allowlist instead of a list of paths to exclude.
PUBLIC_READS = ("/pages/", "/news", "/equipment/", "/roadmap", "/links", "/push/public-key", "/member-profiles", "/shape-up")
PUBLIC_EXACT = ("/equipment",)
# Availability changes the moment a reservation is approved, so it gets a much
# shorter shared cache than the editorial content.
VOLATILE_READS = ("/availability",)


def public_read(path: str) -> bool:
    if not path.startswith(API_PREFIX):
        return False
    route = path[len(API_PREFIX):]
    return route in PUBLIC_EXACT or any(route == prefix.rstrip("/") or route.startswith(prefix) for prefix in PUBLIC_READS)


class CostGuardMiddleware(BaseHTTPMiddleware):
    """Reject oversized bodies and floods before opening a database session."""

    # Starlette builds the middleware lazily, so the tests need a handle on the
    # live instance to reset its counters between cases.
    instances: list["CostGuardMiddleware"] = []

    def __init__(self, app):
        super().__init__(app)
        CostGuardMiddleware.instances.append(self)
        self.settings = get_settings()
        self.buckets: dict[str, deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path == "/health":
            return await call_next(request)

        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.settings.max_request_bytes:
            return JSONResponse({"detail": "요청 크기가 너무 큽니다."}, status_code=413)

        forwarded = request.headers.get("x-forwarded-for", "")
        client = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
        write = request.method not in {"GET", "HEAD"}
        limit = self.settings.rate_limit_write_per_minute if write else self.settings.rate_limit_read_per_minute
        key = f"{client}:{'write' if write else 'read'}"
        now = time.monotonic()
        async with self.lock:
            bucket = self.buckets[key]
            while bucket and bucket[0] <= now - 60:
                bucket.popleft()
            if len(bucket) >= limit:
                return JSONResponse({"detail": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}, status_code=429, headers={"Retry-After": "60"})
            bucket.append(now)
            if len(self.buckets) > 2_000:
                self.buckets = defaultdict(deque, {name: values for name, values in self.buckets.items() if values and values[-1] > now - 60})

        response = await call_next(request)
        path = request.url.path
        if request.method == "GET" and public_read(path):
            if any(part in path for part in VOLATILE_READS):
                response.headers.setdefault("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60")
            else:
                response.headers.setdefault("Cache-Control", f"public, max-age=60, s-maxage={self.settings.public_cache_seconds}, stale-while-revalidate=600")
        elif path.startswith(API_PREFIX):
            response.headers.setdefault("Cache-Control", "private, no-store")
        return response
