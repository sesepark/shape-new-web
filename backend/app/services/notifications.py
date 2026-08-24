import asyncio
import json

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Notification, PushSubscription, User, UserStatus


async def publish_owner_notifications(db: AsyncSession, title: str, url: str) -> list[dict]:
    """운영진(owner) 모두에게 알림을 남기고, 그들의 기기 목록을 돌려줍니다.

    장비 예약 신청은 누군가 승인해 줘야 진행됩니다. 그런데 신청이 들어와도 아무
    표시가 없어서, 운영진이 관리자 화면을 직접 열어 보기 전에는 신청이 있는지
    알 수 없었습니다. 신청한 사람은 승인을 기다리는데 아무도 모르는 상태가
    이어집니다.

    받는 사람은 owner 로 한정합니다. 예약을 승인·반려할 수 있는 사람이 owner 와
    예약 관리 권한을 받은 사람인데, 운영진 = owner 라는 것이 이 동아리의 약속
    입니다. 공지 알림과 같은 표를 쓰되 `url` 로 갈 곳만 다르게 둡니다.
    """
    owners = (await db.scalars(
        select(User).where(User.is_owner.is_(True), User.deleted_at.is_(None), User.status == UserStatus.APPROVED)
    )).all()
    if not owners:
        return []
    db.add_all([Notification(user_id=owner.id, title=title, url=url) for owner in owners])
    await db.flush()
    return await devices_of(db, [owner.id for owner in owners])


async def devices_of(db: AsyncSession, user_ids: list) -> list[dict]:
    """알림을 받을 기기 목록. 푸시 열쇠가 없으면 빈 목록입니다."""
    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        return []
    subscriptions = (await db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(user_ids)))).all()
    return [{"endpoint": item.endpoint, "keys": item.subscription_keys} for item in subscriptions]


async def publish_notice_notifications(db: AsyncSession, notice_id, title: str) -> list[dict]:
    """Record the in-app notification for every member and collect their devices.

    Only the database work happens here. The browser push has to wait until the
    notice itself is committed, so the caller gets the device list back and
    delivers it afterwards.
    """
    users = (await db.scalars(select(User).where(User.status == UserStatus.APPROVED))).all()
    db.add_all([Notification(user_id=user.id, notice_id=notice_id, title=title) for user in users])
    await db.flush()
    return await devices_of(db, [user.id for user in users])


def _send_one(subscription: dict, payload: str) -> None:
    settings = get_settings()
    try:
        webpush(subscription_info=subscription, data=payload, vapid_private_key=settings.vapid_private_key, vapid_claims={"sub": settings.vapid_claims_email})
    except WebPushException:
        # 전송 실패가 이미 올라간 공지를 되돌리지는 않는다. 구독은 다음 방문에
        # 다시 등록된다.
        pass


async def deliver_push(subscriptions: list[dict], title: str, body: str | None = None, path: str = "/notices") -> None:
    """Send the browser push for a notice that is already saved.

    `pywebpush` is a synchronous library built on `requests`, so calling it in a
    loop inside the request would block the whole event loop — on Render's free
    tier that is one worker on a tenth of a CPU, meaning every other member's
    request stalls until the last device has been contacted. Handing each send
    to the default thread pool keeps the loop free and bounds how many run at
    once.
    """
    if not subscriptions:
        return
    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        return
    payload = json.dumps({
        "title": title,
        "body": body or "SHAPE 게시판에 새 글이 올라왔습니다.",
        "url": f"{settings.frontend_url}{path}",
    })
    await asyncio.gather(*(asyncio.to_thread(_send_one, subscription, payload) for subscription in subscriptions))
