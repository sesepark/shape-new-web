import time as clock
from collections import deque
from datetime import UTC, datetime, time, timedelta
from datetime import date as date_type
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    ContactMessage,
    ContentPage,
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    LinkVisibility,
    NewsPost,
    RelatedLink,
    Reservation,
    ReservationBlackout,
    ReservationSlot,
    ReservationStatus,
    RoadmapItem,
    RoadmapMember,
    User,
)
from app.schemas import (
    ContactWrite,
    ContentPageRead,
    EquipmentRead,
    LinkRead,
    MemberProfile,
    MemberProject,
    NewsDetailRead,
    NewsRead,
    PublicBlackout,
    PublicReservationPolicy,
    RoadmapRead,
)
from app.security import READING_STATUSES, has_permission, optional_user
from app.services import blackouts, google_calendar, reservation_policy
from app.services.reservations import slots

router = APIRouter(tags=["public"])
SEOUL = ZoneInfo("Asia/Seoul")
# Reservations run around the clock; the columns stay for a future per-equipment
# window but every response reports the same opening hours today.
OPEN_HOUR, CLOSE_HOUR = 0, 24


@router.get("/pages/{slug}", response_model=ContentPageRead)
async def get_page(slug: str, db: AsyncSession = Depends(get_db)):
    item = await db.scalar(select(ContentPage).where(ContentPage.slug == slug, ContentPage.is_published.is_(True)))
    if not item:
        raise HTTPException(404, "페이지를 찾을 수 없습니다.")
    return item


@router.get("/news", response_model=list[NewsRead])
async def list_news(
    limit: int = Query(default=12, ge=1, le=50),
    category: str | None = Query(default=None, max_length=60),
    exclude: str | None = Query(default=None, max_length=60, description="이 분류는 빼고 돌려줍니다"),
    db: AsyncSession = Depends(get_db),
):
    """소식 목록.

    `exclude` 는 소식 탭이 언론보도를 빼고 부르기 위한 것이다. 언론보도는 자기
    탭(`/news/press`)이 따로 있어서 소식 목록에 섞이면 같은 글이 두 곳에 나온다.
    걸러내기를 화면에서 하면 `limit` 만큼 받아 온 뒤 버리게 되어, 언론보도가
    많아지는 만큼 소식이 목록에서 밀려 사라진다. 그래서 질의에서 뺀다.
    """
    query = select(NewsPost).where(NewsPost.is_published.is_(True), NewsPost.published_at.is_not(None))
    if category:
        query = query.where(NewsPost.category == category)
    if exclude:
        query = query.where(NewsPost.category != exclude)
    return (await db.scalars(query.order_by(NewsPost.published_at.desc()).limit(limit))).all()


