import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentUnit,
    Reservation,
    ReservationCompanion,
    ReservationPurpose,
    ReservationSlot,
    ReservationStatus,
    ReservationUrgency,
    User,
    UserLicense,
)
from app.schemas import ReservationCreate, ReservationRead
from app.security import READING_STATUSES
from app.services import blackouts, google_calendar, reservation_policy

logger = logging.getLogger(__name__)

CANCELLABLE = {ReservationStatus.PENDING, ReservationStatus.APPROVED}
SEOUL = ZoneInfo("Asia/Seoul")

# 자동 확정 시점(기본 한 시간)은 **관리자 화면에서 정합니다.** 값은
# `reservation_policy.current(db).auto_approve_lead` 로 읽고, 설정 행이 아직
# 없을 때의 기본값은 `reservation_policy.DEFAULTS` 한 곳에만 적혀 있습니다.
# 여기에 상수를 다시 두지 마세요 — 두 곳이 어긋나면 어느 쪽이 진짜인지 알 수 없습니다.

PURPOSE_LABEL = {
    ReservationPurpose.CONTEST: "대회",
    ReservationPurpose.SHAPE_UP: "SHAPE-UP",
    ReservationPurpose.EDUCATION: "교육",
    ReservationPurpose.OTHER: "기타",
}
URGENCY_LABEL = {
    ReservationUrgency.HIGH: "매우 시급",
    ReservationUrgency.NORMAL: "보통",
    ReservationUrgency.LOW: "낮음",
}


def unit_title(equipment_name: str | None, unit_label: str | None) -> str:
    """'장비 · 호기' 를 한 줄로. 호기 이름이 이미 장비 이름으로 시작하면 겹쳐 적지 않는다.

    호기는 보통 `OMY 1호기` 처럼 장비 이름을 달고 등록되므로, 그대로 이어 붙이면
    알림 제목이 "OMY OMY 1호기" 가 되어 읽는 사람이 두 번 읽는다. 화면 쪽에도
    같은 규칙이 있다(`lib/booking.ts` 의 `unitTitle`).
    """
    gear = (equipment_name or "").strip()
    unit = (unit_label or "").strip()
    if not unit:
        return gear or "장비"
    if not gear or unit.startswith(gear):
        return unit
    return f"{gear} {unit}"


def as_utc(value: datetime) -> datetime:
    """저장된 시각을 항상 UTC 기준으로 비교한다(로컬 SQLite 는 시간대를 잃는다).

    라우터가 아니라 여기 두는 이유는 서비스 쪽에서도 같은 비교가 필요해졌기
    때문이다. 반대로 두면 `member.py` → 이 파일 → `member.py` 로 import 가 돈다.
    """
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def slots(starts_at, ends_at):
    """예약 구간을 30분 칸으로 편다.

    **30분은 고정이다.** 장비마다 다른 예약 단위(30·60·90·120분)로 바꾸고 싶어
    보이지만, 30분은 그 단위들의 최대공약수다. 단위별로 걸음을 바꾸면 60분짜리
    예약이 깐 슬롯을 30분짜리 예약이 비켜 가고, 그러면 `uq_reservation_slot`
    제약이 겹침을 잡지 못한다. 여기를 '정리' 하지 말 것.
    """
    current = starts_at
    while current < ends_at:
        yield current
        current += timedelta(minutes=30)


