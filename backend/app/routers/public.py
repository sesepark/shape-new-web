from datetime import UTC, datetime, time, timedelta
from datetime import date as date_type
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    ContentPage,
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    NewsPost,
    RelatedLink,
    ReservationSlot,
    RoadmapItem,
    RoadmapMember,
    User,
)
from app.schemas import (
    ContentPageRead,
    EquipmentRead,
    LinkRead,
    MemberProfile,
    MemberProject,
    NewsDetailRead,
    NewsRead,
    RoadmapRead,
)
from app.security import READING_STATUSES

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
        )
        for item in equipment
    ]


@router.get("/equipment/{equipment_id}/availability")
async def equipment_availability(equipment_id: UUID, date: date_type = Query(), db: AsyncSession = Depends(get_db)):
    equipment = await db.get(Equipment, equipment_id)
    if not equipment:
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    units = (await db.scalars(select(EquipmentUnit).where(EquipmentUnit.equipment_id == equipment_id, EquipmentUnit.status == EquipmentStatus.ACTIVE).order_by(EquipmentUnit.label))).all()
    day_start = datetime.combine(date, time.min, tzinfo=SEOUL).astimezone(UTC)
    day_end = (datetime.combine(date, time.min, tzinfo=SEOUL) + timedelta(days=1)).astimezone(UTC)
    reserved = []
    if units:
        reserved = (await db.execute(select(ReservationSlot.equipment_unit_id, ReservationSlot.slot_start).where(ReservationSlot.equipment_unit_id.in_([unit.id for unit in units]), ReservationSlot.slot_start >= day_start, ReservationSlot.slot_start < day_end))).all()
    return {
        "equipmentId": equipment.id,
        "reservationUnitMinutes": equipment.reservation_unit_minutes,
        "openHour": OPEN_HOUR,
        "closeHour": CLOSE_HOUR,
        "units": [{"id": unit.id, "label": unit.label, "reservedStarts": [slot.astimezone(SEOUL).isoformat() for unit_id, slot in reserved if unit_id == unit.id]} for unit in units],
    }


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
async def list_links(db: AsyncSession = Depends(get_db)):
    return (await db.scalars(
        select(RelatedLink).where(RelatedLink.is_published.is_(True)).order_by(RelatedLink.sort_order, RelatedLink.title).limit(LINKS_PAGE)
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
