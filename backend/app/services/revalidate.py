"""Ask the Next.js site to refresh the pages an admin edit just changed."""

import asyncio
import logging

import httpx

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
    "roadmap": ["/roadmap", "/roadmap/shape-up", "/roadmap/competition", "/roadmap/education"],
    "links": ["/links"],
    "shape-up": ["/shape-up", "/sitemap.xml"],
    "pages": ["/greeting", "/about", "/organization", "/members"],
}


async def _post(paths: list[str]) -> None:
    settings = get_settings()
    if not settings.revalidate_secret:
        return
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            await client.post(
                f"{settings.frontend_url}/api/revalidate",
                json={"paths": paths},
                headers={"x-revalidate-secret": settings.revalidate_secret},
            )
    except httpx.HTTPError as error:
        # A refresh failure must never fail the save; the page still updates
        # on its own within the normal cache window.
        logger.warning("revalidate failed: %s", error)


def refresh(kind: str, extra: list[str] | None = None) -> None:
    """Fire and forget so the admin request returns without waiting."""
    paths = PATHS.get(kind, []) + (extra or [])
    if not paths:
        return
    task = asyncio.create_task(_post(paths))
    _running.add(task)
    task.add_done_callback(_running.discard)
