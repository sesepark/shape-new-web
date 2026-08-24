import logging
import unicodedata

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import ContentPage, License, PermissionGrant, User, UserLicense, UserStatus
from app.schemas import (
    MemberCardClaim,
    MemberCardItem,
    MemberCardRead,
    ProfileWrite,
    SessionUser,
)
from app.security import COOKIE_NAME, create_session_token, current_user, optional_user, reading_user
from app.services.revalidate import refresh

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
oauth = OAuth()


def google_client():
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(503, "Google OAuth 설정이 아직 완료되지 않았습니다.")
    # 한 번만 등록한다. 요청마다 register 하면 같은 이름의 클라이언트를 계속
    # 새로 만들면서 등록 정보를 덮어쓴다.
    return oauth.create_client("google") or oauth.register(
        "google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


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
    try:
        token = await client.authorize_access_token(request)
    except OAuthError as error:
        # 로그인이 실패하는 경우는 대부분 사용자 탓이 아니다. 인증을 오래 끌어
        # 코드가 만료됐거나, 오류 화면을 새로고침해 같은 코드를 두 번 썼거나,
        # 브라우저가 세션 쿠키를 돌려주지 않은 경우다. 그동안은 흰 화면에
        # Internal Server Error 만 떴고 원인을 알 방법이 없었다.
        logger.warning(
            "구글 로그인 실패: %s / 돌아온 state=%r / 세션에 있는 키=%s / 쿠키 이름=%s",
            error, request.query_params.get("state"),
            [key for key in request.session if key.startswith("_state_")],
            list(request.cookies),
        )
        return RedirectResponse(f"{get_settings().frontend_url}/login?error=oauth", status_code=302)
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


@router.get("/me", response_model=SessionUser | None)
async def me(user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    """A visitor is not an error, so this answers with an empty session.

    Every page asks who is signed in. Answering 401 filled the browser console
    with red lines on every public page view and spent a request from the
    shared read budget for nothing.
    """
    return await session_for(db, user) if user else None


def plain(text: str) -> str:
    """이름을 견주기 좋게 다듬습니다.

    같은 '장하람' 이라도 자모가 풀려 저장된 글자(NFD)와 모아진 글자(NFC)는 파이썬
    에서 다른 문자열입니다. 실제로 맥에서 만든 파일 이름이 자모가 풀린 채로 들어온
    적이 있습니다. 띄어쓰기도 사람마다 다르게 넣으므로 함께 지웁니다.
    """
    return unicodedata.normalize("NFC", text or "").replace(" ", "").strip()


def unclaimed(cards: list[dict]) -> list[dict]:
    """아직 아무 계정도 집지 않은 카드."""
    return [card for card in cards if not card.get("userId")]


def name_matches(cards: list[dict], user: User) -> list[MemberCardItem]:
    """아직 아무도 집지 않은, 이름이 같은 카드들."""
    return [
        MemberCardItem(**card_fields(card))
        for card in unclaimed(cards)
        if plain(card.get("name", "")) == plain(user.name)
    ]


@router.get("/me/member-card", response_model=MemberCardRead)
async def my_member_card(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """지금 내게 연결된 부원 카드와, 아직이라면 내 것으로 보이는 후보.

    부원 카드와 구글 계정을 잇는 일은 본인이 합니다. 운영진이 마흔 명을 하나씩
    맞춰 주는 것보다, 각자 로그인해서 자기 카드를 집는 편이 정확하고 빠릅니다.
    후보는 이름이 같은 카드입니다. 다만 구글 계정 이름이 영문이거나 띄어쓰기가
    달라 하나도 걸리지 않는 경우가 있어, **아직 비어 있는 카드 전부**도 함께
    보냅니다. 본인이 목록에서 직접 고를 수 있게 하기 위해서입니다.
    """
    cards = await member_cards(db)
    mine = next((card for card in cards if str(card.get("userId") or "") == str(user.id)), None)
    if mine:
        return MemberCardRead(card=MemberCardItem(**card_fields(mine)), candidates=[], available=[], my_name=user.name)
    return MemberCardRead(
        card=None,
        candidates=name_matches(cards, user),
        available=[MemberCardItem(**card_fields(card)) for card in unclaimed(cards)],
        my_name=user.name,
    )


@router.post("/me/member-card", response_model=MemberCardRead)
async def claim_member_card(payload: MemberCardClaim, user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """내 부원 카드를 집습니다.

    **아직 비어 있는 카드면 이름이 달라도 집을 수 있습니다.** 구글 계정 이름이
    영문이거나 띄어쓰기가 달라 이름이 안 맞는 경우가 흔한데, 로그인 자체가 승인된
    부원에게만 열려 있으므로 이름을 강제하는 쪽의 손해가 더 큽니다. 다만 **이미
    다른 계정이 집은 카드는 거절합니다.** 한 카드에 두 사람이 붙으면 누구의 사진과
    소개말이 나가야 하는지 정할 수 없기 때문입니다.

    카드에 사진이 있고 내 계정 사진이 아직 구글에서 가져온 것 그대로이면,
    카드 사진을 내 사진으로 삼습니다. 두 사진이 갈려 있던 것을 하나로 모으는
    자리가 여기입니다. 마음에 들지 않으면 마이페이지에서 바꾸면 됩니다.
    """
    page, cards = await member_page(db)
    target = next((card for card in cards if str(card.get("id")) == payload.card_id), None)
    if not target:
        raise HTTPException(404, "부원 카드를 찾을 수 없습니다.")
    if target.get("userId") and str(target["userId"]) != str(user.id):
        raise HTTPException(409, "이미 다른 계정이 연결한 카드입니다. 운영진에게 문의해 주세요.")
    # 한 계정은 카드 하나만 가진다. 예전에 집은 카드가 있으면 놓는다.
    updated = []
    for card in cards:
        if str(card.get("id")) == payload.card_id:
            updated.append({**card, "userId": str(user.id)})
        elif str(card.get("userId") or "") == str(user.id):
            updated.append({key: value for key, value in card.items() if key != "userId"})
        else:
            updated.append(card)
    page.content_json = {**(page.content_json or {}), "members": updated}
    if target.get("imageUrl") and (not user.image_url or "googleusercontent.com" in (user.image_url or "")):
        user.image_url = target["imageUrl"]
    await db.commit()
    refresh("pages")
    mine = next(card for card in updated if str(card.get("id")) == payload.card_id)
    return MemberCardRead(card=MemberCardItem(**card_fields(mine)), candidates=[], available=[], my_name=user.name)


@router.delete("/me/member-card", response_model=MemberCardRead)
async def release_member_card(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """내 카드 연결을 놓습니다. 카드 자체는 그대로 남습니다.

    잘못 집었을 때 되돌리는 길입니다. 놓고 나면 다시 후보 목록이 가므로 화면을
    새로 읽지 않아도 곧바로 다른 카드를 고를 수 있습니다. 계정 사진은 그대로
    둡니다. 이미 그 사진으로 알아보고 있을 테니, 바꾸고 싶으면 마이페이지에서
    직접 바꾸는 편이 덜 놀랍습니다.
    """
    page, cards = await member_page(db)
    released = [
        {key: value for key, value in card.items()
         if not (key == "userId" and str(value) == str(user.id))}
        for card in cards
    ]
    page.content_json = {**(page.content_json or {}), "members": released}
    await db.commit()
    refresh("pages")
    return MemberCardRead(
        card=None,
        candidates=name_matches(released, user),
        available=[MemberCardItem(**card_fields(card)) for card in unclaimed(released)],
        my_name=user.name,
    )


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


async def member_page(db: AsyncSession):
    """부원 카드가 담긴 페이지와 그 목록.

    `content_json` 은 제자리에서 고치면 SQLAlchemy 가 바뀐 줄 모른다. 부르는
    쪽이 새 목록을 만들어 통째로 넣도록 사본을 돌려준다.
    """
    page = await db.scalar(select(ContentPage).where(ContentPage.slug == "members"))
    if not page:
        raise HTTPException(404, "부원 페이지가 아직 없습니다.")
    stored = (page.content_json or {}).get("members", [])
    return page, [dict(card) for card in stored if isinstance(card, dict)]


async def member_cards(db: AsyncSession) -> list[dict]:
    page = await db.scalar(select(ContentPage).where(ContentPage.slug == "members"))
    stored = (page.content_json or {}).get("members", []) if page else []
    return [dict(card) for card in stored if isinstance(card, dict)]


def card_fields(card: dict) -> dict:
    """부원 카드에서 화면이 쓰는 값만 뽑는다."""
    return {
        "id": str(card.get("id") or ""),
        "name": str(card.get("name") or ""),
        "role": str(card.get("role") or ""),
        "membership": str(card.get("membership") or ""),
        "image_url": card.get("imageUrl") or None,
    }
