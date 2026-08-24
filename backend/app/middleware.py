import asyncio
import time
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app import cache
from app.config import get_settings
from app.security import COOKIE_NAME, session_owner

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

        # 학교 Wi-Fi 처럼 여러 회원이 한 IP 를 나눠 쓰는 곳에서는 IP 만으로 세면
        # 정상 사용이 서로의 한도를 깎아먹는다. 로그인한 사람은 세션으로 센다.
        # 세션 쿠키는 서명되어 있어 남의 몫을 쓰려면 위조가 필요하고, 쿠키가 없는
        # 방문자는 그대로 IP 로 센다.
        owner = session_owner(request.cookies.get(COOKIE_NAME))
        if owner:
            client = f"member:{owner}"
        else:
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

        path = request.url.path
        # 로그인한 사람의 요청은 공개 읽기라도 공유 캐시에 넣지 않는다.
        # /shape-up 처럼 같은 주소인데 보는 사람에 따라 canEdit 이 달라지는 응답이
        # 있어서, 공유 캐시가 앞에 붙는 순간 남의 화면에 수정 버튼이 뜬다.
        # 쿠키가 없는 요청(공개 페이지를 그리는 서버 쪽 호출)만 공유 캐시를 쓴다.
        signed_in = COOKIE_NAME in request.cookies
        cacheable = request.method == "GET" and not signed_in and public_read(path)

        # 같은 조건에서 응답 자체도 잠시 들고 있는다. 공개 창구를 부르는 것은
        # 사실상 Next.js 재검증뿐인데, 그 호출 하나하나가 Neon 을 깨워 5분씩
        # 붙잡아 둔다. 여기서 막으면 데이터베이스가 잠들 틈이 생긴다.
        # 자세한 사정은 app/cache.py 의 설명에 적어 두었다.
        # 압축은 이 미들웨어 **안쪽**에서 일어나므로(main.py 의 쌓는 순서), 여기서
        # 붙잡는 본문은 이미 gzip 이다. 압축을 못 받는 상대에게 그대로 돌려주면
        # 깨진 응답이 나가므로, 받을 수 있는지를 열쇠에 같이 넣는다.
        gzipped = "gzip" in request.headers.get("accept-encoding", "")
        cache_key = f"{'z' if gzipped else 'p'}:{path}?{request.url.query}"

        if cacheable:
            hit = cache.get(cache_key)
            if hit is not None:
                status, body, headers = hit
                return Response(content=body, status_code=status, headers=dict(headers))

        response = await call_next(request)
        if cacheable:
            if any(part in path for part in VOLATILE_READS):
                window = self.settings.volatile_cache_seconds
                response.headers.setdefault("Cache-Control", f"public, max-age=0, s-maxage={window}, stale-while-revalidate=60")
            else:
                window = self.settings.public_cache_seconds
                response.headers.setdefault("Cache-Control", f"public, max-age=60, s-maxage={window}, stale-while-revalidate=600")
            # 200 만 담는다. 오류를 담아 두면 백엔드가 잠깐 흔들린 것이 창 하나만큼
            # 그대로 굳어 버린다.
            if response.status_code == 200:
                body = b"".join([chunk async for chunk in response.body_iterator])
                headers = [(key, value) for key, value in response.headers.items() if key.lower() != "content-length"]
                cache.set(cache_key, (200, body, headers), window)
                return Response(content=body, status_code=200, headers=dict(headers))
        elif path.startswith(API_PREFIX):
            response.headers.setdefault("Cache-Control", "private, no-store")
        return response
