"""운영진이 막아 둔 시간을 읽고, 어떤 예약이 거기 걸리는지 따집니다.

지금까지 시간을 막는 수단은 장비 **전체**를 `MAINTENANCE` 로 돌리는 것뿐이었습니다.
목요일 저녁 교육 실습 때문에 SO-ARM 을 막고 싶어도 나머지 엿새까지 함께 닫히므로,
실제로는 아무도 그 방법을 쓰지 못했고 "그 시간대 개인 예약은 피해 주세요" 라는
문장이 장비 설명에 글로만 남아 있었습니다.

## 이 파일은 `reservations.py` 를 가져오지 않습니다

`reservations.py` 가 이쪽을 가져오기 때문입니다(신청과 승인이 막힌 시간을 봐야
합니다). 그래서 30분 칸을 펴는 짧은 반복을 여기 따로 둡니다 — 저쪽의 `slots()` 를
불러 쓰면 import 가 원을 그립니다. 걸음이 30분인 이유는 저쪽과 같습니다: 30분이
모든 예약 단위(30·60·90·120분)의 최대공약수라, 여기서 단위를 바꾸면 화면이 막힌
칸을 절반만 그리게 됩니다.
"""

from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from datetime import time as time_type
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReservationBlackout

SEOUL = ZoneInfo("Asia/Seoul")
STEP = timedelta(minutes=30)
# 하루를 통째로 막았을 때의 끝. 관리자 화면의 '24:00' 과 같은 값입니다.
DAY_END = 1440


def as_utc(value: datetime) -> datetime:
    """로컬 SQLite 는 시간대를 잃으므로 비교 전에 UTC 로 맞춥니다."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def seoul_days(starts_at: datetime, ends_at: datetime) -> list[date_type]:
    """이 구간이 걸치는 **한국 시각 기준** 날짜들.

    23시부터 다음 날 1시까지 잡은 예약은 이틀에 걸칩니다. 하루만 보고 판정하면
    자정 뒤에 걸린 막힌 시간을 놓칩니다.
    """
    first = as_utc(starts_at).astimezone(SEOUL).date()
    # 끝 시각이 정확히 자정이면 그 날짜는 실제로 쓰이지 않습니다. 1마이크로초를
    # 물러 보면 앞날로 떨어집니다.
    last = (as_utc(ends_at).astimezone(SEOUL) - timedelta(microseconds=1)).date()
    if last < first:
        last = first
    span = (last - first).days
    return [first + timedelta(days=offset) for offset in range(span + 1)]


async def rules_for(
    db: AsyncSession,
    equipment_id: UUID,
    first_day: date_type,
    last_day: date_type,
) -> list[ReservationBlackout]:
    """이 장비에서 그 날짜 범위에 걸치는 규칙. 호기별 판정은 파이썬이 합니다.

    호기마다 물어보면 카메라(7호기)에서 질의가 일곱 번이 됩니다. 장비 단위로 한
    번만 읽고 `applies_to` 로 거릅니다.
    """
    return list((await db.scalars(
        select(ReservationBlackout).where(
            ReservationBlackout.equipment_id == equipment_id,
            ReservationBlackout.from_date <= last_day,
            ReservationBlackout.until_date >= first_day,
        )
    )).all())


def applies_to(rule: ReservationBlackout, unit_id: UUID | None) -> bool:
    """호기를 지정하지 않은 규칙은 그 장비의 모든 호기를 막습니다."""
    return rule.equipment_unit_id is None or rule.equipment_unit_id == unit_id


def interval_on(rule: ReservationBlackout, day: date_type) -> tuple[datetime, datetime] | None:
    """그 날 이 규칙이 막는 구간(UTC). 해당 없으면 None.

    시각은 **한국 시각 자정에서부터 잰 분**으로 저장되어 있습니다. UTC 자정을
    기준으로 재면 "목요일 19시" 가 수요일로 아홉 시간 밀립니다.
    """
    if not (rule.from_date <= day <= rule.until_date):
        return None
    if day.weekday() not in (rule.weekdays or []):
        return None
    midnight = datetime.combine(day, time_type.min, tzinfo=SEOUL)
    start = (midnight + timedelta(minutes=rule.start_minute)).astimezone(UTC)
    end = (midnight + timedelta(minutes=min(rule.end_minute, DAY_END))).astimezone(UTC)
    return (start, end) if end > start else None


def hit(
    rules: list[ReservationBlackout],
    unit_id: UUID,
    starts_at: datetime,
    ends_at: datetime,
) -> ReservationBlackout | None:
    """이 구간에 걸리는 규칙 하나. 없으면 None."""
    starts_at, ends_at = as_utc(starts_at), as_utc(ends_at)
    days = seoul_days(starts_at, ends_at)
    for rule in rules:
        if not applies_to(rule, unit_id):
            continue
        for day in days:
            window = interval_on(rule, day)
            if window and window[0] < ends_at and window[1] > starts_at:
                return rule
    return None


async def check(db: AsyncSession, equipment_id: UUID, unit_id: UUID, starts_at: datetime, ends_at: datetime):
    """신청·승인 자리에서 쓰는 짧은 형태. 걸리는 규칙을 돌려줍니다."""
    days = seoul_days(starts_at, ends_at)
    rules = await rules_for(db, equipment_id, days[0], days[-1])
    return hit(rules, unit_id, starts_at, ends_at)


def blocked_starts(
    rules: list[ReservationBlackout],
    unit_id: UUID,
    day: date_type,
) -> list[datetime]:
    """그 날 이 호기에서 막힌 30분 칸의 시작 시각(UTC).

    예약 가능 시간 창구가 씁니다. 화면이 막힌 칸을 눌리지 않게 그리려면 확정된
    칸과 같은 모양으로 받아야 합니다.
    """
    marks: set[datetime] = set()
    for rule in rules:
        if not applies_to(rule, unit_id):
            continue
        window = interval_on(rule, day)
        if not window:
            continue
        start, end = window
        # 30분 눈금에 맞춰 **내림**으로 시작합니다. 19:15 부터 막았다면 19:00 칸은
        # 절반이 막힌 것이고, 절반만 쓸 수는 없으므로 칸 전체를 막습니다.
        cursor = start - timedelta(minutes=start.astimezone(SEOUL).minute % 30, seconds=start.second, microseconds=start.microsecond)
        while cursor < end:
            marks.add(cursor)
            cursor += STEP
    return sorted(marks)
