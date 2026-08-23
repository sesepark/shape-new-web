from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import PermissionGrant, User, UserStatus

COOKIE_NAME = "shape_session"


def create_session_token(user_id: UUID) -> str:
    settings = get_settings()
    payload = {"sub": str(user_id), "exp": datetime.now(UTC) + timedelta(days=14)}
    return jwt.encode(payload, settings.session_secret, algorithm="HS256")


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")
    try:
        user_id = UUID(jwt.decode(token, get_settings().session_secret, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="세션이 만료되었습니다.") from exc
    user = await db.get(User, user_id)
    if not user or user.deleted_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다.")
    return user


async def optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    """The visitor when they are signed in, otherwise None. Never raises."""
    if not request.cookies.get(COOKIE_NAME):
        return None
    try:
        return await current_user(request, db)
    except HTTPException:
        return None


async def approved_user(user: User = Depends(current_user)) -> User:
    if user.status != UserStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="승인된 회원만 이용할 수 있습니다.")
    return user


async def has_permission(db: AsyncSession, user: User, permission: str) -> bool:
    """Owners always pass; everyone else needs the explicit grant."""
    if user.is_owner:
        return True
    return bool(await db.scalar(select(PermissionGrant.id).where(PermissionGrant.user_id == user.id, PermissionGrant.permission == permission)))


def require_permission(permission: str):
    async def checker(user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)) -> User:
        if user.is_owner:
            return user
        if not await has_permission(db, user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리 권한이 없습니다.")
        return user
    return checker


async def any_manager(user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)) -> User:
    """Anyone who manages some part of the site may read the member directory."""
    if user.is_owner:
        return user
    grant = await db.scalar(select(PermissionGrant.id).where(PermissionGrant.user_id == user.id))
    if not grant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리 권한이 없습니다.")
    return user


async def owner_only(user: User = Depends(approved_user)) -> User:
    if not user.is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="owner 권한이 필요합니다.")
    return user
