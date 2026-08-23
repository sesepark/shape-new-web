import json

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Notification, PushSubscription, User, UserStatus


async def publish_notice_notifications(db: AsyncSession, notice_id, title: str) -> None:
    users = (await db.scalars(select(User).where(User.status == UserStatus.APPROVED))).all()
    db.add_all([Notification(user_id=user.id, notice_id=notice_id, title=title) for user in users])
    await db.flush()
    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        return
    subscriptions = (await db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_([user.id for user in users])))).all()
    # The service worker reads a JSON payload so it can open the board directly.
    payload = json.dumps({"title": title, "body": "SHAPE 게시판에 새 글이 올라왔습니다.", "url": f"{settings.frontend_url}/notices"})
    for subscription in subscriptions:
        try:
            webpush(subscription_info={"endpoint": subscription.endpoint, "keys": subscription.subscription_keys}, data=payload, vapid_private_key=settings.vapid_private_key, vapid_claims={"sub": settings.vapid_claims_email})
        except WebPushException:
            # Delivery failures do not roll back the published notice; the subscription can be renewed on the next visit.
            continue