def block_floor(moment: datetime, unit_minutes: int) -> datetime:
    """`moment` 가 들어 있는 예약 칸의 시작 시각.

    칸은 **한국 시각 자정**에서부터 `unit_minutes` 씩 끊는다. 화면의 시간표가
    그렇게 그려지기 때문이다 — `equipment-reservation` 의 `slotLabels` 는 벽시계
    자정부터 눈금을 만든다. UTC 자정을 기준으로 끊으면 90분짜리 장비에서 눈금이
    어긋난다(24시간이 90분으로 나눠떨어지지 않아 시차 9시간이 그대로 밀린다).

    한국은 서머타임이 없으므로 자정과의 차이를 그냥 빼도 안전하다.
    """
    local = moment.astimezone(SEOUL)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    step = timedelta(minutes=max(30, unit_minutes))
    return (midnight + (local - midnight) // step * step).astimezone(UTC)


def ceil_30(moment: datetime) -> datetime:
    """다음 30분 눈금으로 올린다.

    조기 반납에서 쓴다. **올림**인 이유는, 17:10 에 끝냈다면 17:00~17:30 칸은
    실제로 쓴 시간이기 때문이다. 내림으로 자르면 이미 쓴 칸이 빈 칸으로 돌아가
    다른 사람이 그 위에 겹쳐 잡을 수 있다.
    """
    trimmed = moment.replace(second=0, microsecond=0)
    if trimmed != moment:
        trimmed += timedelta(minutes=1)
    remainder = trimmed.minute % 30
    return trimmed if remainder == 0 else trimmed + timedelta(minutes=30 - remainder)


async def unit_context(db: AsyncSession, reservations) -> dict:
    """Map every reservation's unit to its label and owning equipment name."""
    unit_ids = {item.equipment_unit_id for item in reservations}
    if not unit_ids:
        return {}
    rows = (await db.execute(
        select(EquipmentUnit.id, EquipmentUnit.label, Equipment.name)
        .join(Equipment, Equipment.id == EquipmentUnit.equipment_id)
        .where(EquipmentUnit.id.in_(unit_ids))
    )).all()
    return {row[0]: (row[1], row[2]) for row in rows}


async def companion_names(db: AsyncSession, reservations) -> dict:
    """예약마다 '함께 쓰는 사람' 이름 목록.

    예약 수만큼 질의하지 않도록 한 번에 읽어 옵니다. 목록 화면은 예약이 수십 건씩
    나오는 자리라, 하나씩 물어보면 그만큼 데이터베이스를 두드립니다.
    """
    ids = [item.id for item in reservations]
    if not ids:
        return {}
    rows = (await db.execute(
        select(ReservationCompanion.reservation_id, User.name)
        .join(User, User.id == ReservationCompanion.user_id)
        .where(ReservationCompanion.reservation_id.in_(ids))
        .order_by(User.name)
    )).all()
    out: dict = {}
    for reservation_id, name in rows:
        out.setdefault(reservation_id, []).append(name)
    return out


async def confirm_outlook(db: AsyncSession, reservations) -> dict:
    """대기 중인 신청마다 (저절로 확정될 시각, 다투는 신청이 있는지).

    화면이 규칙을 설명하는 것만으로는 부족합니다. "같은 시간에 다른 신청이 없으면
    시작 한 시간 전에 저절로 확정됩니다" 는 규칙이지, **내 신청**이 어느 쪽인지는
    말해 주지 않습니다. 그러면 부원은 결국 운영진에게 직접 물어보게 됩니다.

    겹치는 신청이 있으면 시각을 비웁니다 — 그때는 사람이 골라야 하고, 저절로
    확정되지 않는다는 사실 자체가 부원이 알아야 하는 내용입니다.

    질의는 **대기 신청이 하나라도 있을 때만** 한 번 나갑니다. 확정·완료만 있는
    목록(지난 예약 화면이 그렇습니다)에서는 아무것도 더 읽지 않습니다.
    """
    waiting = [item for item in reservations if item.status == ReservationStatus.PENDING]
    if not waiting:
        return {}
    lead = (await reservation_policy.current(db)).auto_approve_lead
    unit_ids = {item.equipment_unit_id for item in waiting}
    first = min(as_utc(item.starts_at) for item in waiting)
    last = max(as_utc(item.ends_at) for item in waiting)
    rivals = (await db.execute(
        select(Reservation.id, Reservation.equipment_unit_id, Reservation.starts_at, Reservation.ends_at).where(
            Reservation.equipment_unit_id.in_(unit_ids),
            Reservation.status == ReservationStatus.PENDING,
            Reservation.starts_at < last,
            Reservation.ends_at > first,
        )
    )).all()
    out: dict = {}
    for item in waiting:
        starts_at, ends_at = as_utc(item.starts_at), as_utc(item.ends_at)
        contested = any(
            other_id != item.id
            and unit_id == item.equipment_unit_id
            and as_utc(other_start) < ends_at
            and as_utc(other_end) > starts_at
            for other_id, unit_id, other_start, other_end in rivals
        )
        out[item.id] = (None if contested else starts_at - lead, contested)
    return out


async def read_models(db: AsyncSession, reservations, model=ReservationRead, extra=None):
    context = await unit_context(db, reservations)
    together = await companion_names(db, reservations)
    outlook = await confirm_outlook(db, reservations) if "auto_confirm_at" in model.model_fields else {}
    result = []
    for item in reservations:
        label, equipment_name = context.get(item.equipment_unit_id, ("", ""))
        fields = model.model_validate(item).model_dump()
        fields.update(unit_label=label, equipment_name=equipment_name, **(extra(item) if extra else {}))
        if "companions" in model.model_fields:
            fields["companions"] = together.get(item.id, [])
        confirm_at, contested = outlook.get(item.id, (None, False))
        if "auto_confirm_at" in model.model_fields:
            fields["auto_confirm_at"], fields["contested"] = confirm_at, contested
        result.append(model(**fields))
    return result


async def assert_eligible(db: AsyncSession, user_id, unit_id) -> tuple[EquipmentUnit, Equipment]:
    """이 사람이 이 호기를 지금 예약할 수 있는지. 호기와 장비를 함께 돌려준다.

    장비를 함께 돌려주는 이유는 부르는 쪽이 `reservation_unit_minutes` 를 알아야
    하기 때문이다 — '지금 돌고 있는 칸' 이 어디서 시작하는지가 거기 달려 있다.
    예전에는 여기서 읽어 놓고 그냥 버렸다.
    """
    unit = await db.get(EquipmentUnit, unit_id)
    if not unit:
        raise HTTPException(404, "장비 예약 단위를 찾을 수 없습니다.")
    equipment = await db.get(Equipment, unit.equipment_id)
    if not equipment or equipment.status.value != "ACTIVE" or unit.status.value != "ACTIVE":
        raise HTTPException(409, "현재 예약할 수 없는 장비입니다.")
    required = (await db.scalars(select(EquipmentLicenseRequirement.license_id).where(EquipmentLicenseRequirement.equipment_id == equipment.id))).all()
    owned = set((await db.scalars(select(UserLicense.license_id).where(UserLicense.user_id == user_id))).all())
    if not set(required).issubset(owned):
        raise HTTPException(403, "필수 라이선스가 없습니다.")
    return unit, equipment


async def create_pending(db: AsyncSession, user_id, payload: ReservationCreate) -> tuple[Reservation, bool, Equipment]:
    """예약을 신청한다. (예약, 새로 만들었는지, 장비) 를 돌려준다."""
    if payload.starts_at >= payload.ends_at or payload.starts_at.minute not in {0, 30}:
        raise HTTPException(422, "예약 시간 범위를 확인해 주세요.")
    now = datetime.now(UTC)
    if payload.starts_at.tzinfo is None or payload.ends_at.tzinfo is None:
        raise HTTPException(422, "시간대가 포함된 예약 시간이 필요합니다.")
    # 상한은 관리자 화면에서 정합니다. 예전에는 180일·12시간이 코드에 박혀 있어
    # 학기마다 조절할 수 없었습니다.
    policy = await reservation_policy.current(db)
    if payload.starts_at > now + policy.booking_window:
        raise HTTPException(422, f"예약은 {policy.booking_window_days}일 이내에서만 신청할 수 있습니다.")
    if payload.ends_at - payload.starts_at > policy.max_span:
        raise HTTPException(422, f"한 번에 최대 {policy.max_hours}시간까지 예약할 수 있습니다.")
    # 장비를 먼저 확인해야 하는 이유: 바로 아래 '지금 돌고 있는 칸' 판정이 그
    # 장비의 예약 단위(30·60·90·120분)에 달려 있다.
    _, equipment = await assert_eligible(db, user_id, payload.equipment_unit_id)

    # **지금 돌고 있는 칸은 예약할 수 있다.** 17시 14분에 17~18시 칸을 잡으려는
    # 것은 정상이다 — 사람이 장비 앞에 서서 신청하기 때문이다. 예전에는 시작
    # 시각이 조금이라도 지나면 막아서, 남은 46분을 아무도 못 쓰고 비워 뒀다.
    #
    # 다만 두 가지는 막는다.
    #  * 이미 끝난 시간 — 쓸 시간이 남아 있지 않다.
    #  * 지금 칸보다 앞선 칸 — 지나간 시간을 소급해 기록으로 남기는 일이 된다.
    if payload.ends_at <= now:
        raise HTTPException(422, "이미 지난 시간은 예약할 수 없습니다.")
    if payload.starts_at < block_floor(now, equipment.reservation_unit_minutes):
        raise HTTPException(422, "지금 사용 중인 칸부터 예약할 수 있습니다.")
    # 운영진이 막아 둔 시간(정비·교육 실습·대회 준비)인지 봅니다. 화면도 그 칸을
    # 눌리지 않게 그리지만, 화면만 믿을 수는 없습니다.
    blocked = await blackouts.check(db, equipment.id, payload.equipment_unit_id, payload.starts_at, payload.ends_at)
    if blocked:
        raise HTTPException(409, f"운영진이 막아 둔 시간입니다. {blocked.reason}".strip())
    taken = await db.scalar(select(ReservationSlot.id).where(
        ReservationSlot.equipment_unit_id == payload.equipment_unit_id,
        ReservationSlot.slot_start >= payload.starts_at,
        ReservationSlot.slot_start < payload.ends_at,
    ))
    if taken:
        raise HTTPException(409, "이미 확정된 예약이 있는 시간입니다.")
    existing = await db.scalar(select(Reservation).where(
        Reservation.user_id == user_id,
        Reservation.equipment_unit_id == payload.equipment_unit_id,
        Reservation.starts_at == payload.starts_at,
        Reservation.ends_at == payload.ends_at,
        Reservation.status == ReservationStatus.PENDING,
    ))
    if existing:
        # 같은 신청을 두 번 보낸 경우다(느린 연결에서 단추를 두 번 누르면 생긴다).
        # 새로 만들지 않고, 새 신청이 아니라는 것도 함께 알린다. 운영진에게 같은
        # 알림이 두 번 가지 않게 하기 위해서다.
        return existing, False, equipment
    fields = payload.model_dump()
    companions = fields.pop("companion_ids", []) or []
    reservation = Reservation(user_id=user_id, **fields)
    db.add(reservation)
    await db.flush()
    await set_companions(db, reservation, companions, user_id)
    await db.commit()
    await db.refresh(reservation)
    return reservation, True, equipment


async def overlapping_pending(db: AsyncSession, reservation: Reservation):
    """같은 호기에서 시간이 겹치는 **다른 대기 신청** 하나. 없으면 None.

    확정된 예약은 볼 필요가 없다. 그쪽은 `ReservationSlot` 이 이미 막고 있다.
    """
    return await db.scalar(select(Reservation.id).where(
        Reservation.equipment_unit_id == reservation.equipment_unit_id,
        Reservation.status == ReservationStatus.PENDING,
        Reservation.id != reservation.id,
        Reservation.starts_at < reservation.ends_at,
        Reservation.ends_at > reservation.starts_at,
    ))


async def try_auto_approve(db: AsyncSession, reservation: Reservation, *, calendar: bool = True) -> bool:
    """때가 됐고 다투는 신청이 없으면 그 자리에서 확정한다. 확정했으면 True.

    규칙은 하나다 — **시작까지 한 시간 이하로 남았고, 같은 호기 같은 시간에 다른
    대기 신청이 없으면 확정한다.** 신청하는 순간 이미 그 안이면(장비 앞에 서서
    지금 칸을 잡는 흔한 경우) 신청과 동시에 확정된다.

    이 함수를 신청 직후와 훑기 양쪽에서 부른다. 규칙이 한 곳에만 적혀 있어야 두
    경로가 어긋나지 않는다.

    **겹치면 손대지 않는다.** 자동으로 한쪽을 고르면 '먼저 신청한 사람' 이 아니라
    '단추를 늦게 누른 사람' 이 이기는 규칙이 된다 — 앞선 신청은 이미 대기 중이라
    자동 확정을 못 받았기 때문이다. 겹친 것은 사람이 본다.

    자동 승인은 기본 경로가 아니라 안전망이다. 신청 즉시 운영진에게 알림이 가고,
    평소에는 사람이 먼저 누른다. 아무도 손대지 않았을 때만 시계가 대신 누른다.
    """
    if reservation.status != ReservationStatus.PENDING:
        return False
    now = datetime.now(UTC)
    lead = (await reservation_policy.current(db)).auto_approve_lead
    if as_utc(reservation.starts_at) > now + lead:
        return False
    if as_utc(reservation.ends_at) <= now:
        return False
    if await overlapping_pending(db, reservation):
        return False
    try:
        await approve(db, reservation, calendar=calendar)
    except HTTPException:
        # 확정만 못 한 것이다. 신청은 그대로 남아 운영진이 보게 된다. 여기서
        # 예외가 새어 나가면 **이미 만들어진** 신청에 대해 응답이 409 로 나가고,
        # 화면은 "실패했다" 고 하지만 실제로는 신청이 들어가 있는 상태가 된다.
        # 두 사람이 같은 초에 같은 칸을 넣으면 실제로 이 길로 온다.
        await db.rollback()
        return False
    reservation.auto_decided_at = now
    await db.commit()
    return True


async def set_companions(db: AsyncSession, reservation: Reservation, wanted, requester_id) -> list[User]:
    """함께 쓰는 사람을 정합니다.

    신청한 사람은 이미 신청자이므로 빼고, **승인된 회원만** 담습니다. 이름만 적어
    두는 것이 아니라 계정을 잇는 이유는, 사고나 파손이 있을 때 실제로 연락할 곳이
    있어야 하고 그 사람에게도 알림을 보내야 하기 때문입니다.

    라이선스는 신청한 사람에게만 따집니다. 함께 쓰는 사람까지 막으면 배우러 온
    사람이 옆에서 볼 수도 없습니다.
    """
    unique = {companion for companion in wanted if companion != requester_id}
    if not unique:
        return []
    people = list((await db.scalars(
        select(User).where(User.id.in_(unique), User.status.in_(READING_STATUSES), User.deleted_at.is_(None))
    )).all())
    if len(people) != len(unique):
        raise HTTPException(422, "함께 쓰는 사람 중 승인되지 않은 계정이 있습니다.")
    db.add_all([ReservationCompanion(reservation_id=reservation.id, user_id=person.id) for person in people])
    await db.flush()
    return people


async def approve(db: AsyncSession, reservation: Reservation, *, calendar: bool = True) -> Reservation:
    if reservation.status != ReservationStatus.PENDING:
        raise HTTPException(409, "대기 예약만 승인할 수 있습니다.")
    if as_utc(reservation.ends_at) <= datetime.now(UTC):
        # 이미 끝난 시간을 승인하면 지나간 칸에 확정 슬롯이 깔려 영원히 잠기고,
        # 구글 캘린더에 과거 일정이 하나 생기고, 곧바로 "사용 후 사진을 올려
        # 주세요" 가 날아간다 — 아무도 쓰지 않은 예약에 대해서.
        #
        # 기준이 `starts_at` 이 아니라 `ends_at` 인 것은 일부러다. 17~18시 예약을
        # 17시 40분에 승인하는 것은 여전히 쓸모가 있고, 승인이 늦었다는 이유로
        # 남은 20분까지 버릴 이유가 없다.
        raise HTTPException(409, "이미 끝난 시간의 예약은 승인할 수 없습니다.")
    unit, equipment = await assert_eligible(db, reservation.user_id, reservation.equipment_unit_id)
    # 신청이 들어온 뒤에 운영진이 그 시간을 막았을 수 있습니다. 막을 때 걸리는
    # 예약을 함께 취소하므로 평소에는 여기까지 오지 않지만, 그 사이에 들어온
    # 신청이 승인되는 길을 열어 두지는 않습니다.
    blocked = await blackouts.check(db, equipment.id, unit.id, as_utc(reservation.starts_at), as_utc(reservation.ends_at))
    if blocked:
        raise HTTPException(409, f"운영진이 막아 둔 시간입니다. {blocked.reason}".strip())
    reservation.status = ReservationStatus.APPROVED
    db.add_all([ReservationSlot(equipment_unit_id=reservation.equipment_unit_id, reservation_id=reservation.id, slot_start=slot) for slot in slots(reservation.starts_at, reservation.ends_at)])
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "승인하려는 시간에 확정된 예약이 있습니다.") from exc
    await db.refresh(reservation)
    # 정기 예약처럼 한 번에 수십 건을 확정하는 자리에서는 캘린더 등록을 뒤로
    # 미룬다. 건마다 구글에 왕복하면 응답이 그만큼 늘어져 무료 인스턴스에서
    # 타임아웃이 난다. 부르는 쪽이 나중에 한꺼번에 올린다.
    if calendar:
        await publish_to_calendar(db, reservation)
    return reservation


