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
from app.services import media_sweep

API_PREFIX = "/api/v1"
# Only these reads are safe to store on a shared CDN. Everything else — sessions,
# notifications, member notices, reservations — must stay private, so the list is
# an allowlist instead of a list of paths to exclude.
# 앞머리로 여는 것과 주소 하나만 여는 것을 나눈다. `/roadmap` 은 반드시 뒤쪽이다.
# 앞머리로 열어 두면 `/roadmap/me`(회원 본인의 일정)까지 걸려든다. 지금은 그 창구가
# 로그인을 요구해서 새지 않지만, 공개 여부를 **인증 하나에만** 기대게 된다.
PUBLIC_READS = ("/pages/", "/news", "/equipment/", "/links", "/push/public-key", "/member-profiles", "/shape-up")
# `/reservation-policy` 는 규칙 값만 돌려줍니다. 누구의 예약도 실리지 않으므로
# 공유 캐시에 올려도 남의 정보가 새지 않습니다.
PUBLIC_EXACT = ("/equipment", "/roadmap", "/reservation-policy")
# Availability changes the moment a reservation is approved, so it gets a much
# shorter shared cache than the editorial content.
VOLATILE_READS = ("/availability",)


logger = logging.getLogger(__name__)

# 때가 된 예약 알림을 얼마나 자주 확인할지.
#
# 3분은 짧아 보이지만 **로그인한 회원의 요청에서만** 보기 때문에 값이 들지
# 않습니다(아래 `maybe_sweep_alerts` 의 설명). 회원 요청은 어차피 `/auth/me` 로
# 데이터베이스를 여니, 거기 얹히는 확인은 이미 깨어 있는 Neon 을 쓰는 셈입니다.
SWEEP_EVERY = 180.0
_last_sweep = 0.0
# asyncio 는 태스크를 약한 참조로만 들고 있어서, 여기서 붙들지 않으면 도중에
# 회수될 수 있다. 회수되면 알림이 조용히 사라진다.
_sweeps: set[asyncio.Task] = set()


async def _sweep_reservation_alerts() -> None:
    """때가 된 예약 알림을 보내고, 시계가 대신 누를 것을 누릅니다.

    따로 도는 시계(크론)를 두지 않는 이유는 무료 요금제 때문입니다. 주기적으로
    서버를 깨우면 깨어 있는 시간만큼 데이터베이스 시간을 쓰는데, 그 시간이 한 달
    한도에서 가장 먼저 닳습니다. 사람이 사이트를 쓰는 동안에만 확인합니다.

    실패해도 요청에는 영향을 주지 않습니다. 알림 하나 때문에 화면이 느려지거나
    오류가 나면 안 됩니다.
    """
    from app.database import SessionLocal
    from app.services.notifications import deliver_push
    from app.services.reservation_alerts import STAFF_URL, sweep_due
    from app.services.reservation_sweeps import sweep_auto_decisions

    try:
        async with SessionLocal() as db:
            # 같은 세션 안에서 이어 봅니다. 세션을 새로 열면 Neon 을 한 번 더
            # 두드리는 셈이 됩니다. 알림이 먼저인 것도 일부러입니다 — 자동 확정이
            # 만드는 알림까지 이번 차례에 함께 나가야 합니다.
            due = await sweep_due(db)
            due += await sweep_auto_decisions(db)
        for title, body, devices in due:
            # 운영진 독촉만 관리자 화면으로 보냅니다. 나머지는 신청한 본인에게
            # 가는 알림이라 마이페이지가 맞습니다.
            path = STAFF_URL if title.startswith("아직 승인하지 않은") else "/mypage"
            await deliver_push(devices, title, body=body, path=path)
    except Exception as error:  # noqa: BLE001 - 알림 때문에 사이트가 흔들리면 안 된다
        logger.warning("예약 알림 확인 실패: %s", error)


