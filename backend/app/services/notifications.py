import asyncio
import json

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Notification, PushSubscription, User, UserStatus


async def publish_notice_notifications(db: AsyncSession, notice_id, title: str) -> list[dict]:
    """Record the in-app notification for every member and collect their devices.

    Only the database work happens here. The browser push has to wait until the
    notice itself is committed, so the caller gets the device list back and
    delivers it afterwards.
    """
    users = (await db.scalars(select(User).where(User.status == UserStatus.APPROVED))).all()
    db.add_all([Notification(user_id=user.id, notice_id=notice_id, title=title) for user in users])
    await db.flush()
    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        return []
    subscriptions = (await db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_([user.id for user in users])))).all()
    return [{"endpoint": item.endpoint, "keys": item.subscription_keys} for item in subscriptions]


def _send_one(subscription: dict, payload: str) -> None:
    settings = get_settings()
    try:
        webpush(subscription_info=subscription, data=payload, vapid_private_key=settings.vapid_private_key, vapid_claims={"sub": settings.vapid_claims_email})
    except WebPushException:
        # 전송 실패가 이미 올라간 공지를 되돌리지는 않는다. 구독은 다음 방문에
        # 다시 등록된다.
        pass


async def deliver_push(subscriptions: list[dict], title: str) -> None:
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
    payload = json.dumps({"title": title, "body": "SHAPE 게시판에 새 글이 올라왔습니다.", "url": f"{settings.frontend_url}/notices"})
    await asyncio.gather(*(asyncio.to_thread(_send_one, subscription, payload) for subscription in subscriptions))