async def cancel(db: AsyncSession, reservation: Reservation, reason: str | None = None) -> Reservation:
    """Release the confirmed slots so the time becomes bookable again."""
    if reservation.status not in CANCELLABLE:
        raise HTTPException(409, "대기 또는 확정 상태의 예약만 취소할 수 있습니다.")
    was_approved = reservation.status == ReservationStatus.APPROVED
    await db.execute(delete(ReservationSlot).where(ReservationSlot.reservation_id == reservation.id))
    reservation.status = ReservationStatus.CANCELLED
    if reason:
        reservation.rejection_reason = reason
    await db.commit()
    await db.refresh(reservation)
    # 확정된 적이 있어야 캘린더에 올라가 있습니다. 대기 상태에서 물러난
    # 예약은 애초에 캘린더에 없으므로 구글을 두드릴 이유가 없습니다.
    if was_approved:
        _, equipment_name = (await unit_context(db, [reservation])).get(reservation.equipment_unit_id, ("", ""))
        google_calendar.withdraw(reservation.id, equipment_name)
    return reservation


async def publish_to_calendar(db: AsyncSession, reservation: Reservation) -> None:
    """확정된 예약을 동아리 공유 캘린더에 올립니다. 이미 있으면 덮어씁니다.

    같은 함수를 조기 반납에서도 부릅니다. 일정 식별자가 예약 번호에서 나오므로
    (`google_calendar.event_id`) 새 끝 시각으로 같은 일정이 갱신됩니다.

    승인·취소가 모두 이 파일을 거치므로 여기 한 곳에 두면 관리자 화면에서 취소한
    것과 본인이 마이페이지에서 취소한 것이 같은 길을 탑니다. 구글에 보내는 일은
    기다리지 않으므로 승인 응답이 느려지지 않습니다.
    """
    if not google_calendar.configured():
        return
    _, equipment_name = (await unit_context(db, [reservation])).get(reservation.equipment_unit_id, ("", ""))
    if equipment_name != google_calendar.EQUIPMENT:
        return
    owner = await db.get(User, reservation.user_id)
    google_calendar.publish(
        reservation.id,
        user_name=getattr(owner, "name", ""),
        equipment_name=equipment_name,
        starts_at=reservation.starts_at,
        ends_at=reservation.ends_at,
        purpose=reservation.note or "",
        # 분류만 올립니다. 시급도와 덧붙인 말은 올리지 않습니다 — '휴머노이드 운용'
        # 캘린더는 SHAPE 밖 사람도 보는 곳이고, 시급도는 내부 판단 신호이며 덧붙인
        # 말에는 사람 이름과 마감이 흔히 적힙니다.
        category=PURPOSE_LABEL.get(reservation.purpose_category, ""),
        companions=(await companion_names(db, [reservation])).get(reservation.id, []),
    )


