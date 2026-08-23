from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import License, PermissionGrant, User, UserLicense, UserStatus
from app.schemas import ProfileWrite, SessionUser
from app.security import COOKIE_NAME, create_session_token, current_user

router = APIRouter(prefix="/auth", tags=["auth"])
oauth = OAuth()


def google_client():
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(503, "Google OAuth 설정이 아직 완료되지 않았습니다.")
    return oauth.register("google", client_id=settings.google_client_id, client_secret=settings.google_client_secret, server_metadata_url="https://accounts.google.com/.well-known/openid-configuration", client_kwargs={"scope": "openid email profile"})


def cookie_options():
    settings = get_settings()
    return {"httponly": True, "secure": settings.frontend_url.startswith("https"), "samesite": "lax", "domain": settings.cookie_domain, "path": "/"}


async def session_for(db: AsyncSession, user: User) -> SessionUser:
    permissions = list((await db.scalars(select(PermissionGrant.permission).where(PermissionGrant.user_id == user.id))).all())
    licenses = list((await db.scalars(select(License.name).join(UserLicense, License.id == UserLicense.license_id).where(UserLicense.user_id == user.id, License.is_active.is_(True)))).all())
    return SessionUser(id=user.id, name=user.name, email=user.email, image_url=user.image_url, introduction=user.introduction, status=user.status, is_owner=user.is_owner, permissions=permissions, licenses=licenses)


@router.get("/google/start")
async def google_start(request: Request):
    client = google_client()
    return await client.authorize_redirect(request, f"{get_settings().api_base_url}/api/v1/auth/google/callback")


@router.get("/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    client = google_client()
    token = await client.authorize_access_token(request)
    userinfo = token.get("userinfo") or await client.userinfo(token=token)
    email = userinfo["email"].lower()
    user = await db.scalar(select(User).where(User.google_sub == userinfo["sub"]))
    owner = email in get_settings().owner_emails
    if not user:
        user = User(google_sub=userinfo["sub"], email=email, name=userinfo.get("name") or email, image_url=userinfo.get("picture"), is_owner=owner, status=UserStatus.APPROVED if owner else UserStatus.PENDING)
        db.add(user)
    else:
        user.name = userinfo.get("name") or user.name
        # A member who uploaded their own portrait keeps it; only fall back to
        # the Google avatar while no picture has been chosen on SHAPE.
        if not user.image_url:
            user.image_url = userinfo.get("picture")
        if owner:
            user.is_owner, user.status = True, UserStatus.APPROVED
    await db.commit(); await db.refresh(user)
    response = RedirectResponse(get_settings().frontend_url + "/mypage", status_code=302)
    response.set_cookie(COOKIE_NAME, create_session_token(user.id), max_age=60 * 60 * 24 * 14, **cookie_options())
    return response


@router.get("/me", response_model=SessionUser)
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await session_for(db, user)


@router.patch("/me", response_model=SessionUser)
async def update_me(payload: ProfileWrite, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user.name = payload.name
    user.image_url = payload.image_url or None
    user.introduction = (payload.introduction or "").strip() or None
    await db.commit(); await db.refresh(user)
    return await session_for(db, user)


@router.post("/logout", status_code=204)
async def logout(response: Response):
    options = cookie_options()
    # The delete has to repeat the attributes the cookie was written with or the
    # browser keeps the original session cookie.
    response.delete_cookie(COOKIE_NAME, domain=options["domain"], path=options["path"], secure=options["secure"], httponly=True, samesite="lax")
