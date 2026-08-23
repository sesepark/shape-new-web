from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.middleware import CostGuardMiddleware
from app.routers import admin, auth, media, member, public


@asynccontextmanager
async def lifespan(_: FastAPI):
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
