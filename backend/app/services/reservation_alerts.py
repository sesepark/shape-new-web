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
from app.services import reservation_policy
from app.services.notifications import devices_of, publish_owner_notifications
from app.services.reservations import overlapping_pending, unit_title

SEOUL = ZoneInfo("Asia/Seoul")
# 사진 독촉과 운영진 독촉 시점은 **관리자 화면에서 정합니다**
# (`services/reservation_policy.py`). `sweep_due` 가 매번 설정을 읽어 씁니다.
# 독촉을 자동 확정보다 앞에 두는 뜻은 그대로입니다 — 시계가 대신 누르기 전에
# 운영진이 직접 볼 틈을 남깁니다.
# 운영진 알림을 누르면 가는 곳.
STAFF_URL = "/admin"
# 예약 알림을 누르면 가는 곳. 신청한 사람은 마이페이지에서 자기 예약을 봅니다.
MEMBER_URL = "/mypage"


def _utc(value: datetime) -> datetime:
    """로컬 SQLite 는 시간대를 잃으므로 비교 전에 UTC 로 맞춥니다."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _span(minutes: int) -> str:
    """분을 사람이 읽는 길이로. 알림 본문이 "60분 전" 이 아니라 "1시간 전" 이 되게."""
    if minutes % 60 == 0 and minutes >= 60:
        return f"{minutes // 60}시간"
    if minutes > 60:
        return f"{minutes // 60}시간 {minutes % 60}분"
    return f"{minutes}분"


def when(moment: datetime) -> str:
    """알림 제목에 넣을 시각. 한국 시각으로 적습니다."""
    return moment.astimezone(SEOUL).strftime("%m월 %d일 %H:%M")


async def label(db: AsyncSession, reservation: Reservation) -> str:
    """'AI Worker 1호기' 처럼 무엇을 예약했는지 한 줄로."""
    unit = await db.get(EquipmentUnit, reservation.equipment_unit_id)
    equipment = await db.get(Equipment, unit.equipment_id) if unit else None
    return unit_title(getattr(equipment, "name", ""), getattr(unit, "label", ""))


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
    2. **시작하고 30분이 지나도 사용 전 사진이 없는 예약** — 한 번 더 재촉합니다.
       사진은 장비 상태를 확인하는 유일한 기록이라 놓치면 되돌릴 수 없습니다.
    3. **사용이 끝났는데 사진이 없는 예약** — 끝난 시각이 지났고 사용 후 사진이
       아직 없으면 한 번 알립니다.
    4. **시작이 두 시간 앞인데 아직 대기 중인 신청** — 운영진에게 알립니다.
       이 훑기는 알림만 만들고 **아무 상태도 바꾸지 않습니다.** 자동 확정과
       자동 만료는 `reservation_sweeps` 가 따로 맡습니다.

    이미 보낸 것은 `*_notified_at` 칸으로 가려냅니다.
    """
    now = datetime.now(UTC)
    out: list[tuple[str, str, list[dict]]] = []
    policy = await reservation_policy.current(db)
    photo_grace = policy.before_photo_grace
    reminder_lead = policy.staff_reminder_lead

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

    # 사용 시간이 지났는데 사용 전 사진이 없는 예약. 시작 알림과 따로 한 번 더
    # 알립니다. 사진은 장비 상태를 확인하는 유일한 기록이라 놓치면 되돌릴 수 없습니다.
    late = (await db.scalars(
        select(Reservation).where(
            Reservation.status.in_([ReservationStatus.APPROVED, ReservationStatus.IN_USE]),
            Reservation.starts_at <= now - photo_grace,
            Reservation.ends_at > now,
            Reservation.before_photo_url.is_(None),
            Reservation.before_photo_notified_at.is_(None),
        ).limit(50)
    )).all()
    for item in late:
        name = await label(db, item)
        title = f"사용 전 사진이 아직 없습니다 · {name}"
        item.before_photo_notified_at = now
        out.append((title, "사용을 시작하기 전에 장비 상태를 사진으로 남겨 주세요.", await tell_owner(db, item, title)))

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

    # 아직 대기 중인데 시작이 코앞인 신청. 운영진에게 한 번 더 알립니다.
    #
    # 처음부터 두 시간 안쪽으로 들어온 신청은 접수 알림이 이미 그 역할을 했으므로
    # 여기서 또 울리지 않습니다(아래 `late_arrival`). 그 비교는 컬럼끼리 시각을
    # 빼는 일이라 SQL 로 쓰면 Postgres 와 SQLite 문법이 갈립니다. 후보가 몇 건
    # 되지 않으므로 읽어 와서 파이썬에서 거릅니다.
    unattended = (await db.scalars(
        select(Reservation).where(
            Reservation.status == ReservationStatus.PENDING,
            Reservation.starts_at <= now + reminder_lead,
            Reservation.ends_at > now,
            Reservation.staff_reminded_at.is_(None),
        ).limit(50)
    )).all()
    for item in unattended:
        late_arrival = item.created_at and _utc(item.created_at) > _utc(item.starts_at) - reminder_lead
        if late_arrival:
            # 접수 알림이 곧 독촉이었던 신청입니다. 다시 울리지 않도록 자국만 남깁니다.
            item.staff_reminded_at = now
            continue
        name = await label(db, item)
        item.staff_reminded_at = now
        title = f"아직 승인하지 않은 예약이 있습니다 · {name} · {when(item.starts_at)}"
        # 운영진이 실제로 알고 싶은 것은 "내가 지금 움직여야 하는가" 입니다.
        # 겹치는 신청이 있으면 자동 확정이 막히므로 사람이 반드시 골라야 하고,
        # 없으면 그냥 두어도 한 시간 전에 저절로 확정됩니다.
        rival = await overlapping_pending(db, item)
        body = (
            "같은 시간에 다른 신청이 있어 자동으로 확정되지 않습니다. 직접 골라 주세요."
            if rival else f"{_span(policy.auto_approve_minutes)} 전까지 처리하지 않으면 자동으로 확정됩니다."
        )
        out.append((title, body, await publish_owner_notifications(db, title, STAFF_URL)))

    if out:
        await db.commit()
    return out