def maybe_sweep_alerts(signed_in: bool) -> None:
    """때가 됐으면 뒤에서 예약 알림을 확인합니다. 요청은 기다리지 않습니다.

    **로그인한 회원의 요청에서만 봅니다.** 예약을 가진 사람은 회원뿐이고, 회원
    요청은 어차피 `/auth/me` 로 데이터베이스를 열어 Neon 을 깨웁니다. 그러니 거기
    얹히는 확인은 추가 비용이 사실상 없습니다.

    반대로 로그인하지 않은 방문과 검색 크롤러는 지금 Neon 을 **아예 건드리지
    않습니다**(쿠키가 없으면 `/auth/me` 가 조회 없이 답하고, 공개 페이지는 캐시에서
    나갑니다). 여기에 3분마다 조회를 얹으면 Neon 이 공개 트래픽이 이어지는 내내
    깨어 있게 되어, 공개 캐시로 아낀 것이 그대로 사라집니다. 그래서 주기를 늘리는
    대신 **보는 대상을 좁혔습니다.** 알림은 3분 안에 그대로 나갑니다.

    남는 대가 하나: 아무 회원도 사이트에 없으면 알림이 기다립니다. 새벽에 끝난
    예약의 사진 요청은 아침에 누가 들어와야 나갑니다. 크론 없이 도는 구조의
    대가이고, `app/services/reservation_alerts.py` 에도 같은 설명이 있습니다.

    고아 파일 정리(`media_sweep`)와 달리 서버가 뜬 직후 첫 요청에서도 곧바로
    한 번 봅니다. 훑는 것이 인덱스 걸린 조회 셋뿐이라 가볍고, 무료 인스턴스는
    자주 잠들었다 깨므로 깬 직후가 밀린 알림을 내보낼 첫 기회이기 때문입니다.
    """
    global _last_sweep
    if not signed_in:
        return
    now = time.monotonic()
    if now - _last_sweep < SWEEP_EVERY:
        return
    _last_sweep = now
    task = asyncio.create_task(_sweep_reservation_alerts())
    _sweeps.add(task)
    task.add_done_callback(_sweeps.discard)


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

        # 때가 됐으면 아무도 안 쓰는 사진을 뒤에서 정리한다. 무료 요금제에는 크론이
        # 없고, 크론을 흉내 내려고 서버를 주기적으로 깨우면 Neon 이 그만큼 깨어
        # 있어야 한다. 사람이 쓰는 동안에만 한 시간에 한 번 본다.
        media_sweep.maybe_sweep()

        path = request.url.path
        # 로그인한 사람의 요청은 공개 읽기라도 공유 캐시에 넣지 않는다.
        # /shape-up 처럼 같은 주소인데 보는 사람에 따라 canEdit 이 달라지는 응답이
        # 있어서, 공유 캐시가 앞에 붙는 순간 남의 화면에 수정 버튼이 뜬다.
        # 쿠키가 없는 요청(공개 페이지를 그리는 서버 쪽 호출)만 공유 캐시를 쓴다.
        signed_in = COOKIE_NAME in request.cookies
        cacheable = request.method == "GET" and not signed_in and public_read(path)

        # 때가 된 예약 알림을 뒤에서 확인한다. 회원 요청에만 얹으므로 공개
        # 트래픽은 여전히 데이터베이스를 건드리지 않는다.
        maybe_sweep_alerts(signed_in)

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
        # 오류에는 공유 캐시 표시를 붙이지 않는다. 예전에는 헤더를 먼저 붙이고
        # 상태를 나중에 봐서, 쿠키 없이 회원 전용 주소를 두드린 401 응답이
        # `public, s-maxage=3600` 을 달고 나갔다. 앞에 공유 캐시가 붙는 순간
        # 그 401 이 한 시간 동안 모두에게 나간다.
        if response.status_code != 200:
            response.headers.setdefault("Cache-Control", "private, no-store")
            return response
        if any(part in path for part in VOLATILE_READS):
            window = self.settings.volatile_cache_seconds
            response.headers.setdefault("Cache-Control", f"public, max-age=0, s-maxage={window}, stale-while-revalidate=60")
        else:
            window = self.settings.public_cache_seconds
            response.headers.setdefault("Cache-Control", f"public, max-age=60, s-maxage={window}, stale-while-revalidate=600")
        body = b"".join([chunk async for chunk in response.body_iterator])
        headers = [(key, value) for key, value in response.headers.items() if key.lower() != "content-length"]
        cache.set(cache_key, (200, body, headers), window, self.settings.cache_spread_seconds)
        return Response(content=body, status_code=200, headers=dict(headers))