@router.get("/news/{item_id}", response_model=NewsDetailRead)
async def news_detail(item_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(NewsPost, item_id)
    if not item or not item.is_published or not item.published_at:
        raise HTTPException(404, "뉴스를 찾을 수 없습니다.")
    return item


@router.get("/equipment", response_model=list[EquipmentRead])
async def list_equipment(db: AsyncSession = Depends(get_db)):
    equipment = (await db.scalars(select(Equipment).order_by(Equipment.sort_order, Equipment.name))).all()
    ids = [item.id for item in equipment]
    if not ids:
        return []
    # 이 목록에 나오는 장비의 요구 교육만 읽는다. 조건 없이 읽으면 장비를
    # 지운 뒤에도 남아 있는 옛 행까지 라이선스 표와 조인되어 따라 나온다.
    requirements = (await db.execute(
        select(EquipmentLicenseRequirement.equipment_id, License.name)
        .join(License, License.id == EquipmentLicenseRequirement.license_id)
        .where(EquipmentLicenseRequirement.equipment_id.in_(ids))
    )).all()
    # 어떤 장비가 공유 캘린더로 가는지는 백엔드가 정합니다. 같은 장비 이름을
    # 화면에도 적어 두면 한쪽만 바뀌었을 때 안내가 거짓말을 합니다.
    synced = google_calendar.configured()
    counts = dict((await db.execute(
        select(EquipmentUnit.equipment_id, func.count())
        .where(EquipmentUnit.equipment_id.in_(ids), EquipmentUnit.status == EquipmentStatus.ACTIVE)
        .group_by(EquipmentUnit.equipment_id)
    )).all())
    return [
        EquipmentRead(
            id=item.id, name=item.name, category=item.category, description=item.description,
            image_url=item.image_url, status=item.status, reservation_unit_minutes=item.reservation_unit_minutes,
            open_hour=OPEN_HOUR, close_hour=CLOSE_HOUR,
            required_licenses=[row[1] for row in requirements if row[0] == item.id],
            available_units=counts.get(item.id, 0),
            shared_calendar=synced and item.name == google_calendar.EQUIPMENT,
        )
        for item in equipment
    ]


# 한 달에 읽어 올 규칙 수. 운영진이 만드는 것이라 몇 건을 넘지 않지만, 규칙 하나가
# 최대 31칸으로 펼쳐지므로 상한을 둡니다.
BLACKOUT_RULES = 60


@router.get("/equipment/blackouts", response_model=list[PublicBlackout])
async def equipment_blackouts(
    month: str = Query(pattern=r"^\d{4}-\d{2}$", description="조회할 달 (YYYY-MM)"),
    db: AsyncSession = Depends(get_db),
):
    """그 달에 운영진이 막아 둔 시간. 예약 현황 달력이 함께 그립니다.

    막아 둔 시간이 달력에 없으면, 부원은 빈 칸을 보고 예약 화면까지 갔다가 거기서야
    막혔다는 것을 알게 됩니다. 한 번 헛걸음하는 셈입니다.

    **요일 규칙을 여기서 날짜별로 펼쳐 줍니다.** 화면이 다시 펴게 하면 같은 계산이
    서버와 화면 두 곳에 생기고, 한쪽만 고쳐지는 날이 옵니다.

    실리는 것은 장비·시각·사유뿐이라 누가 부르든 같은 응답입니다. 그래서 로그인
    없이도 열리고 공개 읽기 캐시를 탑니다 — 예약 화면의 `blockedReasons` 도 이미
    같은 내용을 공개하고 있습니다.

    **이 주소는 `/equipment/{equipment_id}/availability` 와 겹치지 않습니다.** 조각
    수가 달라서인데, 뒤에 `{equipment_id}` 하나짜리 창구를 새로 만들 일이 생기면
    반드시 이 창구를 그보다 **먼저** 선언해야 합니다.
    """
    year, number = (int(part) for part in month.split("-"))
    if not 1 <= number <= 12:
        raise HTTPException(422, "조회할 달이 올바르지 않습니다.")
    first = date_type(year, number, 1)
    last = date_type(year + (number == 12), number % 12 + 1, 1) - timedelta(days=1)
    rules = list((await db.scalars(
        select(ReservationBlackout)
        .where(ReservationBlackout.from_date <= last, ReservationBlackout.until_date >= first)
        .order_by(ReservationBlackout.from_date)
        .limit(BLACKOUT_RULES)
    )).all())
    if not rules:
        return []
    names = {row[0]: row[1] for row in (await db.execute(select(Equipment.id, Equipment.name))).all()}
    units = {row[0]: row[1] for row in (await db.execute(select(EquipmentUnit.id, EquipmentUnit.label))).all()}

    out: list[PublicBlackout] = []
    for rule in rules:
        for offset in range((last - first).days + 1):
            window = blackouts.interval_on(rule, first + timedelta(days=offset))
            if not window:
                continue
            out.append(PublicBlackout(
                equipment_id=rule.equipment_id,
                equipment_name=names.get(rule.equipment_id, "장비"),
                unit_label=units.get(rule.equipment_unit_id, "") if rule.equipment_unit_id else "",
                reason=rule.reason,
                starts_at=window[0],
                ends_at=window[1],
            ))
    out.sort(key=lambda row: (row.starts_at, row.equipment_name))
    return out


@router.get("/equipment/{equipment_id}/availability")
async def equipment_availability(equipment_id: UUID, date: date_type = Query(), db: AsyncSession = Depends(get_db)):
    """그 날 이 장비의 시간표. 확정된 칸과 **아직 대기 중인 칸**을 함께 알려 줍니다.

    대기 중인 칸을 싣는 이유는, 같은 시간을 원하는 사람이 둘이라는 사실이 지금은
    승인 단추를 누를 때까지 아무에게도 보이지 않기 때문입니다. 신청하기 전에
    보이면 다른 시간으로 옮기거나, 왜 이 시간이어야 하는지 적어 둘 수 있습니다.

    **여기 실리는 것은 호기와 시각뿐입니다 — 누가 신청했는지는 들어가지 않습니다.**
    그래서 누가 부르든 같은 응답이고, `PUBLIC_READS` 허용 목록과 30초 공유 캐시를
    그대로 써도 남의 정보가 새지 않습니다.

    대가는 최대 30초의 지연입니다. 예약 화면의 요청은 쿠키를 보내지 않으므로(다른
    출처라 붙지 않습니다) 회원의 요청도 캐시를 탑니다. 방금 신청한 사람이 곧바로
    새로 고치면 자기 신청이 아직 안 보일 수 있습니다. 이것을 `cache.clear()` 로
    고치면 안 됩니다 — 소식·장비 등 공개 읽기가 전부 함께 비워지고, 회원 한 사람의
    신청(분당 20건까지)이 Neon 을 깨우는 방아쇠가 됩니다. 30초는 그 값을 치르지
    않기로 한 선택입니다.
    """
    equipment = await db.get(Equipment, equipment_id)
    if not equipment:
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    units = (await db.scalars(select(EquipmentUnit).where(EquipmentUnit.equipment_id == equipment_id, EquipmentUnit.status == EquipmentStatus.ACTIVE).order_by(EquipmentUnit.label))).all()
    # 운영진이 막아 둔 시간. 장비 단위로 한 번만 읽고 호기별 판정은 파이썬이
    # 합니다 — 카메라처럼 호기가 일곱인 장비에서 호기마다 물어보면 질의가
    # 일곱 배가 됩니다.
    rules = await blackouts.rules_for(db, equipment_id, date, date)
    day_start = datetime.combine(date, time.min, tzinfo=SEOUL).astimezone(UTC)
    day_end = (datetime.combine(date, time.min, tzinfo=SEOUL) + timedelta(days=1)).astimezone(UTC)
    reserved: list = []
    waiting: list = []
    if units:
        unit_ids = [unit.id for unit in units]
        reserved = (await db.execute(select(ReservationSlot.equipment_unit_id, ReservationSlot.slot_start).where(ReservationSlot.equipment_unit_id.in_(unit_ids), ReservationSlot.slot_start >= day_start, ReservationSlot.slot_start < day_end))).all()
        # 대기 신청은 확정 예약과 달리 슬롯 표가 없습니다(그것은 승인할 때만
        # 만듭니다). 구간으로 읽어 와 아래에서 30분 칸으로 폅니다. 호기마다
        # 물어보면 호기가 늘어난 만큼 Neon 을 두드리므로 질의는 한 번입니다.
        waiting = (await db.execute(select(Reservation.equipment_unit_id, Reservation.starts_at, Reservation.ends_at).where(
            Reservation.equipment_unit_id.in_(unit_ids),
            Reservation.status == ReservationStatus.PENDING,
            Reservation.starts_at < day_end,
            Reservation.ends_at > day_start,
        ))).all()

    def pending_starts(unit_id) -> list[str]:
        """그 호기에서 대기 중인 30분 칸. 같은 시각이 여러 번 나오면 그만큼 겹친 것."""
        marks: list[datetime] = []
        for owner, begins, finishes in waiting:
            if owner != unit_id:
                continue
            begins = begins if begins.tzinfo else begins.replace(tzinfo=UTC)
            finishes = finishes if finishes.tzinfo else finishes.replace(tzinfo=UTC)
            marks += list(slots(max(begins, day_start), min(finishes, day_end)))
        return sorted(mark.astimezone(SEOUL).isoformat() for mark in marks)

    return {
        "equipmentId": equipment.id,
        "reservationUnitMinutes": equipment.reservation_unit_minutes,
        "openHour": OPEN_HOUR,
        "closeHour": CLOSE_HOUR,
        # 그 날 걸려 있는 사용 제한의 사유. 왜 못 누르는지 화면이 말해 주지
        # 않으면 부원은 결국 운영진에게 물어보게 됩니다.
        "blockedReasons": sorted({rule.reason.strip() for rule in rules if rule.reason and rule.reason.strip()}),
        "units": [
            {
                "id": unit.id,
                "label": unit.label,
                "reservedStarts": [slot.astimezone(SEOUL).isoformat() for unit_id, slot in reserved if unit_id == unit.id],
                "pendingStarts": pending_starts(unit.id),
                # 운영진이 막아 둔 칸. 화면은 이 칸을 아예 누를 수 없게 그립니다.
                # 서버도 같은 규칙으로 신청을 거절하므로 두 쪽이 어긋나지 않습니다.
                "blockedStarts": [mark.astimezone(SEOUL).isoformat() for mark in blackouts.blocked_starts(rules, unit.id, date)],
            }
            for unit in units
        ],
    }


@router.get("/reservation-policy", response_model=PublicReservationPolicy)
async def public_reservation_policy(db: AsyncSession = Depends(get_db)):
    """예약이 굴러가는 규칙 값. 부원 화면이 안내를 **정확한 시각**으로 적기 위해 읽습니다.

    "시작 한 시간 전에 저절로 확정됩니다" 라는 설명만으로는 부원이 자기 신청이
    언제 확정되는지 알 수 없습니다. 화면이 "8월 30일 13:00에 확정됩니다" 라고
    적으려면 그 '한 시간' 이 지금 몇 분인지 알아야 합니다.

    **여기 실리는 것은 규칙 값뿐입니다** — 누가 무엇을 예약했는지는 한 글자도
    들어가지 않습니다. 그래서 누가 부르든 같은 응답이고, 공개 읽기 캐시를 그대로
    씁니다(`PUBLIC_EXACT`). 설정을 고쳐도 최대 캐시 시간만큼 옛 값이 보일 수
    있는데, 이 값은 그 사이에 예약이 잘못 처리될 성질의 것이 아닙니다.
    """
    policy = await reservation_policy.current(db)
    return PublicReservationPolicy(
        auto_approve_minutes=policy.auto_approve_minutes,
        start_grace_minutes=policy.start_grace_minutes,
        max_hours=policy.max_hours,
        booking_window_days=policy.booking_window_days,
    )


# 로드맵은 학기마다 쌓이기만 하고 지워지지 않습니다. 화면이 실제로 보여 주는
# 것은 이번 학기 안팎인데 전부 실어 보내면 해가 갈수록 응답만 길어집니다.
ROADMAP_PAGE = 200


@router.get("/roadmap", response_model=list[RoadmapRead])
async def list_roadmap(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=ROADMAP_PAGE, ge=1, le=ROADMAP_PAGE),
):
    """공개 로드맵. 오래된 쪽부터 차례로 돌려줍니다.

    개수를 끊을 때 **어느 쪽을 남기는지**가 중요합니다. 시작일 오름차순으로 앞에서
    끊으면 남는 것은 가장 오래된 일정이고, 잘려 나가는 것은 앞으로 있을 일정입니다.
    홈의 '일정' 칸은 아직 끝나지 않은 일정만 골라 쓰므로, 그렇게 두면 표가 상한을
    넘긴 순간부터 홈의 일정이 조용히 비어 버립니다. 그래서 최신 쪽에서 끊고
    돌려줄 때 다시 오름차순으로 맞춥니다.
    """
    rows = (await db.scalars(
        select(RoadmapItem).where(RoadmapItem.is_published.is_(True)).order_by(RoadmapItem.starts_at.desc()).limit(limit)
    )).all()
    return sorted(rows, key=lambda item: item.starts_at)


