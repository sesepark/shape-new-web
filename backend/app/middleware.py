import asyncio
import logging
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


logger = logging.getLogger(__name__)

# 때가 된 예약 알림을 얼마나 자주 확인할지. 들어오는 요청에 얹어 도므로, 너무
# 자주 보면 데이터베이스만 두드리고 너무 뜸하면 알림이 늦습니다.
SWEEP_EVERY = 180.0
_last_sweep = 0.0
# asyncio 는 태스크를 약한 참조로만 들고 있어서, 여기서 붙들지 않으면 도중에
# 회수될 수 있다. 회수되면 알림이 조용히 사라진다.
_sweeps: set[asyncio.Task] = set()


async def _sweep_reservation_alerts() -> None:
    """때가 된 예약 알림을 보냅니다.

    따로 도는 시계(크론)를 두지 않는 이유는 무료 요금제 때문입니다. 주기적으로
    서버를 깨우면 깨어 있는 시간만큼 데이터베이스 시간을 쓰는데, 그 시간이 한 달
    한도에서 가장 먼저 닳습니다. 사람이 사이트를 쓰는 동안에만 확인합니다.

    실패해도 요청에는 영향을 주지 않습니다. 알림 하나 때문에 화면이 느려지거나
    오류가 나면 안 됩니다.
    """
    from app.database import SessionLocal
    from app.services.notifications import deliver_push
    from app.services.reservation_alerts import sweep_due

    try:
        async with SessionLocal() as db:
            due = await sweep_due(db)
        for title, body, devices in due:
            await deliver_push(devices, title, body=body, path="/mypage")
    except Exception as error:  # noqa: BLE001 - 알림 때문에 사이트가 흔들리면 안 된다
        logger.warning("예약 알림 확인 실패: %s", error)


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

        if not cacheable:
            response = await call_next(request)
            if path.startswith(API_PREFIX):
                response.headers.setdefault("Cache-Control", "private, no-store")
            return response

        stored = cache.get(cache_key)
        if stored is not None:
            return self._replay(stored)

        # 창이 끝난 직후에는 같은 창구로 여러 건이 한꺼번에 들어온다(Vercel 이
        # 여러 지역에서 같은 쪽을 동시에 재검증한다). 하나만 내려보내고 나머지는
        # 여기서 기다렸다가 채워진 값을 받는다. 기다리는 편이 연결 셋짜리 풀에
        # 줄을 서는 것보다 언제나 싸다.
        async with cache.lock_for(cache_key):
            # 기다리는 동안 앞선 요청이 채웠을 수 있다.
            stored = cache.get(cache_key)
            if stored is not None:
                return self._replay(stored)
            return await self._fill(request, call_next, path, cache_key)

    @staticmethod
    def _replay(stored) -> Response:
        status, body, headers = stored
        return Response(content=body, status_code=status, headers=dict(headers))

    async def _fill(self, request: Request, call_next, path: str, cache_key: str) -> Response:
        """실제로 내려가서 받아 오고, 200 이면 담아 둔다."""
        response = await call_next(request)
        if any(part in path for part in VOLATILE_READS):
            window = self.settings.volatile_cache_seconds
            response.headers.setdefault("Cache-Control", f"public, max-age=0, s-maxage={window}, stale-while-revalidate=60")
        else:
            window = self.settings.public_cache_seconds
            response.headers.setdefault("Cache-Control", f"public, max-age=60, s-maxage={window}, stale-while-revalidate=600")
        # 200 만 담는다. 오류를 담아 두면 백엔드가 잠깐 흔들린 것이 창 하나만큼
        # 그대로 굳어 버린다.
        if response.status_code != 200:
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        headers = [(key, value) for key, value in response.headers.items() if key.lower() != "content-length"]
        cache.set(cache_key, (200, body, headers), window, self.settings.cache_spread_seconds)
        return Response(content=body, status_code=200, headers=dict(headers))