async def publish_many(db: AsyncSession, reservations) -> None:
    """확정된 여러 건을 캘린더에 올립니다. 정기 예약이 부릅니다.

    한 건씩 `publish_to_calendar` 를 부르면 건마다 조회가 셋씩 늘어납니다(호기·
    함께 쓰는 사람·신청자). 서른 건이면 아흔 번입니다. 여기서는 필요한 것을 한
    번에 읽고 돌립니다 — 조회 셋으로 끝납니다.

    구글에 보내는 일 자체는 `google_calendar.publish` 가 기다리지 않고 띄우므로
    (`_spawn`), 여기서 서른 번을 불러도 응답이 늘어지지 않습니다.
    """
    if not reservations or not google_calendar.configured():
        return
    context = await unit_context(db, reservations)
    together = await companion_names(db, reservations)
    owner_ids = {item.user_id for item in reservations}
    owners = {
        person.id: person.name
        for person in (await db.scalars(select(User).where(User.id.in_(owner_ids)))).all()
    }
    for item in reservations:
        _, equipment_name = context.get(item.equipment_unit_id, ("", ""))
        if equipment_name != google_calendar.EQUIPMENT:
            continue
        google_calendar.publish(
            item.id,
            user_name=owners.get(item.user_id, ""),
            equipment_name=equipment_name,
            starts_at=item.starts_at,
            ends_at=item.ends_at,
            purpose=item.note or "",
            category=PURPOSE_LABEL.get(item.purpose_category, ""),
            companions=together.get(item.id, []),
        )


async def release_remaining(db: AsyncSession, reservation: Reservation) -> timedelta:
    """일찍 끝낸 예약의 남은 시간을 돌려준다. 실제로 반납된 길이를 준다.

    예전에는 사용 후 사진을 올려 `COMPLETED` 가 되어도 `ReservationSlot` 은 끝
    시각까지 그대로 남았다. 17~19시를 잡고 17시 10분에 끝내도 19시까지 아무도 그
    장비를 쓸 수 없었다.

    끝 시각은 **다음 30분 눈금으로 올려** 잡는다(`ceil_30` 설명 참고). 시작하자마자
    끝낸 경우에도 `ends_at > starts_at` 이 깨지지 않도록 최소 30분은 남긴다.
    """
    starts_at, ends_at = as_utc(reservation.starts_at), as_utc(reservation.ends_at)
    new_end = max(ceil_30(datetime.now(UTC)), starts_at + timedelta(minutes=30))
    if new_end >= ends_at:
        return timedelta()
    reservation.ends_at = new_end
    await db.execute(delete(ReservationSlot).where(
        ReservationSlot.reservation_id == reservation.id,
        ReservationSlot.slot_start >= new_end,
    ))
    return ends_at - new_end
