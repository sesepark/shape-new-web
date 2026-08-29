"""예약이 굴러가는 시각과 상한을 한곳에서 읽습니다.

예전에는 이 값들이 파이썬 상수였습니다 — 자동 확정 한 시간, 운영진 독촉 두 시간,
사용 시작 10분 전, 사진 독촉 30분, 한 건 12시간, 180일 앞까지, 정기 예약 30건.
그래서 운영을 맡은 사람이 "자동 확정을 두 시간으로 늘리자" 고 정해도 코드를 고치고
다시 배포해야 했습니다. 이제는 관리자 화면에서 바꾸고, 여기서 읽습니다.

## 왜 캐시가 필요한가

이 값은 **예약 창구마다** 읽힙니다 — 신청, 승인, 자동 확정 훑기, 알림 훑기,
예약 가능 시간, 마이페이지. 매번 조회하면 신청 한 번에 Neon 을 한 번 더 두드리는
셈이고, 무료 티어에서 값이 드는 것은 질의 횟수가 아니라 **깨어 있는 시간**이지만
그 시간을 늘리는 것이 바로 이런 덤 질의입니다.

설정은 거의 바뀌지 않으므로 짧게 들고 있다가 버립니다. 저장할 때는 `forget()` 이
곧바로 버리므로, 관리자 화면에서 고친 값이 다음 요청에 그대로 보입니다. 다만
서버가 여럿이면 다른 프로세스의 캐시는 최대 `TTL` 만큼 옛 값을 들고 있습니다 —
설정 값의 성질상 그 지연이 문제가 되지 않습니다.
"""

import time
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReservationPolicy

# 캐시를 얼마나 들고 있을지. 설정은 거의 바뀌지 않으므로 길어도 되지만, 관리자가
# 고친 뒤 다른 프로세스에서 옛 값이 보이는 시간이기도 하므로 1분으로 둡니다.
TTL = 60.0

_cached: tuple[float, "Policy"] | None = None


@dataclass(frozen=True)
class Policy:
    """지금 적용되는 값. 표의 행이 아니라 값만 담습니다(세션이 닫혀도 읽히도록)."""

    auto_approve_minutes: int = 60
    staff_reminder_minutes: int = 120
    start_grace_minutes: int = 10
    before_photo_grace_minutes: int = 30
    max_hours: int = 12
    booking_window_days: int = 180
    recurring_max: int = 30

    @property
    def auto_approve_lead(self) -> timedelta:
        return timedelta(minutes=self.auto_approve_minutes)

    @property
    def staff_reminder_lead(self) -> timedelta:
        return timedelta(minutes=self.staff_reminder_minutes)

    @property
    def start_grace(self) -> timedelta:
        return timedelta(minutes=self.start_grace_minutes)

    @property
    def before_photo_grace(self) -> timedelta:
        return timedelta(minutes=self.before_photo_grace_minutes)

    @property
    def max_span(self) -> timedelta:
        return timedelta(hours=self.max_hours)

    @property
    def booking_window(self) -> timedelta:
        return timedelta(days=self.booking_window_days)


DEFAULTS = Policy()

FIELDS = (
    "auto_approve_minutes",
    "staff_reminder_minutes",
    "start_grace_minutes",
    "before_photo_grace_minutes",
    "max_hours",
    "booking_window_days",
    "recurring_max",
)


def forget() -> None:
    """다음에 읽을 때 표에서 다시 가져오게 합니다. 저장하는 쪽이 부릅니다."""
    global _cached
    _cached = None


async def row(db: AsyncSession) -> ReservationPolicy:
    """설정 행. 없으면 기본값으로 만들어 둡니다.

    행을 만드는 것은 **관리자 화면이 읽을 때**뿐이므로 여기서 커밋해도 됩니다.
    읽기 경로(`current`)는 행이 없으면 기본값을 그대로 쓰고 아무것도 쓰지 않습니다
    — 공개 읽기가 데이터베이스에 쓰기를 하면 안 됩니다.
    """
    found = await db.scalar(select(ReservationPolicy).limit(1))
    if found:
        return found
    found = ReservationPolicy(id=1)
    db.add(found)
    await db.commit()
    await db.refresh(found)
    forget()
    return found


async def current(db: AsyncSession) -> Policy:
    """지금 적용되는 값. 잠깐 들고 있다가 다시 읽습니다."""
    global _cached
    now = time.monotonic()
    if _cached and now < _cached[0]:
        return _cached[1]
    found = await db.scalar(select(ReservationPolicy).limit(1))
    policy = DEFAULTS if not found else Policy(**{name: getattr(found, name) for name in FIELDS})
    _cached = (now + TTL, policy)
    return policy
