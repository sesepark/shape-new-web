"""Ask the Next.js site to refresh the pages an admin edit just changed."""

import asyncio
import logging

import httpx

from app import cache
from app.config import get_settings

logger = logging.getLogger(__name__)
TIMEOUT = 4.0
# asyncio 는 태스크를 약한 참조로만 들고 있어서, 여기서 붙들지 않으면 실행 도중
# 회수될 수 있다. 회수되면 공개 페이지가 조용히 옛 내용을 계속 보여 준다.
_running: set[asyncio.Task] = set()

# Which public routes each kind of edit affects.
PATHS: dict[str, list[str]] = {
    "news": ["/news", "/news/press", "/sitemap.xml"],
    "notices": ["/notices"],
    "equipment": ["/equipment", "/equipment/reserve", "/sitemap.xml"],
    # 홈의 '일정' 칸이 로드맵을 그대로 쓴다. 로드맵을 고치면 홈도 함께 새로 그린다.
    "roadmap": ["/", "/roadmap", "/roadmap/shape-up", "/roadmap/competition", "/roadmap/education"],
    "links": ["/links"],
    "shape-up": ["/shape-up", "/sitemap.xml"],
    "pages": ["/", "/greeting", "/about", "/organization", "/members"],
}


async def _post(paths: list[str]) -> None:
    """공개 페이지를 새로 그리게 한다. 실패하면 한 번만 다시 시도한다.

    공개 데이터의 재검증 주기를 5분에서 한 시간으로 늘리면서, 이 요청이 실패했을
    때 치르는 값도 그만큼 커졌다. 예전에는 늦어도 5분이면 저절로 맞았지만 지금은
    한 시간이다. Render 무료 인스턴스는 잠들었다 깨는 중이거나 배포 직후일 수
    있어 한 번쯤 실패하는 것은 드문 일이 아니므로, 짧게 한 번 더 두드린다.

    두 번 다 실패해도 저장은 성공한 것이다. 화면이 늦게 바뀌는 것과 저장이 안 되는
    것 중에서는 앞이 낫다. 다만 기록은 남겨 배포 로그에서 보이게 한다.
    """
    settings = get_settings()
    if not settings.revalidate_secret:
        return
    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.post(
                    f"{settings.frontend_url}/api/revalidate",
                    json={"paths": paths},
                    headers={"x-revalidate-secret": settings.revalidate_secret},
                )
            if response.is_success:
                return
            # 401·503 은 다시 두드려도 같으므로(비밀값이 어긋났거나 아직 설정 전),
            # 재시도 없이 바로 알린다.
            if response.status_code in {401, 403, 503}:
                logger.warning("revalidate 거절됨(%s). 두 서버의 REVALIDATE_SECRET 을 확인하세요.", response.status_code)
                return
            reason: object = response.status_code
        except httpx.HTTPError as error:
            reason = error
        if attempt == 1:
            await asyncio.sleep(1.0)
    logger.warning("revalidate 두 번 다 실패: %s · 공개 페이지가 최대 한 시간 늦게 바뀝니다.", reason)


def refresh(kind: str, extra: list[str] | None = None) -> None:
    """Fire and forget so the admin request returns without waiting."""
    # 백엔드가 들고 있던 공개 응답을 먼저 버린다. 이 순서를 지키지 않으면
    # 아래 재검증 요청이 되돌아왔을 때 방금 지운 옛 값을 다시 받아 가서,
    # 저장했는데도 화면이 그대로인 상태가 창 하나만큼 이어진다.
    cache.clear()
    paths = PATHS.get(kind, []) + (extra or [])
    if not paths:
        return
    task = asyncio.create_task(_post(paths))
    _running.add(task)
    task.add_done_callback(_running.discard)
