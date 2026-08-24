from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentUnit,
    Reservation,
    ReservationSlot,
    ReservationStatus,
    UserLicense,
)
from app.schemas import ReservationCreate, ReservationRead

CANCELLABLE = {ReservationStatus.PENDING, ReservationStatus.APPROVED}


def slots(starts_at, ends_at):
    current = starts_at
    while current < ends_at:
        yield current
        current += timedelta(minutes=30)


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


async def read_models(db: AsyncSession, reservations, model=ReservationRead, extra=None):
    context = await unit_context(db, reservations)
    result = []
    for item in reservations:
        label, equipment_name = context.get(item.equipment_unit_id, ("", ""))
        fields = model.model_validate(item).model_dump()
        fields.update(unit_label=label, equipment_name=equipment_name, **(extra(item) if extra else {}))
        result.append(model(**fields))
    return result


async def assert_eligible(db: AsyncSession, user_id, unit_id) -> EquipmentUnit:
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
    return unit


async def create_pending(db: AsyncSession, user_id, payload: ReservationCreate) -> tuple[Reservation, bool]:
    """예약을 신청한다. (예약, 새로 만들었는지) 를 돌려준다."""
    if payload.starts_at >= payload.ends_at or payload.starts_at.minute not in {0, 30}:
        raise HTTPException(422, "예약 시간 범위를 확인해 주세요.")
    now = datetime.now(UTC)
    if payload.starts_at.tzinfo is None or payload.ends_at.tzinfo is None:
        raise HTTPException(422, "시간대가 포함된 예약 시간이 필요합니다.")
    if payload.starts_at < now:
        raise HTTPException(422, "지난 시간은 예약할 수 없습니다.")
    if payload.starts_at > now + timedelta(days=180):
        raise HTTPException(422, "예약은 180일 이내에서만 신청할 수 있습니다.")
    if payload.ends_at - payload.starts_at > timedelta(hours=12):
        raise HTTPException(422, "한 번에 최대 12시간까지 예약할 수 있습니다.")
    await assert_eligible(db, user_id, payload.equipment_unit_id)
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
        return existing, False
    reservation = Reservation(user_id=user_id, **payload.model_dump())
    db.add(reservation)
    await db.commit()
    await db.refresh(reservation)
    return reservation, True


async def approve(db: AsyncSession, reservation: Reservation) -> Reservation:
    if reservation.status != ReservationStatus.PENDING:
        raise HTTPException(409, "대기 예약만 승인할 수 있습니다.")
    await assert_eligible(db, reservation.user_id, reservation.equipment_unit_id)
    reservation.status = ReservationStatus.APPROVED
    db.add_all([ReservationSlot(equipment_unit_id=reservation.equipment_unit_id, reservation_id=reservation.id, slot_start=slot) for slot in slots(reservation.starts_at, reservation.ends_at)])
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "승인하려는 시간에 확정된 예약이 있습니다.") from exc
    await db.refresh(reservation)
    return reservation


async def cancel(db: AsyncSession, reservation: Reservation, reason: str | None = None) -> Reservation:
    """Release the confirmed slots so the time becomes bookable again."""
    if reservation.status not in CANCELLABLE:
        raise HTTPException(409, "대기 또는 확정 상태의 예약만 취소할 수 있습니다.")
    await db.execute(delete(ReservationSlot).where(ReservationSlot.reservation_id == reservation.id))
    reservation.status = ReservationStatus.CANCELLED
    if reason:
        reservation.rejection_reason = reason
    await db.commit()
    await db.refresh(reservation)
    return reservation
