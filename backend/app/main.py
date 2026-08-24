import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.middleware import CostGuardMiddleware
from app.routers import admin, auth, media, member, public

logger = logging.getLogger(__name__)


def _upgrade_schema() -> None:
    """서버가 뜰 때 데이터베이스 구조를 최신으로 맞춘다.

    Render 는 새 코드를 밀어 넣으면 알아서 배포하는데, 마이그레이션은 사람이
    따로 실행해야 했다. 그 사이에 새 컬럼을 읽는 코드가 먼저 올라가면 그 기능이
    통째로 500 이 된다(알림에 갈 곳 칸을 더할 때 실제로 그럴 뻔했다). 무료
    티어라 서버가 하나뿐이므로, 뜰 때 한 번 맞추는 편이 안전하다.

    실패해도 서버는 계속 뜬다. 마이그레이션 하나가 잘못돼서 사이트 전체가 닫히는
    쪽이 더 나쁘다. 대신 기록을 남겨 배포 로그에서 바로 보이게 한다.
    """
    from alembic.config import Config

    from alembic import command

    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, "head")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # SQLite 로 도는 자동 시험과 로컬 개발은 표를 직접 만들어 쓰므로 건너뛴다.
    if get_settings().database_url.startswith("postgres"):
        try:
            await asyncio.to_thread(_upgrade_schema)
            logger.info("데이터베이스 구조를 최신으로 맞췄습니다.")
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 서버는 떠야 한다
            logger.error("마이그레이션 실패: %s", error)
    yield


settings = get_settings()
app = FastAPI(title="SHAPE API", version="1.0.0", lifespan=lifespan)
# 한글 JSON 은 \uXXXX 로 나가서 압축이 특히 잘 듣는다(측정: 55~68% 절감).
# 앞단에 프록시가 없으므로 압축은 앱이 직접 한다.
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(CostGuardMiddleware)
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, https_only=settings.frontend_url.startswith("https"), same_site="lax")
app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_url], allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Idempotency-Key"])
app.include_router(auth.router, prefix="/api/v1")
app.include_router(public.router, prefix="/api/v1")
app.include_router(member.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}