async def owners_and_managers(db: AsyncSession) -> list[User]:
    """예약을 승인할 수 있는 사람. 지금은 owner 입니다."""
    from app.models import UserStatus

    return list((await db.scalars(
        select(User).where(User.is_owner.is_(True), User.deleted_at.is_(None), User.status == UserStatus.APPROVED)
    )).all())


async def tell_user(db: AsyncSession, user_id, title: str, url: str = MEMBER_URL) -> list[dict]:
    """회원 한 사람에게 알립니다. 커밋은 부르는 쪽에서 합니다."""
    db.add(Notification(user_id=user_id, title=title, url=url))
    await db.flush()
    return await devices_of(db, [user_id])


async def tell_upcoming_users(db: AsyncSession, equipment_id, title: str) -> list[dict]:
    """이 장비를 앞으로 쓰기로 되어 있는 사람들에게 알립니다.

    장비를 점검 중으로 돌리면 그 시간에 오려던 사람이 헛걸음합니다. 아직 오지
    않은 예약(대기·확정)만 봅니다 — 이미 끝난 예약에는 알릴 것이 없습니다.
    """
    now = datetime.now(UTC)
    rows = (await db.scalars(
        select(Reservation)
        .join(EquipmentUnit, EquipmentUnit.id == Reservation.equipment_unit_id)
        .where(
            EquipmentUnit.equipment_id == equipment_id,
            Reservation.starts_at > now,
            Reservation.status.in_([ReservationStatus.PENDING, ReservationStatus.APPROVED]),
        )
    )).all()
    people = {row.user_id for row in rows}
    if not people:
        return []
    db.add_all([Notification(user_id=person, title=title, url=MEMBER_URL) for person in people])
    await db.flush()
    return await devices_of(db, list(people))