LINKS_PAGE = 100


@router.get("/links", response_model=list[LinkRead])
async def list_links(viewer: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    """바로가기 링크. 보는 사람이 볼 수 있는 범위까지만 돌려줍니다.

    범위 밖의 링크는 **목록에 아예 넣지 않습니다.** 제목만 보여 주고 잠갔다고
    쓰는 방법도 있지만, 운영진 전용으로 둔 링크는 제목 자체가 알릴 것이 아닐 수
    있습니다(예: 채점 시트, 지원자 명단).

    로그인한 사람의 요청은 미들웨어가 공유 캐시를 건너뛰고 `private, no-store`
    로 답하므로(app/middleware.py), 부원용 링크가 캐시에 남아 다음 방문자에게
    나갈 일은 없습니다. 캐시에 담기는 것은 쿠키 없는 요청, 곧 전체 공개 목록뿐
    입니다.
    """
    allowed = {LinkVisibility.PUBLIC}
    if viewer and viewer.status in READING_STATUSES:
        allowed.add(LinkVisibility.MEMBER)
        # 운영진 전용은 링크를 관리하는 사람에게만 엽니다. 다른 분야의 운영진
        # (장비·소식)까지 열지 않는 이유는, 이 칸을 쓰는 목적이 '링크를 다루는
        # 사람끼리 쓰는 주소' 이기 때문입니다.
        if await has_permission(db, viewer, "links:manage"):
            allowed.add(LinkVisibility.STAFF)
    return (await db.scalars(
        select(RelatedLink)
        .where(RelatedLink.is_published.is_(True), RelatedLink.visibility.in_(allowed))
        .order_by(RelatedLink.sort_order, RelatedLink.title)
        .limit(LINKS_PAGE)
    )).all()


@router.get("/member-profiles", response_model=list[MemberProfile])
async def member_profiles(db: AsyncSession = Depends(get_db)):
    """Public profile of every member linked to a card on the 부원 page.

    Only accounts an editor actually placed on the published page are returned,
    so this never exposes the full member list, and only the fields the member
    chose to show (name, portrait, introduction) plus their published projects.
    """
    page = await db.scalar(select(ContentPage).where(ContentPage.slug == "members", ContentPage.is_published.is_(True)))
    cards = (page.content_json or {}).get("members", []) if page else []
    wanted = set()
    for card in cards:
        # The card store is free-form JSON written by an editor, so a malformed
        # or stale id must be skipped rather than break the whole page.
        if not isinstance(card, dict) or not card.get("userId"):
            continue
        try:
            wanted.add(UUID(str(card["userId"])))
        except ValueError:
            continue
    if not wanted:
        return []
    # 보기 전용 회원(멤버)도 부원 카드에 남습니다. 활동을 쉬는 것과 카드에서
    # 사라지는 것은 다른 일입니다.
    users = (await db.scalars(select(User).where(
        User.id.in_(wanted), User.status.in_(READING_STATUSES), User.deleted_at.is_(None)))).all()
    if not users:
        return []
    rows = (await db.execute(
        select(RoadmapMember.user_id, RoadmapItem)
        .join(RoadmapItem, RoadmapItem.id == RoadmapMember.roadmap_item_id)
        .where(RoadmapMember.user_id.in_([user.id for user in users]), RoadmapItem.is_published.is_(True))
        .order_by(RoadmapItem.starts_at)
    )).all()
    return [
        MemberProfile(
            id=user.id, name=user.name, image_url=user.image_url, introduction=user.introduction,
            projects=[MemberProject.model_validate(item) for owner, item in rows if owner == user.id],
        )
        for user in users
    ]


# 문의 창구가 한 시간에 받는 총량.
#
# `CostGuardMiddleware` 의 쓰기 한도는 **보내는 쪽 하나**를 셉니다. 그것만으로는
# 여러 곳에서 나눠 보내는 자동 프로그램을 못 막고, 무료 티어에서는 표가 부는
# 것보다 **Neon 이 깨어 있는 시간**이 먼저 아픕니다. 그래서 창구 전체가 한 시간에
# 받을 양을 따로 셉니다. 사람이 보내는 문의는 하루 몇 건이라 걸릴 일이 없습니다.
CONTACT_PER_HOUR = 30
_contact_hits: deque[float] = deque()


@router.post("/contact", status_code=201)
async def submit_contact(payload: ContactWrite, db: AsyncSession = Depends(get_db)):
    """문의를 받아 표에 담습니다. **사이트에서 유일하게 로그인 없이 쓰는 창구입니다.**

    예전에는 화면이 `mailto:` 를 열었습니다. 메일 앱이 걸려 있지 않은 기기에서는
    보내기를 눌러도 아무 일도 일어나지 않아서, 가입 문의가 조용히 사라졌습니다.

    운영진에게 알림을 보내지 않습니다. 예약 알림에 섞이면 묻히고, 문의는 급한
    일이 아니라 한곳에 모아 두고 훑는 편이 맞습니다. 관리자 화면의 '문의' 탭에서
    안 읽은 수와 함께 봅니다.

    막는 것 두 가지:
    - 사람 눈에 안 보이는 `website` 칸이 채워져 있으면 자동 프로그램입니다.
      **거절하지 않고 201 을 돌려줍니다.** 막혔다는 것을 알려 주면 상대가 칸을
      비우고 다시 옵니다. 저장만 하지 않습니다.
    - 창구 전체가 한 시간에 받는 양(`CONTACT_PER_HOUR`).
    """
    if payload.website:
        return {"ok": True}
    # `time` 은 이 파일에서 이미 `datetime.time` 입니다. 단조 시계는 `clock` 으로 부릅니다.
    now = clock.monotonic()
    while _contact_hits and _contact_hits[0] <= now - 3600:
        _contact_hits.popleft()
    if len(_contact_hits) >= CONTACT_PER_HOUR:
        raise HTTPException(429, "문의가 한꺼번에 몰렸습니다. 잠시 후 다시 보내 주세요.")
    _contact_hits.append(now)
    db.add(ContactMessage(
        name=payload.name, reply_to=payload.reply_to,
        subject=payload.subject, message=payload.message,
    ))
    await db.commit()
    return {"ok": True}
