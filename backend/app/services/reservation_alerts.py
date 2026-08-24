"""장비 예약을 둘러싼 알림.

예약은 신청한 사람과 운영진이 번갈아 무언가를 해야 진행됩니다. 그런데 화면을 직접
열어 보기 전에는 차례가 왔는지 알 수 없었습니다. 신청한 사람은 승인을 기다리고,
운영진은 신청이 온 줄 모르고, 사용 시간이 지나도 사진을 올려야 하는지 모릅니다.

알림은 두 갈래로 생깁니다.

* **바로 보내는 것** — 승인·반려·취소처럼 누군가 단추를 누르는 순간 생깁니다.
* **시간이 되어 보내는 것** — 사용 시작 시각, 사용이 끝난 뒤 사진 요청입니다.
  이것은 `sweep_due` 가 훑어서 보냅니다.

`sweep_due` 는 따로 도는 시계(크론)를 두지 않고 **들어오는 요청에 얹어** 돕니다.
무료 요금제에서는 주기적으로 서버를 깨우는 것 자체가 비용입니다(깨어 있는 시간만큼
데이터베이스 시간을 씁니다). 대신 사람이 사이트를 쓰는 동안에만 확인하므로, 아무도
들어오지 않는 새벽에는 알림이 조금 늦게 갈 수 있습니다.
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Equipment,
    EquipmentUnit,
    Notification,
    Reservation,
    ReservationStatus,
    User,
)
from app.services.notifications import devices_of

SEOUL = ZoneInfo("Asia/Seoul")
# 예약 알림을 누르면 가는 곳. 신청한 사람은 마이페이지에서 자기 예약을 봅니다.
MEMBER_URL = "/mypage"


def when(moment: datetime) -> str:
    """알림 제목에 넣을 시각. 한국 시각으로 적습니다."""
    return moment.astimezone(SEOUL).strftime("%m월 %d일 %H:%M")


async def label(db: AsyncSession, reservation: Reservation) -> str:
    """'AI Worker 1호기' 처럼 무엇을 예약했는지 한 줄로."""
    unit = await db.get(EquipmentUnit, reservation.equipment_unit_id)
    equipment = await db.get(Equipment, unit.equipment_id) if unit else None
    return " ".join(part for part in [getattr(equipment, "name", ""), getattr(unit, "label", "")] if part)


async def tell_owner(db: AsyncSession, reservation: Reservation, title: str) -> list[dict]:
    """예약을 신청한 사람에게 알립니다. 커밋은 부르는 쪽에서 합니다."""
    db.add(Notification(user_id=reservation.user_id, title=title, url=MEMBER_URL))
    await db.flush()
    return await devices_of(db, [reservation.user_id])


async def sweep_due(db: AsyncSession) -> list[tuple[str, str, list[dict]]]:
    """때가 된 알림을 만들어 (제목, 본문, 기기목록) 목록으로 돌려줍니다.

    두 가지를 봅니다.

    1. **사용 시간이 된 예약** — 확정된 예약의 시작 시각이 지났는데 아직 알리지
       않았다면 알립니다. 사용 전 사진을 올리고 시작해야 한다는 안내입니다.
    2. **사용이 끝났는데 사진이 없는 예약** — 끝난 시각이 지났고 사용 후 사진이
       아직 없으면 한 번 알립니다.

    이미 보낸 것은 `start_notified_at`·`photo_notified_at` 으로 가려냅니다.
    """
    now = datetime.now(UTC)
    out: list[tuple[str, str, list[dict]]] = []

    starting = (await db.scalars(
        select(Reservation).where(
            Reservation.status.in_([ReservationStatus.APPROVED, ReservationStatus.IN_USE]),
            Reservation.starts_at <= now,
            Reservation.ends_at > now,
            Reservation.start_notified_at.is_(None),
        ).limit(50)
    )).all()
    for item in starting:
        name = await label(db, item)
        title = f"사용 시간입니다 · {name}"
        item.start_notified_at = now
        out.append((title, "사용 전 사진을 올리고 사용을 시작해 주세요.", await tell_owner(db, item, title)))

    ended = (await db.scalars(
        select(Reservation).where(
            Reservation.status.in_([ReservationStatus.APPROVED, ReservationStatus.IN_USE]),
            Reservation.ends_at <= now,
            Reservation.after_photo_url.is_(None),
            Reservation.photo_notified_at.is_(None),
        ).limit(50)
    )).all()
    for item in ended:
        name = await label(db, item)
        title = f"사용 후 사진을 올려 주세요 · {name}"
        item.photo_notified_at = now
        out.append((title, "사용이 끝났습니다. 정리 상태를 사진으로 남겨 주세요.", await tell_owner(db, item, title)))

    if out:
        await db.commit()
    return out


async def owners_and_managers(db: AsyncSession) -> list[User]:
    """예약을 승인할 수 있는 사람. 지금은 owner 입니다."""
    from app.models import UserStatus

    return list((await db.scalars(
        select(User).where(User.is_owner.is_(True), User.deleted_at.is_(None), User.status == UserStatus.APPROVED)
    )).all())
