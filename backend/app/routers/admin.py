from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from datetime import time as time_type
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import cache
from app.config import get_settings
from app.database import get_db
from app.models import (
    AuditLog,
    ContactMessage,
    ContentPage,
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    NewsPost,
    Notice,
    PermissionGrant,
    RelatedLink,
    Reservation,
    ReservationBlackout,
    ReservationPurpose,
    ReservationSlot,
    ReservationStatus,
    ReservationUrgency,
    RoadmapItem,
    RoadmapMember,
    User,
    UserLicense,
    UserStatus,
)
from app.schemas import (
    PERMISSIONS,
    AdminAuditPage,
    AdminContactPage,
    AdminContactRead,
    AdminEquipmentRead,
    AdminLinkRead,
    AdminNewsRead,
    AdminNoticeRead,
    AdminReservationRead,
    AdminRoadmapRead,
    AdminUserRead,
    AuditActor,
    BlackoutClash,
    BlackoutPreview,
    BlackoutRead,
    BlackoutWrite,
    ContactMark,
    DirectoryUser,
    EquipmentLicenseWrite,
    EquipmentUnitRead,
    EquipmentUnitWrite,
    EquipmentWrite,
    LicenseAssignment,
    LicenseMembersResult,
    LicenseMembersWrite,
    LicenseRead,
    LicenseSetWrite,
    LicenseWrite,
    LinkInspect,
    LinkWrite,
    NewsWrite,
    NoticeWrite,
    OrderWrite,
    OwnerWrite,
    PageWrite,
    PermissionSetWrite,
    PermissionWrite,
    RecurringGroupRead,
    RecurringReservationCreate,
    RecurringReservationResult,
    RecurringSkip,
    ReservationDecision,
    ReservationPolicyRead,
    ReservationPolicyWrite,
    RoadmapWrite,
    UsageCount,
    UsageStats,
    UserDecision,
)
from app.security import READING_STATUSES, any_manager, owner_only, require_permission
from app.services import audit, blackouts, cloudinary, reservation_policy, usage
from app.services.content import sanitize_html
from app.services.link_preview import build as build_link_preview
from app.services.member_cards import ensure_card
from app.services.notifications import deliver_push, publish_notice_notifications
from app.services.reservation_alerts import label as reservation_label
from app.services.reservation_alerts import tell_owner as tell_reservation_owner
from app.services.reservation_alerts import tell_upcoming_users, tell_user
from app.services.reservation_alerts import when as reservation_when
from app.services.reservation_triage import (
    PURPOSE_LABEL,
    URGENCY_LABEL,
    pending_conflicts,
    score,
)
from app.services.reservations import (
    approve,
    as_utc,
    assert_eligible,
    cancel,
    publish_many,
    read_models,
    set_companions,
    slots,
    unit_context,
)
from app.services.revalidate import refresh

# 예약 기간 거르개와 정기 예약이 모두 서울 벽시계 날짜로 셈합니다.
SEOUL = ZoneInfo("Asia/Seoul")

# 관리자 창구의 쓰기는 빠짐없이 수정 내역에 남습니다. 창구마다 부르지 않고
# 라우터 전체에 걸어 두는 이유는 `app/services/audit.py` 에 적어 두었습니다.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(audit.audited)])

# 화면에서 켜고 끌 수 있는 기능 권한. `schemas.PERMISSIONS` 와 같은 목록이며,
# 여기 없는 이름은 받지 않는다.
MANAGEABLE_PERMISSIONS = {f"{name}:manage" for name in PERMISSIONS}

# 관리자 화면에서 고칠 수 있는 고정 페이지. 여기 없는 slug 는 받지 않는다.
# "home" 은 홈 화면의 글귀와 목록을 담는다. 3D 로봇 무대처럼 화면에서 고칠 수
# 없는 것은 여기 들어오지 않는다.
EDITABLE_PAGES = {"greeting", "club-introduction", "organization", "members", "home"}


def editor_payload(payload):
    data = payload.model_dump()
    data["content_html"] = sanitize_html(data.get("content_html", ""))
    return data


async def news_payload(payload: NewsWrite):
    data = editor_payload(payload)
    # 발행일은 아래에서 따로 다룬다. 초안으로 저장하면 아예 비워야 하고,
    # 비워 둔 채 공개하면 저장하는 날로 잡아야 하기 때문이다.
    data.pop("published_at", None)
    # HttpUrl round-trips as an object; the column stores plain text.
    data["external_url"] = str(payload.external_url) if payload.external_url else None
    # The article page needs an embed source or an Open Graph card, and reading
    # the remote page once on save keeps the public page free of outbound calls.
    content_json = dict(data.get("content_json") or {})
    content_json.pop("preview", None)
    if data["external_url"]:
        content_json["preview"] = await build_link_preview(data["external_url"])
    data["content_json"] = content_json
    return data


def published_date(payload: NewsWrite, previous: datetime | None = None) -> datetime | None:
    """이 글에 찍을 발행일.

    초안은 발행일이 없다(공개 목록이 `published_at` 이 있는 글만 내보낸다).
    공개할 때는 관리자가 고른 날짜를 쓰고, 고르지 않았으면 이미 있던 값을,
    그것도 없으면 지금을 쓴다.
    """
    if not payload.is_published:
        return None
    return payload.published_at or previous or datetime.now(UTC)


# ---------------------------------------------------------------- content pages


@router.put("/pages/{slug}")
async def save_page(slug: str, payload: PageWrite, _: User = Depends(require_permission("content:manage")), db: AsyncSession = Depends(get_db)):
    if slug not in EDITABLE_PAGES:
        raise HTTPException(404, "페이지를 찾을 수 없습니다.")
    item = await db.scalar(select(ContentPage).where(ContentPage.slug == slug))
    data = editor_payload(payload)
    if not item:
        item = ContentPage(slug=slug, title=payload.title, content_json=data["content_json"], content_html=data["content_html"], is_published=payload.is_published)
        db.add(item)
    else:
        item.title, item.content_json, item.content_html, item.is_published = payload.title, data["content_json"], data["content_html"], payload.is_published
    await db.commit()
    refresh("pages")
    return {"ok": True}


# ------------------------------------------------------------------------ news


@router.get("/news", response_model=list[AdminNewsRead])
async def admin_news(_: User = Depends(require_permission("news:manage")), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(NewsPost).order_by(NewsPost.updated_at.desc()))).all()


@router.post("/news", status_code=201)
async def create_news(payload: NewsWrite, _: User = Depends(require_permission("news:manage")), db: AsyncSession = Depends(get_db)):
    item = NewsPost(**await news_payload(payload), published_at=published_date(payload))
    db.add(item); await db.commit()
    refresh("news")
    return {"id": item.id}


@router.patch("/news/{item_id}")
async def update_news(item_id: UUID, payload: NewsWrite, _: User = Depends(require_permission("news:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(NewsPost, item_id)
    if not item:
        raise HTTPException(404, "뉴스를 찾을 수 없습니다.")
    before = item.cover_image
    for key, value in (await news_payload(payload)).items():
        setattr(item, key, value)
    replaced = before if before and before != item.cover_image else None
    # 관리자가 날짜를 고쳤으면 그대로 따른다. 예전에는 한 번 정해진 발행일을
    # 다시 바꿀 방법이 없어서, 날짜를 잘못 넣으면 지우고 새로 쓸 수밖에 없었다.
    item.published_at = published_date(payload, previous=item.published_at)
    await db.commit()
    refresh("news", [f"/news/{item_id}"])
    # 대표 사진을 갈아 끼웠으면 옛 사진은 아무도 가리키지 않는다.
    if replaced:
        await cloudinary.destroy(replaced)
    return {"ok": True}


@router.post("/link-preview")
async def inspect_link(payload: LinkInspect, _: User = Depends(require_permission("news:manage"))):
    """저장하기 전에 링크를 한 번 읽어 본다.

    언론보도를 올릴 때 발행일을 손으로 옮겨 적으면 틀리기 쉬우므로, 관리자 화면이
    주소를 붙여 넣는 순간 이 창구로 원문을 읽어 날짜 칸을 채운다. 저장하지
    않으므로 여러 번 눌러도 남는 것이 없다.
    """
    return await build_link_preview(str(payload.url))


@router.post("/news/{item_id}/preview")
async def refresh_news_preview(item_id: UUID, _: User = Depends(require_permission("news:manage")), db: AsyncSession = Depends(get_db)):
    """Re-read the linked page, for when the article was updated after saving."""
    item = await db.get(NewsPost, item_id)
    if not item:
        raise HTTPException(404, "뉴스를 찾을 수 없습니다.")
    if not item.external_url:
        raise HTTPException(422, "외부 링크가 없는 글입니다.")
    preview = await build_link_preview(item.external_url)
    item.content_json = {**(item.content_json or {}), "preview": preview}
    await db.commit()
    return preview


@router.delete("/news/{item_id}", status_code=204)
async def delete_news(item_id: UUID, _: User = Depends(require_permission("news:manage")), db: AsyncSession = Depends(get_db)):
    # 지우기 전에 대표 사진 주소를 챙긴다. 본문에 박힌 사진까지는 여기서 다루지
    # 않는다 — 같은 사진이 다른 글에도 붙어 있을 수 있어, 모든 글을 훑어 보고
    # 판단하는 정리 스크립트(`scripts/sweep_orphan_media.py`)에 맡긴다.
    cover = await db.scalar(select(NewsPost.cover_image).where(NewsPost.id == item_id))
    await db.execute(delete(NewsPost).where(NewsPost.id == item_id)); await db.commit()
    refresh("news", [f"/news/{item_id}"])
    await cloudinary.destroy(cover)


# --------------------------------------------------------------------- notices


@router.get("/notices", response_model=list[AdminNoticeRead])
async def admin_notices(_: User = Depends(require_permission("notices:manage")), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(Notice).order_by(Notice.updated_at.desc()))).all()


@router.post("/notices", status_code=201)
async def create_notice(payload: NoticeWrite, actor: User = Depends(require_permission("notices:manage")), db: AsyncSession = Depends(get_db)):
    item = Notice(**editor_payload(payload), author_id=actor.id, published_at=datetime.now(UTC) if payload.is_published else None)
    db.add(item); await db.flush()
    devices = await publish_notice_notifications(db, item.id, item.title) if payload.is_published else []
    await db.commit()
    await deliver_push(devices, item.title)
    refresh("notices")
    return {"id": item.id}


@router.patch("/notices/{item_id}")
async def update_notice(item_id: UUID, payload: NoticeWrite, _: User = Depends(require_permission("notices:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(Notice, item_id)
    if not item:
        raise HTTPException(404, "공지를 찾을 수 없습니다.")
    # A draft that is published for the first time notifies members exactly once.
    announce = payload.is_published and not item.is_published
    for key, value in editor_payload(payload).items():
        setattr(item, key, value)
    if payload.is_published and not item.published_at:
        item.published_at = datetime.now(UTC)
    devices = await publish_notice_notifications(db, item.id, item.title) if announce else []
    await db.commit()
    await deliver_push(devices, item.title)
    refresh("notices")
    return {"ok": True}


@router.delete("/notices/{item_id}", status_code=204)
async def delete_notice(item_id: UUID, _: User = Depends(require_permission("notices:manage")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Notice).where(Notice.id == item_id)); await db.commit()
    refresh("notices")


# ------------------------------------------------------------------- equipment


async def equipment_reads(db: AsyncSession, items) -> list[AdminEquipmentRead]:
    ids = [item.id for item in items]
    units = (await db.scalars(select(EquipmentUnit).where(EquipmentUnit.equipment_id.in_(ids)).order_by(EquipmentUnit.label))).all() if ids else []
    requirements = (await db.execute(select(EquipmentLicenseRequirement.equipment_id, EquipmentLicenseRequirement.license_id).where(EquipmentLicenseRequirement.equipment_id.in_(ids)))).all() if ids else []
    return [
        AdminEquipmentRead(
            **AdminEquipmentRead.model_validate(item).model_dump(exclude={"units", "required_license_ids"}),
            units=[EquipmentUnitRead.model_validate(unit) for unit in units if unit.equipment_id == item.id],
            required_license_ids=[row[1] for row in requirements if row[0] == item.id],
        )
        for item in items
    ]


@router.get("/equipment", response_model=list[AdminEquipmentRead])
async def admin_equipment(_: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    items = (await db.scalars(select(Equipment).order_by(Equipment.sort_order, Equipment.name))).all()
    return await equipment_reads(db, items)


@router.post("/equipment", status_code=201)
async def create_equipment(payload: EquipmentWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    item = Equipment(**payload.model_dump())
    db.add(item)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "같은 이름의 장비가 이미 있습니다.") from exc
    refresh("equipment")
    return {"id": item.id}


@router.patch("/equipment/{equipment_id}")
async def update_equipment(equipment_id: UUID, payload: EquipmentWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(Equipment, equipment_id)
    if not item:
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    was = item.status
    before_image = item.image_url
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    # 점검 중이나 운영 중지로 바뀌면, 그 시간에 오려던 사람이 헛걸음합니다.
    devices: list[dict] = []
    title = body = ""
    if was == EquipmentStatus.ACTIVE and item.status != EquipmentStatus.ACTIVE:
        label = "점검 중" if item.status == EquipmentStatus.MAINTENANCE else "운영 중지"
        title = f"{item.name} 이(가) {label} 상태로 바뀌었습니다"
        body = "예정된 예약이 있다면 운영진에게 확인해 주세요."
        devices = await tell_upcoming_users(db, item.id, title)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "같은 이름의 장비가 이미 있습니다.") from exc
    refresh("equipment", [f"/equipment/{equipment_id}"])
    # 장비 사진은 자주 갈아 끼우는 자리라 옛 사진이 가장 많이 쌓인다.
    if before_image and before_image != item.image_url:
        await cloudinary.destroy(before_image)
    if title:
        await deliver_push(devices, title, body=body, path="/mypage")
    return {"ok": True}


@router.put("/equipment/order")
async def reorder_equipment(payload: OrderWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    """장비가 보이는 차례를 한 번에 정합니다.

    관리자 화면에서 목록을 끌어다 놓으면 여기로 새 차례가 옵니다. 장비마다 따로
    저장하면 요청이 장비 수만큼 나가고, 중간에 하나가 실패하면 차례가 반쯤
    뒤섞인 채 남습니다. 한 번에 받아 한 번에 저장합니다.

    받지 못한 장비는 건드리지 않고 뒤에 그대로 둡니다.
    """
    wanted = [item_id for item_id in payload.ids]
    found = set((await db.scalars(select(Equipment.id).where(Equipment.id.in_(wanted)))).all())
    missing = [item_id for item_id in wanted if item_id not in found]
    if missing:
        raise HTTPException(404, "목록에 없는 장비가 있습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.")
    for position, item_id in enumerate(wanted):
        await db.execute(update(Equipment).where(Equipment.id == item_id).values(sort_order=position))
    await db.commit()
    refresh("equipment")
    return {"ok": True}


@router.delete("/equipment/{equipment_id}", status_code=204)
async def delete_equipment(equipment_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    image = await db.scalar(select(Equipment.image_url).where(Equipment.id == equipment_id))
    try:
        await db.execute(delete(Equipment).where(Equipment.id == equipment_id)); await db.commit()
        refresh("equipment", [f"/equipment/{equipment_id}"])
        await cloudinary.destroy(image)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "예약 이력이 있는 장비는 삭제할 수 없습니다. 운영 중지 상태로 변경해 주세요.") from exc


@router.get("/equipment/{equipment_id}/units", response_model=list[EquipmentUnitRead])
async def list_units(equipment_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(EquipmentUnit).where(EquipmentUnit.equipment_id == equipment_id).order_by(EquipmentUnit.label))).all()


@router.post("/equipment/{equipment_id}/units", status_code=201, response_model=EquipmentUnitRead)
async def create_unit(equipment_id: UUID, payload: EquipmentUnitWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    if not await db.get(Equipment, equipment_id):
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    item = EquipmentUnit(equipment_id=equipment_id, **payload.model_dump())
    db.add(item); await db.commit(); await db.refresh(item)
    refresh("equipment")
    return item


@router.patch("/equipment/units/{unit_id}", response_model=EquipmentUnitRead)
async def update_unit(unit_id: UUID, payload: EquipmentUnitWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(EquipmentUnit, unit_id)
    if not item:
        raise HTTPException(404, "호기를 찾을 수 없습니다.")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit(); await db.refresh(item)
    refresh("equipment")
    return item


@router.delete("/equipment/units/{unit_id}", status_code=204)
async def delete_unit(unit_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(delete(EquipmentUnit).where(EquipmentUnit.id == unit_id)); await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "예약 이력이 있는 호기는 삭제할 수 없습니다. 점검 중 상태로 변경해 주세요.") from exc


@router.put("/equipment/{equipment_id}/licenses")
async def set_equipment_licenses(equipment_id: UUID, payload: EquipmentLicenseWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    if not await db.get(Equipment, equipment_id):
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    known = set((await db.scalars(select(License.id).where(License.id.in_(payload.license_ids)))).all()) if payload.license_ids else set()
    if len(known) != len(set(payload.license_ids)):
        raise HTTPException(422, "존재하지 않는 라이선스가 포함되어 있습니다.")
    await db.execute(delete(EquipmentLicenseRequirement).where(EquipmentLicenseRequirement.equipment_id == equipment_id))
    db.add_all([EquipmentLicenseRequirement(equipment_id=equipment_id, license_id=license_id) for license_id in known])
    await db.commit()
    refresh("equipment")
    return {"ok": True}


# -------------------------------------------------------------------- licenses


@router.get("/licenses", response_model=list[LicenseRead])
async def admin_licenses(_: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(License).order_by(License.name))).all()


@router.post("/licenses", status_code=201)
async def create_license(payload: LicenseWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    item = License(**payload.model_dump())
    db.add(item)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "같은 이름의 라이선스가 이미 있습니다.") from exc
    return {"id": item.id}


@router.patch("/licenses/{license_id}")
async def update_license(license_id: UUID, payload: LicenseWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(License, license_id)
    if not item:
        raise HTTPException(404, "라이선스를 찾을 수 없습니다.")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    return {"ok": True}


@router.delete("/licenses/{license_id}", status_code=204)
async def delete_license(license_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(License).where(License.id == license_id)); await db.commit()


# ---------------------------------------------------------------------- roadmap


@router.get("/directory", response_model=list[DirectoryUser])
async def member_directory(_: User = Depends(any_manager), db: AsyncSession = Depends(get_db)):
    """사람을 고르는 화면이 쓰는 명단.

    보기 전용 회원도 넣습니다. 지난 학기 프로젝트에 이름이 남아 있거나 부원
    카드에 연결되어 있을 수 있는데, 명단에서 빠지면 이미 연결된 사람이 화면에서
    사라져 실수로 지워집니다.
    """
    return (await db.scalars(select(User).where(
        User.status.in_(READING_STATUSES), User.deleted_at.is_(None)).order_by(User.name))).all()


async def set_roadmap_members(db: AsyncSession, item_id: UUID, member_ids: list[UUID]) -> None:
    wanted = set(member_ids)
    known = set((await db.scalars(select(User.id).where(
        User.id.in_(wanted), User.status.in_(READING_STATUSES)))).all()) if wanted else set()
    if known != wanted:
        raise HTTPException(422, "승인되지 않은 회원은 프로젝트에 배정할 수 없습니다.")
    await db.execute(delete(RoadmapMember).where(RoadmapMember.roadmap_item_id == item_id))
    db.add_all([RoadmapMember(roadmap_item_id=item_id, user_id=user_id) for user_id in known])


@router.get("/roadmap", response_model=list[AdminRoadmapRead])
async def admin_roadmap(_: User = Depends(require_permission("roadmap:manage")), db: AsyncSession = Depends(get_db)):
    items = (await db.scalars(select(RoadmapItem).order_by(RoadmapItem.starts_at))).all()
    # 지금 돌려주는 일정에 걸린 배정만 읽는다. 조건 없이 읽으면 표 전체가 따라
    # 나오는데, 로드맵 배정은 학기마다 쌓이기만 하는 자리라 부원이 늘수록 화면이
    # 쓰지도 않을 행을 그만큼 더 실어 나른다.
    assignments = (await db.execute(
        select(RoadmapMember.roadmap_item_id, RoadmapMember.user_id)
        .where(RoadmapMember.roadmap_item_id.in_([item.id for item in items]))
    )).all() if items else []
    return [
        AdminRoadmapRead(
            **AdminRoadmapRead.model_validate(item).model_dump(exclude={"member_ids"}),
            member_ids=[row[1] for row in assignments if row[0] == item.id],
        )
        for item in items
    ]


@router.post("/roadmap", status_code=201)
async def create_roadmap(payload: RoadmapWrite, _: User = Depends(require_permission("roadmap:manage")), db: AsyncSession = Depends(get_db)):
    item = RoadmapItem(**payload.model_dump(exclude={"member_ids"}))
    db.add(item); await db.flush()
    await set_roadmap_members(db, item.id, payload.member_ids)
    await db.commit()
    refresh("roadmap")
    return {"id": item.id}


@router.patch("/roadmap/{item_id}")
async def update_roadmap(item_id: UUID, payload: RoadmapWrite, _: User = Depends(require_permission("roadmap:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(RoadmapItem, item_id)
    if not item:
        raise HTTPException(404, "일정을 찾을 수 없습니다.")
    for key, value in payload.model_dump(exclude={"member_ids"}).items():
        setattr(item, key, value)
    await set_roadmap_members(db, item.id, payload.member_ids)
    await db.commit()
    refresh("roadmap")
    return {"ok": True}


@router.delete("/roadmap/{item_id}", status_code=204)
async def delete_roadmap(item_id: UUID, _: User = Depends(require_permission("roadmap:manage")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(RoadmapItem).where(RoadmapItem.id == item_id)); await db.commit()
    refresh("roadmap")


# ------------------------------------------------------------------------ links


@router.get("/links", response_model=list[AdminLinkRead])
async def admin_links(_: User = Depends(require_permission("links:manage")), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(RelatedLink).order_by(RelatedLink.sort_order, RelatedLink.title))).all()


@router.post("/links", status_code=201)
async def create_link(payload: LinkWrite, _: User = Depends(require_permission("links:manage")), db: AsyncSession = Depends(get_db)):
    data = payload.model_dump() | {"url": str(payload.url)}
    item = RelatedLink(**data); db.add(item); await db.commit()
    refresh("links")
    return {"id": item.id}


@router.patch("/links/{item_id}")
async def update_link(item_id: UUID, payload: LinkWrite, _: User = Depends(require_permission("links:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(RelatedLink, item_id)
    if not item:
        raise HTTPException(404, "링크를 찾을 수 없습니다.")
    for key, value in (payload.model_dump() | {"url": str(payload.url)}).items():
        setattr(item, key, value)
    await db.commit()
    refresh("links")
    return {"ok": True}


@router.delete("/links/{item_id}", status_code=204)
async def delete_link(item_id: UUID, _: User = Depends(require_permission("links:manage")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(RelatedLink).where(RelatedLink.id == item_id)); await db.commit()
    refresh("links")


# ----------------------------------------------------------------- reservations


# 시급도를 그대로 ORDER BY 하면 `HIGH, LOW, NORMAL` 알파벳 순이 되어 '낮음' 이
# '보통' 위로 올라온다. 뜻하는 순서를 직접 적어 준다.
URGENCY_RANK = case(
    (Reservation.urgency == ReservationUrgency.HIGH, 0),
    (Reservation.urgency == ReservationUrgency.NORMAL, 1),
    else_=2,
)


@router.get("/reservations", response_model=list[AdminReservationRead])
async def list_reservations(
    status: ReservationStatus | None = Query(default=None),
    urgency: ReservationUrgency | None = Query(default=None),
    category: ReservationPurpose | None = Query(default=None),
    # 기본은 그대로 시작 시각 역순. 바꾸면 지금 화면의 차례가 말없이 뒤집힌다.
    sort: Literal["start", "created", "urgency", "priority"] = Query(default="start"),
    limit: int = Query(default=100, ge=1, le=300),
    # 아래 넷은 부원이 백 명이 되면 목록이 길어져 눈으로 못 찾기 때문에 둡니다.
    equipment_id: UUID | None = Query(default=None, alias="equipmentId"),
    from_date: date_type | None = Query(default=None, alias="from"),
    to_date: date_type | None = Query(default=None, alias="to"),
    keyword: str | None = Query(default=None, max_length=80, alias="q"),
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """예약 목록. 겹친 신청끼리 서로를 가리키게 하고 추천 순서도 함께 준다.

    `sort="priority"` 는 `created_at` 으로 한 쪽을 떠 온 뒤 파이썬에서 다시 세운다.
    즉 **페이지 경계는 여전히 신청 순서로 정해진다** — 300건을 넘게 쌓아 두고 부르면
    점수가 가장 높은 건이 페이지 밖에 있을 수 있다. 동아리 규모에서는 일어나지
    않지만, 나중에 이 코드를 읽는 사람이 놀라지 않도록 적어 둔다.
    """
    query = select(Reservation).limit(limit)
    if status:
        query = query.where(Reservation.status == status)
    if urgency:
        query = query.where(Reservation.urgency == urgency)
    if category:
        query = query.where(Reservation.purpose_category == category)
    if equipment_id:
        # 호기가 아니라 장비로 거릅니다. 운영진이 찾을 때 떠올리는 것은
        # "OMY 예약" 이지 "OMY 2호기 예약" 이 아닙니다.
        query = query.where(Reservation.equipment_unit_id.in_(
            select(EquipmentUnit.id).where(EquipmentUnit.equipment_id == equipment_id)))
    # 기간은 **서울 벽시계 날짜**로 받습니다. 화면의 날짜 칸이 그렇게 보이고,
    # UTC 로 끊으면 저녁 예약이 하루 밀려 다른 날에 잡힙니다.
    if from_date:
        query = query.where(Reservation.starts_at >= datetime.combine(from_date, time_type.min, SEOUL))
    if to_date:
        query = query.where(Reservation.starts_at < datetime.combine(to_date, time_type.min, SEOUL) + timedelta(days=1))
    if keyword and (needle := keyword.strip()):
        # 이름과 메일로 찾습니다. 신청자는 다른 표에 있으므로 하위 질의로 좁힙니다.
        # 메모(`note`)까지 넣지 않는 이유는, 그 칸이 길고 자유서술이라 훑는 값이
        # 붙는 데 비해 "누구 것" 을 찾는 실제 쓰임에 도움이 적기 때문입니다.
        like = f"%{needle}%"
        query = query.where(Reservation.user_id.in_(
            select(User.id).where(User.name.ilike(like) | User.email.ilike(like))))
    if sort == "created":
        query = query.order_by(Reservation.created_at.desc())
    elif sort == "urgency":
        query = query.order_by(URGENCY_RANK, Reservation.created_at)
    elif sort == "priority":
        query = query.order_by(Reservation.created_at.desc())
    else:
        query = query.order_by(Reservation.starts_at.desc())
    items = list((await db.scalars(query)).all())
    people = {user.id: user for user in (await db.scalars(select(User).where(User.id.in_({item.user_id for item in items})))).all()} if items else {}
    conflicts = pending_conflicts(items)
    now = datetime.now(UTC)
    scores = {item.id: score(item, now) for item in items}
    if sort == "priority":
        items.sort(key=lambda item: (-scores[item.id][0], item.created_at or now))
    return await read_models(
        db,
        items,
        model=AdminReservationRead,
        extra=lambda item: {
            "user_name": getattr(people.get(item.user_id), "name", ""),
            "user_email": getattr(people.get(item.user_id), "email", ""),
            "conflicts_with": conflicts.get(item.id, []),
            "priority": scores[item.id][0],
            "priority_reasons": scores[item.id][1],
        },
    )


@router.post("/reservations/{reservation_id}/decision")
async def reservation_decision(reservation_id: UUID, payload: ReservationDecision, _: User = Depends(require_permission("reservations:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(Reservation, reservation_id)
    if not item:
        raise HTTPException(404, "예약을 찾을 수 없습니다.")
    name = await reservation_label(db, item)
    if payload.approve:
        await approve(db, item)
        title = f"예약이 확정되었습니다 · {name} · {reservation_when(item.starts_at)}"
        body = "시간이 되면 사용 전 사진을 올리고 시작해 주세요."
    else:
        if item.status != ReservationStatus.PENDING:
            raise HTTPException(409, "대기 예약만 거절할 수 있습니다.")
        item.status, item.rejection_reason = ReservationStatus.REJECTED, payload.reason
        title = f"예약이 반려되었습니다 · {name} · {reservation_when(item.starts_at)}"
        body = payload.reason or "다른 시간으로 다시 신청해 주세요."
    # 신청한 사람에게 결과를 알립니다. 예전에는 마이페이지를 직접 열어 보기
    # 전에는 승인이 됐는지 알 수 없었습니다.
    devices = await tell_reservation_owner(db, item, title)
    await db.commit()
    await deliver_push(devices, title, body=body, path="/mypage")
    return {"ok": True}


@router.post("/reservations/{reservation_id}/cancel")
async def reservation_cancel(reservation_id: UUID, payload: ReservationDecision | None = None, _: User = Depends(require_permission("reservations:manage")), db: AsyncSession = Depends(get_db)):
    """Withdraw an already approved reservation and free its slots again."""
    item = await db.get(Reservation, reservation_id)
    if not item:
        raise HTTPException(404, "예약을 찾을 수 없습니다.")
    name = await reservation_label(db, item)
    await cancel(db, item, payload.reason if payload else None)
    title = f"예약이 취소되었습니다 · {name} · {reservation_when(item.starts_at)}"
    devices = await tell_reservation_owner(db, item, title)
    await db.commit()
    await deliver_push(devices, title, body=(payload.reason if payload else None) or "운영진이 예약을 취소했습니다.", path="/mypage")
    return {"ok": True}


# ------------------------------------------------------- recurring reservations

# 한 번에 만들 수 있는 최대 **기간**. 건수 상한은 관리자 화면에서 정한다
# (`services/reservation_policy.py`). 기간은 코드에 그대로 둔다 — 화면에서 늘릴
# 이유가 없고, 늘리면 등록 전 미리보기 목록이 감당하지 못한다.
RECURRING_MAX_DAYS = 200


def _minutes(label: str) -> int:
    hour, minute = label.split(":")
    return int(hour) * 60 + int(minute)


def _recurring_days(payload: RecurringReservationCreate) -> list[date_type]:
    wanted = set(payload.weekdays)
    span = (payload.until_date - payload.from_date).days
    return [
        payload.from_date + timedelta(days=offset)
        for offset in range(span + 1)
        if (payload.from_date + timedelta(days=offset)).weekday() in wanted
    ]


@router.post("/reservations/recurring", response_model=RecurringReservationResult, status_code=201)
async def create_recurring(
    payload: RecurringReservationCreate,
    actor: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """요일과 기간으로 정기 예약을 한 번에 잡습니다.

    교육 트랙은 화·수·목이 학기 내내 고정인데, 지금까지는 같은 신청을 매주 손으로
    되풀이해야 했습니다.

    **곧바로 확정 상태로 만듭니다.** 승인하는 사람이 직접 넣는 것이라 대기를 거칠
    이유가 없습니다. 예약은 넣은 운영진의 계정으로 잡히고, 실제로 오는 사람은
    기존 '함께 쓰는 부원' 으로 붙입니다 — 새 개념을 만들지 않고, 사고가 났을 때
    물어볼 곳도 종전과 같습니다.

    **겹치는 날짜는 건너뛰고 알려 줍니다.** 한 주가 겹친다고 학기 전체를 실패시키면
    운영진이 겹치는 주를 스스로 찾아 기간을 쪼개 다시 넣어야 합니다.
    """
    if payload.until_date < payload.from_date:
        raise HTTPException(422, "끝나는 날짜가 시작 날짜보다 앞설 수 없습니다.")
    if (payload.until_date - payload.from_date).days > RECURRING_MAX_DAYS:
        raise HTTPException(422, f"정기 예약은 {RECURRING_MAX_DAYS}일 이내에서만 잡을 수 있습니다.")
    start_minutes, end_minutes = _minutes(payload.start_time), _minutes(payload.end_time)
    if end_minutes <= start_minutes:
        raise HTTPException(422, "끝나는 시각이 시작 시각보다 뒤여야 합니다.")
    if end_minutes - start_minutes > 12 * 60:
        raise HTTPException(422, "한 번에 최대 12시간까지 예약할 수 있습니다.")

    days = _recurring_days(payload)
    if not days:
        raise HTTPException(422, "그 기간에 해당하는 요일이 없습니다.")
    # 상한은 관리자 화면에서 정합니다(`services/reservation_policy.py`).
    limit = (await reservation_policy.current(db)).recurring_max
    if len(days) > limit:
        raise HTTPException(422, f"한 번에 {limit}건까지 만들 수 있습니다. 기간을 나눠 주세요.")

    # 자격은 한 번만 봅니다. 모든 날짜가 같은 호기이기 때문입니다.
    _, equipment = await assert_eligible(db, actor.id, payload.equipment_unit_id)
    # 운영진이 막아 둔 시간은 정기 예약도 피해 갑니다. 이 창구는 `create_pending`
    # 을 거치지 않고 예약을 직접 만들기 때문에, 여기서 따로 봐야 합니다.
    rules = await blackouts.rules_for(db, equipment.id, payload.from_date, payload.until_date)

    now = datetime.now(UTC)
    group_id = uuid4()
    created: list[Reservation] = []
    skipped: list[RecurringSkip] = []

    for day in days:
        midnight = datetime.combine(day, time_type.min, tzinfo=SEOUL)
        starts_at = (midnight + timedelta(minutes=start_minutes)).astimezone(UTC)
        ends_at = (midnight + timedelta(minutes=end_minutes)).astimezone(UTC)
        if ends_at <= now:
            skipped.append(RecurringSkip(date=day, reason="이미 지난 시간입니다."))
            continue
        blocked = blackouts.hit(rules, payload.equipment_unit_id, starts_at, ends_at)
        if blocked:
            skipped.append(RecurringSkip(date=day, reason=f"사용 제한이 걸려 있습니다. {blocked.reason}".strip()))
            continue
        reservation = Reservation(
            equipment_unit_id=payload.equipment_unit_id,
            user_id=actor.id,
            starts_at=starts_at,
            ends_at=ends_at,
            note=payload.note,
            purpose_category=payload.purpose_category,
            urgency=payload.urgency,
            status=ReservationStatus.APPROVED,
            recurrence_group_id=group_id,
        )
        try:
            # 날짜마다 저장점을 둡니다. 한 주가 겹쳐도 나머지 주는 살아남습니다.
            # 겹침은 `uq_reservation_slot` 이 잡아 줍니다 — 미리 조회해 두고 그
            # 사이에 남이 예약하는 틈까지 막으려면 결국 이 제약에 기대야 합니다.
            async with db.begin_nested():
                db.add(reservation)
                await db.flush()
                await set_companions(db, reservation, payload.companion_ids, actor.id)
                db.add_all([
                    ReservationSlot(
                        equipment_unit_id=payload.equipment_unit_id,
                        reservation_id=reservation.id,
                        slot_start=slot,
                    )
                    for slot in slots(starts_at, ends_at)
                ])
                await db.flush()
        except IntegrityError:
            skipped.append(RecurringSkip(date=day, reason="이미 확정된 예약이 있습니다."))
            continue
        created.append(reservation)

    await db.commit()
    for item in created:
        await db.refresh(item)
    # 캘린더 등록은 저장이 모두 끝난 뒤에 한 번에 합니다.
    await publish_many(db, created)
    return RecurringReservationResult(
        group_id=group_id,
        created=await read_models(db, created),
        skipped=skipped,
    )


@router.get("/reservations/recurring", response_model=list[RecurringGroupRead])
async def list_recurring(
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """정기 예약 묶음 목록. 아직 남은 건수를 함께 보여 줍니다."""
    items = list((await db.scalars(
        select(Reservation)
        .where(Reservation.recurrence_group_id.is_not(None),
               Reservation.status.in_([ReservationStatus.APPROVED, ReservationStatus.IN_USE, ReservationStatus.COMPLETED]))
        .order_by(Reservation.starts_at)
    )).all())
    if not items:
        return []
    context = await unit_context(db, items)
    now = datetime.now(UTC)
    groups: dict[UUID, list[Reservation]] = {}
    for item in items:
        groups.setdefault(item.recurrence_group_id, []).append(item)
    out = []
    for group_id, rows in groups.items():
        first, last = rows[0], rows[-1]
        unit_label, equipment_name = context.get(first.equipment_unit_id, ("", ""))
        local_start = as_utc(first.starts_at).astimezone(SEOUL)
        local_end = as_utc(first.ends_at).astimezone(SEOUL)
        out.append(RecurringGroupRead(
            group_id=group_id,
            equipment_name=equipment_name,
            unit_label=unit_label,
            weekdays=sorted({as_utc(row.starts_at).astimezone(SEOUL).weekday() for row in rows}),
            start_time=local_start.strftime("%H:%M"),
            end_time=local_end.strftime("%H:%M"),
            first_date=local_start.date(),
            last_date=as_utc(last.starts_at).astimezone(SEOUL).date(),
            total=len(rows),
            upcoming=sum(1 for row in rows if as_utc(row.starts_at) > now),
        ))
    out.sort(key=lambda group: (group.first_date or date_type.min), reverse=True)
    return out


@router.delete("/reservations/recurring/{group_id}")
async def delete_recurring(
    group_id: UUID,
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """묶음에서 **아직 시작하지 않은** 예약만 물립니다.

    이미 지나간 것은 실제로 있었던 사용 기록이라 그대로 둡니다. 지우면 사용 통계와
    사용 전후 사진이 함께 사라집니다.
    """
    now = datetime.now(UTC)
    rows = (await db.scalars(select(Reservation).where(
        Reservation.recurrence_group_id == group_id,
        Reservation.starts_at > now,
        Reservation.status.in_([ReservationStatus.PENDING, ReservationStatus.APPROVED]),
    ))).all()
    for item in rows:
        await cancel(db, item, "정기 예약이 해제되었습니다.")
    return {"ok": True, "cancelled": len(rows)}


# ------------------------------------------------------------- 사용 제한(블록아웃)


# 한 규칙이 덮을 수 있는 최대 기간. 학기 하나(약 16주)보다 넉넉하되, 실수로 몇 해를
# 막아 버리는 일은 없게 합니다.
BLACKOUT_MAX_DAYS = 400
# 막힌 시간에 걸려 **취소되는** 상태. 사용 중인 예약은 건드리지 않습니다 — 이미
# 사람이 장비 앞에 서 있는데 예약만 사라지면 기록과 실제가 어긋납니다.
BLOCKABLE = (ReservationStatus.PENDING, ReservationStatus.APPROVED)


def _blackout_rule(payload: BlackoutWrite) -> ReservationBlackout:
    """저장하지 않은 규칙 객체. 미리보기와 등록이 같은 판정을 쓰게 합니다."""
    return ReservationBlackout(
        equipment_id=payload.equipment_id,
        equipment_unit_id=payload.equipment_unit_id,
        reason=payload.reason.strip(),
        weekdays=payload.weekdays,
        start_minute=_minutes(payload.start_time),
        end_minute=_minutes(payload.end_time),
        from_date=payload.from_date,
        until_date=payload.until_date,
    )


def _blackout_check(payload: BlackoutWrite) -> None:
    if payload.until_date < payload.from_date:
        raise HTTPException(422, "끝나는 날짜가 시작 날짜보다 앞설 수 없습니다.")
    if (payload.until_date - payload.from_date).days > BLACKOUT_MAX_DAYS:
        raise HTTPException(422, f"사용 제한은 {BLACKOUT_MAX_DAYS}일 이내에서만 걸 수 있습니다.")
    if _minutes(payload.end_time) <= _minutes(payload.start_time):
        raise HTTPException(422, "끝나는 시각이 시작 시각보다 뒤여야 합니다.")


async def _blackout_units(db: AsyncSession, rule: ReservationBlackout) -> list[UUID]:
    """이 규칙이 막는 호기. 호기를 지정하지 않았으면 그 장비의 모든 호기."""
    if rule.equipment_unit_id:
        return [rule.equipment_unit_id]
    return list((await db.scalars(
        select(EquipmentUnit.id).where(EquipmentUnit.equipment_id == rule.equipment_id)
    )).all())


def _blackout_days(rule: ReservationBlackout, since: date_type) -> int:
    """`since` 이후로 실제 막히는 날의 수."""
    first = max(rule.from_date, since)
    if rule.until_date < first:
        return 0
    span = (rule.until_date - first).days
    wanted = set(rule.weekdays or [])
    return sum(1 for offset in range(span + 1) if (first + timedelta(days=offset)).weekday() in wanted)


async def _blackout_clashes(db: AsyncSession, rule: ReservationBlackout) -> list[Reservation]:
    """막으려는 시간에 이미 들어와 있는 예약. **앞으로 남은 것만** 봅니다.

    이미 끝난 예약은 사용 기록이라 건드릴 이유가 없고, 사용 중인 예약은 사람이
    장비 앞에 서 있는 상태라 취소 대상이 아닙니다.
    """
    unit_ids = await _blackout_units(db, rule)
    if not unit_ids:
        return []
    now = datetime.now(UTC)
    window_start = datetime.combine(rule.from_date, time_type.min, tzinfo=SEOUL).astimezone(UTC)
    window_end = (datetime.combine(rule.until_date, time_type.min, tzinfo=SEOUL) + timedelta(days=1)).astimezone(UTC)
    rows = (await db.scalars(
        select(Reservation).where(
            Reservation.equipment_unit_id.in_(unit_ids),
            Reservation.status.in_(BLOCKABLE),
            Reservation.ends_at > max(window_start, now),
            Reservation.starts_at < window_end,
        ).order_by(Reservation.starts_at)
    )).all()
    return [
        row for row in rows
        if blackouts.hit([rule], row.equipment_unit_id, as_utc(row.starts_at), as_utc(row.ends_at))
    ]


async def _blackout_clash_reads(db: AsyncSession, rows: list[Reservation]) -> list[BlackoutClash]:
    if not rows:
        return []
    context = await unit_context(db, rows)
    people = {
        person.id: person.name or person.email
        for person in (await db.scalars(select(User).where(User.id.in_({row.user_id for row in rows})))).all()
    }
    return [
        BlackoutClash(
            id=row.id,
            user_name=people.get(row.user_id, "회원"),
            unit_label=context.get(row.equipment_unit_id, ("", ""))[0],
            equipment_name=context.get(row.equipment_unit_id, ("", ""))[1],
            starts_at=as_utc(row.starts_at),
            ends_at=as_utc(row.ends_at),
            status=row.status,
        )
        for row in rows
    ]


@router.get("/blackouts", response_model=list[BlackoutRead])
async def list_blackouts(
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """걸려 있는 사용 제한. 지난 것도 함께 보여 주고 남은 날 수를 붙입니다."""
    rows = list((await db.scalars(
        select(ReservationBlackout).order_by(ReservationBlackout.from_date.desc())
    )).all())
    if not rows:
        return []
    names = {
        row[0]: row[1]
        for row in (await db.execute(select(Equipment.id, Equipment.name))).all()
    }
    units = {
        row[0]: row[1]
        for row in (await db.execute(select(EquipmentUnit.id, EquipmentUnit.label))).all()
    }
    today = datetime.now(UTC).astimezone(SEOUL).date()
    return [
        BlackoutRead(
            id=row.id,
            equipment_id=row.equipment_id,
            equipment_unit_id=row.equipment_unit_id,
            equipment_name=names.get(row.equipment_id, "장비"),
            unit_label=units.get(row.equipment_unit_id, "") if row.equipment_unit_id else "",
            reason=row.reason,
            weekdays=list(row.weekdays or []),
            start_time=f"{row.start_minute // 60:02d}:{row.start_minute % 60:02d}",
            end_time=f"{row.end_minute // 60:02d}:{row.end_minute % 60:02d}",
            from_date=row.from_date,
            until_date=row.until_date,
            upcoming_days=_blackout_days(row, today),
        )
        for row in rows
    ]


@router.post("/blackouts/preview", response_model=BlackoutPreview)
async def preview_blackout(
    payload: BlackoutWrite,
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """등록하면 무슨 일이 일어나는지 먼저 보여 줍니다.

    막는 일은 남이 이미 잡아 둔 시간을 물리는 일이 될 수 있습니다. 몇 건이
    취소되는지 **이름과 함께** 보지 못한 채 단추를 누르게 하면 안 됩니다.
    """
    _blackout_check(payload)
    rule = _blackout_rule(payload)
    today = datetime.now(UTC).astimezone(SEOUL).date()
    clashes = await _blackout_clashes(db, rule)
    return BlackoutPreview(days=_blackout_days(rule, today), clashes=await _blackout_clash_reads(db, clashes))


@router.post("/blackouts", response_model=BlackoutRead, status_code=201)
async def create_blackout(
    request: Request,
    payload: BlackoutWrite,
    actor: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """시간을 막습니다. 걸리는 예약은 사유와 함께 취소하고 알립니다.

    **`cancelConflicts` 없이 부르면 걸리는 예약이 있을 때 거절합니다.** 미리보기를
    보지 않은 호출이 남의 확정 예약을 조용히 물리는 길을 열어 두지 않기 위해서입니다.
    화면은 먼저 미리보기를 띄우고, 운영진이 확인한 뒤에만 참으로 보냅니다.

    막는 규칙을 **먼저 저장하고** 예약을 취소합니다. 반대로 하면 취소는 됐는데
    규칙 저장이 실패했을 때 그 시간이 다시 열려 버립니다.
    """
    _blackout_check(payload)
    if not await db.get(Equipment, payload.equipment_id):
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    if payload.equipment_unit_id:
        unit = await db.get(EquipmentUnit, payload.equipment_unit_id)
        if not unit or unit.equipment_id != payload.equipment_id:
            raise HTTPException(422, "그 장비에 속한 호기가 아닙니다.")

    rule = _blackout_rule(payload)
    clashes = await _blackout_clashes(db, rule)
    if clashes and not payload.cancel_conflicts:
        raise HTTPException(409, f"막으려는 시간에 이미 예약 {len(clashes)}건이 있습니다. 먼저 확인해 주세요.")

    rule.created_by = actor.id
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    reason = f"운영진이 그 시간을 사용 제한으로 막았습니다. {rule.reason}".strip()
    sendable: list[tuple[str, str, list[dict]]] = []
    for item in clashes:
        name = await reservation_label(db, item)
        await cancel(db, item, reason)
        title = f"예약이 취소되었습니다 · {name} · {reservation_when(item.starts_at)}"
        sendable.append((title, reason, await tell_reservation_owner(db, item, title)))
    if sendable:
        await db.commit()
    for title, body, devices in sendable:
        await deliver_push(devices, title, body=body, path="/mypage")

    # 수정 내역에 남길 이름. 이 주소에는 식별자가 없어 자동으로는 이름을 찾을 수
    # 없습니다(`services/audit.py` 의 설명 참고). 무엇을 막았는지가 나중에 가장
    # 궁금해지는 기록이므로 직접 담아 둡니다.
    audit.note(request, target=rule.audit_label, detail=f"{len(clashes)}건 취소" if clashes else "")
    today = datetime.now(UTC).astimezone(SEOUL).date()
    equipment = await db.get(Equipment, rule.equipment_id)
    unit = await db.get(EquipmentUnit, rule.equipment_unit_id) if rule.equipment_unit_id else None
    return BlackoutRead(
        id=rule.id,
        equipment_id=rule.equipment_id,
        equipment_unit_id=rule.equipment_unit_id,
        equipment_name=getattr(equipment, "name", "장비"),
        unit_label=getattr(unit, "label", "") if unit else "",
        reason=rule.reason,
        weekdays=list(rule.weekdays or []),
        start_time=payload.start_time,
        end_time=payload.end_time,
        from_date=rule.from_date,
        until_date=rule.until_date,
        upcoming_days=_blackout_days(rule, today),
        cancelled_count=len(clashes),
    )


@router.delete("/blackouts/{blackout_id}", status_code=204)
async def delete_blackout(
    blackout_id: UUID,
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """제한을 풉니다. 그 시간이 곧바로 다시 열립니다.

    취소된 예약은 되돌아오지 않습니다 — 이미 신청자에게 취소를 알렸고, 그동안
    다른 사람이 그 시간을 잡았을 수도 있습니다.
    """
    rule = await db.get(ReservationBlackout, blackout_id)
    if not rule:
        raise HTTPException(404, "사용 제한을 찾을 수 없습니다.")
    await db.delete(rule)
    await db.commit()


# ------------------------------------------------------------------- 예약 정책


@router.get("/reservation-policy", response_model=ReservationPolicyRead)
async def read_reservation_policy(
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """지금 적용되는 예약 정책. 설정 행이 없으면 기본값으로 만들어 둡니다."""
    return await reservation_policy.row(db)


# 수정 내역에 남길 이름. 어떤 값이 얼마에서 얼마로 바뀌었는지가 나중에 궁금해진다.
POLICY_LABEL = {
    "auto_approve_minutes": "자동 확정",
    "staff_reminder_minutes": "운영진 독촉",
    "start_grace_minutes": "사용 시작 여유",
    "before_photo_grace_minutes": "사진 독촉",
    "max_hours": "한 건 최대",
    "booking_window_days": "예약 가능 기간",
    "recurring_max": "정기 예약 최대",
}


@router.put("/reservation-policy", response_model=ReservationPolicyRead)
async def save_reservation_policy(
    request: Request,
    payload: ReservationPolicyWrite,
    actor: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """정책을 바꿉니다. 예전에는 이 값들이 코드 상수라 배포를 해야 바뀌었습니다.

    바꾼 내용은 수정 내역에 남습니다(관리자 쓰기는 모두 남습니다). 다음 요청부터
    곧바로 적용되지만, 서버가 여럿이면 다른 프로세스는 최대 1분 동안 옛 값을
    들고 있습니다(`services/reservation_policy.TTL`).
    """
    row = await reservation_policy.row(db)
    # 무엇이 얼마에서 얼마로 바뀌었는지를 기록에 남긴다. 이 주소에는 식별자가 없어
    # 자동으로는 이름을 찾을 수 없고(`services/audit.py`), 설정 변경은 나중에
    # "언제부터 규칙이 달라졌지" 를 되짚게 되는 자리다.
    changes = [
        f"{POLICY_LABEL[name]} {getattr(row, name)}→{getattr(payload, name)}"
        for name in reservation_policy.FIELDS
        if getattr(row, name) != getattr(payload, name)
    ]
    audit.note(request, target="예약 정책", detail=", ".join(changes) if changes else "바뀐 값 없음")
    for name in reservation_policy.FIELDS:
        setattr(row, name, getattr(payload, name))
    row.updated_by = actor.id
    await db.commit()
    await db.refresh(row)
    reservation_policy.forget()
    return row


# --------------------------------------------------------------- 라이선스 일괄 부여


@router.get("/licenses/{license_id}/members")
async def license_members(
    license_id: UUID,
    _: User = Depends(require_permission("equipment:manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 교육을 이수한 사람의 id 목록."""
    if not await db.get(License, license_id):
        raise HTTPException(404, "라이선스를 찾을 수 없습니다.")
    ids = (await db.scalars(select(UserLicense.user_id).where(UserLicense.license_id == license_id))).all()
    return {"userIds": [str(user_id) for user_id in ids]}


@router.put("/licenses/{license_id}/members", response_model=LicenseMembersResult)
async def set_license_members(
    license_id: UUID,
    payload: LicenseMembersWrite,
    _: User = Depends(require_permission("equipment:manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 교육을 이수한 사람 목록을 통째로 맞춥니다.

    예전에는 회원 한 명을 고르고 그 사람의 라이선스를 손보는 길밖에 없었습니다
    (`PUT /users/{id}/licenses`). 교육을 한 번 하고 마흔 명에게 부여하려면 마흔 번
    들어갔다 나와야 했습니다.

    **새로 부여받은 사람에게는 알립니다.** 라이선스가 생겼다는 것은 곧 그 장비를
    예약할 수 있게 됐다는 뜻인데, 지금까지는 예약 화면에 들어가 잠긴 카드가
    풀린 것을 우연히 보기 전에는 알 길이 없었습니다.
    """
    license_row = await db.get(License, license_id)
    if not license_row:
        raise HTTPException(404, "라이선스를 찾을 수 없습니다.")
    wanted = set(payload.user_ids)
    if wanted:
        known = set((await db.scalars(
            select(User.id).where(User.id.in_(wanted), User.deleted_at.is_(None))
        )).all())
        if known != wanted:
            raise HTTPException(422, "없는 회원이 목록에 포함되어 있습니다.")
    current = set((await db.scalars(select(UserLicense.user_id).where(UserLicense.license_id == license_id))).all())
    added, removed = wanted - current, current - wanted
    if removed:
        await db.execute(delete(UserLicense).where(
            UserLicense.license_id == license_id, UserLicense.user_id.in_(removed)
        ))
    db.add_all([UserLicense(user_id=user_id, license_id=license_id) for user_id in added])

    title = f"{license_row.name} 이수가 등록되었습니다"
    devices: list[dict] = []
    for user_id in added:
        devices += await tell_user(db, user_id, title, "/equipment/reserve")
    await db.commit()
    await deliver_push(devices, title, body="이제 이 교육이 필요한 장비를 예약할 수 있습니다.", path="/equipment/reserve")
    return LicenseMembersResult(granted=len(added), revoked=len(removed), total=len(wanted))


# ------------------------------------------------------------------ usage stats


USAGE_STATUSES = (ReservationStatus.APPROVED, ReservationStatus.IN_USE, ReservationStatus.COMPLETED)
DECISION_LABEL = {
    "auto": "자동 확정",
    "staff": "운영진 승인",
    ReservationStatus.REJECTED.value: "반려",
    ReservationStatus.CANCELLED.value: "취소",
    ReservationStatus.EXPIRED.value: "만료",
}
STATS_MAX_DAYS = 366


@router.get("/reservations/stats", response_model=UsageStats)
async def reservation_stats(
    from_date: date_type = Query(alias="from"),
    until_date: date_type = Query(alias="to"),
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    """장비가 실제로 얼마나 쓰였는지.

    집계를 SQL 로 여섯 번 나눠 하지 않고 **한 번에 읽어 파이썬에서 셉니다.**
    이유가 둘입니다. 첫째, 사용 시간 합계는 `ends_at - starts_at` 이라 Postgres 와
    SQLite 의 문법이 달라 한 문장으로 쓸 수 없습니다. 둘째, 요일×시간 히트맵은
    어차피 예약을 시간 단위로 펴야 해서 행이 필요합니다. 기간을 366일로 묶어 두면
    동아리 규모에서 읽어 오는 양은 몇 천 행을 넘지 않습니다.

    가동률의 분모는 24시간입니다(`OPEN_HOUR, CLOSE_HOUR = 0, 24`). 새벽이 포함돼
    숫자가 낮게 나오므로 화면에 '24시간 기준' 이라고 적어 둡니다.
    """
    if until_date < from_date:
        raise HTTPException(422, "끝나는 날짜가 시작 날짜보다 앞설 수 없습니다.")
    days = (until_date - from_date).days + 1
    if days > STATS_MAX_DAYS:
        raise HTTPException(422, f"기간은 {STATS_MAX_DAYS}일 이내로 골라 주세요.")

    window_start = datetime.combine(from_date, time_type.min, tzinfo=SEOUL).astimezone(UTC)
    window_end = (datetime.combine(until_date, time_type.min, tzinfo=SEOUL) + timedelta(days=1)).astimezone(UTC)

    rows = (await db.execute(
        select(
            Reservation.equipment_unit_id, Reservation.user_id, Reservation.purpose_category,
            Reservation.urgency, Reservation.status, Reservation.auto_decided_at,
            Reservation.starts_at, Reservation.ends_at,
        ).where(Reservation.starts_at < window_end, Reservation.ends_at > window_start)
    )).all()

    units = {
        row[0]: (row[1], row[2])
        for row in (await db.execute(
            select(EquipmentUnit.id, EquipmentUnit.equipment_id, Equipment.name)
            .join(Equipment, Equipment.id == EquipmentUnit.equipment_id)
        )).all()
    }
    unit_counts: dict[UUID, int] = {}
    for equipment_id, _name in units.values():
        unit_counts[equipment_id] = unit_counts.get(equipment_id, 0) + 1
    people = {
        person.id: person.name or person.email
        for person in (await db.scalars(select(User).where(User.id.in_({row[1] for row in rows})))).all()
    } if rows else {}

    equipment_stats: dict[UUID, list] = {}
    purpose_stats: dict[str, list] = {}
    urgency_stats: dict[str, list] = {}
    decision_stats: dict[str, int] = {}
    people_stats: dict[UUID, list] = {}
    heatmap = [[0] * 24 for _ in range(7)]
    total_count, total_hours = 0, 0.0

    for unit_id, user_id, purpose, urgency, status, auto_at, starts_at, ends_at in rows:
        key = ("auto" if auto_at else "staff") if status in USAGE_STATUSES else status.value
        decision_stats[key] = decision_stats.get(key, 0) + 1
        if status not in USAGE_STATUSES:
            continue
        begins = max(as_utc(starts_at), window_start)
        finishes = min(as_utc(ends_at), window_end)
        hours = max(0.0, (finishes - begins).total_seconds() / 3600)
        total_count += 1
        total_hours += hours

        equipment_id = units.get(unit_id, (None, ""))[0]
        for bucket, bucket_key in ((equipment_stats, equipment_id), (people_stats, user_id)):
            row = bucket.setdefault(bucket_key, [0, 0.0])
            row[0] += 1
            row[1] += hours
        for bucket, bucket_key in ((purpose_stats, purpose.value), (urgency_stats, urgency.value)):
            row = bucket.setdefault(bucket_key, [0, 0.0])
            row[0] += 1
            row[1] += hours

        # 히트맵은 예약이 걸쳐 있는 매 시간을 한 칸씩 채웁니다. 한국 시각 기준입니다.
        cursor = begins.astimezone(SEOUL).replace(minute=0, second=0, microsecond=0)
        last = finishes.astimezone(SEOUL)
        while cursor < last:
            heatmap[cursor.weekday()][cursor.hour] += 1
            cursor += timedelta(hours=1)

    def rank(bucket: dict, labels, utilise: bool = False) -> list[UsageCount]:
        out = []
        for key, (count, hours) in bucket.items():
            capacity = days * 24 * max(1, unit_counts.get(key, 1)) if utilise else 0
            out.append(UsageCount(
                key=str(key), label=labels(key), count=count, hours=round(hours, 1),
                utilisation=round(hours / capacity * 100, 1) if capacity else None,
            ))
        out.sort(key=lambda row: row.hours, reverse=True)
        return out

    return UsageStats(
        from_date=from_date, until_date=until_date, days=days,
        total_count=total_count, total_hours=round(total_hours, 1),
        equipment=rank(equipment_stats, lambda key: next((name for eq, name in units.values() if eq == key), "장비"), utilise=True),
        purposes=rank(purpose_stats, lambda key: PURPOSE_LABEL.get(ReservationPurpose(key), key)),
        urgencies=rank(urgency_stats, lambda key: URGENCY_LABEL.get(ReservationUrgency(key), key)),
        decisions=[
            UsageCount(key=key, label=DECISION_LABEL.get(key, key), count=count)
            for key, count in sorted(decision_stats.items(), key=lambda pair: -pair[1])
        ],
        people=rank(people_stats, lambda key: people.get(key, "회원"))[:10],
        heatmap=heatmap,
    )


# ---------------------------------------------------------------------- members


@router.get("/users", response_model=list[AdminUserRead])
async def list_users(_: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    users = (await db.scalars(select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc()))).all()
    # 목록에 나오는 회원의 권한·자격만 읽는다. 조건 없이 읽으면 탈퇴한 회원의
    # 행까지 전부 따라 나와서 아래에서 버려진다.
    ids = [user.id for user in users]
    grants = (await db.execute(
        select(PermissionGrant.user_id, PermissionGrant.permission).where(PermissionGrant.user_id.in_(ids))
    )).all() if ids else []
    licenses = (await db.execute(
        select(UserLicense.user_id, UserLicense.license_id).where(UserLicense.user_id.in_(ids))
    )).all() if ids else []
    return [
        AdminUserRead(
            **AdminUserRead.model_validate(user).model_dump(exclude={"permissions", "license_ids"}),
            permissions=[row[1] for row in grants if row[0] == user.id],
            license_ids=[row[1] for row in licenses if row[0] == user.id],
        )
        for user in users
    ]


@router.patch("/users/{user_id}/status")
async def set_user_status(user_id: UUID, payload: UserDecision, actor: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    if user.id == actor.id and payload.status != UserStatus.APPROVED:
        raise HTTPException(409, "자신의 계정 상태는 변경할 수 없습니다.")
    became = payload.status != user.status
    user.status = payload.status
    # 부원이 되는 순간 부원 카드도 생깁니다. 명단에 미리 이름이 없던 새 부원은
    # 이것이 없으면 부원 페이지에 아예 나오지 않습니다.
    devices: list[dict] = []
    title = body = ""
    if payload.status in READING_STATUSES:
        await ensure_card(db, user)
        if became:
            # 승인됐는지 직접 들어와 봐야 알던 것을 알려 줍니다.
            viewer = payload.status == UserStatus.VIEWER
            title = "SHAPE 가입이 승인되었습니다" if not viewer else "SHAPE 계정이 보기 전용으로 열렸습니다"
            body = (
                "이제 게시판·자료실과 장비 예약을 쓸 수 있습니다."
                if not viewer
                else "공지와 자료실을 읽을 수 있습니다. 글쓰기와 예약은 활동 중인 회원만 가능합니다."
            )
            devices = await tell_user(db, user.id, title)
    await db.commit()
    if payload.status in READING_STATUSES:
        refresh("pages")
    if devices or title:
        await deliver_push(devices, title, body=body, path="/mypage")
    return {"ok": True}


@router.post("/users/{user_id}/permissions", status_code=201)
async def grant_permission(user_id: UUID, payload: PermissionWrite, _: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    if not await db.get(User, user_id):
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    existing = await db.scalar(select(PermissionGrant).where(PermissionGrant.user_id == user_id, PermissionGrant.permission == payload.permission))
    if not existing:
        db.add(PermissionGrant(user_id=user_id, permission=payload.permission))
        await db.commit()
    return {"ok": True}


@router.put("/users/{user_id}/permissions")
async def set_permissions(user_id: UUID, payload: PermissionSetWrite, _: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    """이 회원의 기능 권한을 목록 그대로 맞춥니다. '전체 부여·해제' 가 씁니다."""
    if not await db.get(User, user_id):
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    wanted = {name for name in payload.permissions if name in MANAGEABLE_PERMISSIONS}
    if wanted != set(payload.permissions):
        raise HTTPException(422, "알 수 없는 권한이 포함되어 있습니다.")
    await db.execute(delete(PermissionGrant).where(PermissionGrant.user_id == user_id))
    db.add_all([PermissionGrant(user_id=user_id, permission=name) for name in sorted(wanted)])
    await db.commit()
    return {"permissions": sorted(wanted)}


@router.put("/users/{user_id}/licenses")
async def set_licenses(user_id: UUID, payload: LicenseSetWrite, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    """이 회원이 이수한 교육을 목록 그대로 맞춥니다."""
    if not await db.get(User, user_id):
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    known = set((await db.scalars(select(License.id).where(License.id.in_(payload.license_ids)))).all()) if payload.license_ids else set()
    if known != set(payload.license_ids):
        raise HTTPException(422, "존재하지 않는 라이선스가 포함되어 있습니다.")
    await db.execute(delete(UserLicense).where(UserLicense.user_id == user_id))
    db.add_all([UserLicense(user_id=user_id, license_id=license_id) for license_id in known])
    await db.commit()
    return {"licenseIds": [str(license_id) for license_id in known]}


@router.patch("/users/{user_id}/owner")
async def set_owner(user_id: UUID, payload: OwnerWrite, actor: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    """owner 를 새로 지명하거나 내립니다.

    owner 는 모든 확인을 무조건 통과하므로 여러 명이어도 됩니다. 지금까지는
    `INITIAL_OWNER_EMAILS` 에 적힌 계정만 owner 가 될 수 있어서, 회장이 바뀌면
    환경변수를 고치고 다시 배포해야 했습니다.

    지명하면 기능 권한도 함께 채웁니다. owner 는 권한 확인을 건너뛰므로 동작에는
    차이가 없지만, 화면에서 무엇을 가졌는지 그대로 보이는 편이 낫고 나중에
    owner 를 내려도 하던 일을 이어갈 수 있습니다.
    """
    user = await db.get(User, user_id)
    if not user or user.deleted_at:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    if not payload.is_owner:
        if user.id == actor.id:
            raise HTTPException(409, "자신의 owner 권한은 내릴 수 없습니다. 다른 owner 에게 요청해 주세요.")
        remaining = await db.scalar(select(func.count()).select_from(User).where(
            User.is_owner.is_(True), User.deleted_at.is_(None), User.id != user_id))
        if not remaining:
            raise HTTPException(409, "마지막 owner 는 내릴 수 없습니다. 먼저 다른 owner 를 지명해 주세요.")
        user.is_owner = False
        await db.commit()
        # 권한은 남긴다. 내리는 것과 하던 일을 빼앗는 것은 다른 일이다.
        return {"isOwner": False}

    user.is_owner = True
    # owner 는 승인된 회원이어야 회원용 화면에 들어갈 수 있다.
    if user.status != UserStatus.APPROVED:
        user.status = UserStatus.APPROVED
    await ensure_card(db, user)
    held = set((await db.scalars(select(PermissionGrant.permission).where(PermissionGrant.user_id == user_id))).all())
    db.add_all([PermissionGrant(user_id=user_id, permission=name)
                for name in sorted(MANAGEABLE_PERMISSIONS - held)])
    await db.commit()
    return {"isOwner": True, "permissions": sorted(MANAGEABLE_PERMISSIONS)}


@router.delete("/users/{user_id}/permissions/{permission}", status_code=204)
async def revoke_permission(user_id: UUID, permission: str, _: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(PermissionGrant).where(PermissionGrant.user_id == user_id, PermissionGrant.permission == permission))
    await db.commit()


@router.post("/users/{user_id}/licenses", status_code=201)
async def grant_license(user_id: UUID, payload: LicenseAssignment, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    if not await db.get(User, user_id):
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    if not await db.get(License, payload.license_id):
        raise HTTPException(404, "라이선스를 찾을 수 없습니다.")
    existing = await db.scalar(select(UserLicense).where(UserLicense.user_id == user_id, UserLicense.license_id == payload.license_id))
    if existing:
        return {"ok": True}
    db.add(UserLicense(user_id=user_id, license_id=payload.license_id))
    licence = await db.get(License, payload.license_id)
    # 이 교육을 요구하던 장비 이름을 함께 알려 주면, 받은 사람이 바로 예약으로
    # 이어집니다. "라이선스를 받았다" 만으로는 무엇이 열렸는지 알 수 없습니다.
    opened = list((await db.scalars(
        select(Equipment.name)
        .join(EquipmentLicenseRequirement, EquipmentLicenseRequirement.equipment_id == Equipment.id)
        .where(EquipmentLicenseRequirement.license_id == payload.license_id)
        .order_by(Equipment.sort_order, Equipment.name)
    )).all())
    title = f"‘{licence.name}’ 이수가 등록되었습니다"
    body = f"이제 {', '.join(opened)} 을(를) 예약할 수 있습니다." if opened else "마이페이지에서 보유 라이선스를 확인할 수 있습니다."
    devices = await tell_user(db, user_id, title)
    await db.commit()
    await deliver_push(devices, title, body=body, path="/mypage")
    return {"ok": True}


@router.delete("/users/{user_id}/licenses/{license_id}", status_code=204)
async def revoke_license(user_id: UUID, license_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(UserLicense).where(UserLicense.user_id == user_id, UserLicense.license_id == license_id))
    await db.commit()


# --------------------------------------------------------------------- 서버 사용량


@router.get("/usage")
async def service_usage(
    refresh: bool = Query(default=False, description="캐시를 버리고 지금 값을 다시 모읍니다"),
    _: User = Depends(owner_only),
):
    """무료 티어를 얼마나 썼는지. 관리자 '서버' 탭이 씁니다.

    **데이터베이스를 건드리지 않습니다.** 여기서 부르는 곳은 각 서비스의 관리용
    API 이고, Neon 콘솔 API 는 데이터베이스가 아니라 그 앞의 제어면이라 잠들어
    있는 compute 를 깨우지 않습니다. 이 창구가 데이터베이스를 여는 것은 위의
    로그인 검사뿐인데, 그건 운영진이 관리자 화면을 여는 순간 어차피 일어납니다.

    **여섯 시간 동안 들고 있습니다.** 한 달 단위로 보는 숫자라 실시간일 이유가
    없고, 탭을 열 때마다 바깥을 부르면 이 화면 자체가 사용량이 됩니다. 공개 캐시와
    같은 '창' 을 씁니다(`app/cache.py`) — 시계에 고정된 칸의 끝에서 만료되므로,
    운영진이 여럿이어도 바깥으로 나가는 요청은 여섯 시간에 한 번입니다.
    """
    window = get_settings().usage_cache_seconds
    key = "admin:usage"
    if not refresh:
        stored = cache.get(key)
        if stored is not None:
            return {**stored, "cached": True}
    # 같은 순간에 둘이 열어도 바깥은 한 번만 부릅니다.
    async with cache.lock_for(key):
        if not refresh:
            stored = cache.get(key)
            if stored is not None:
                return {**stored, "cached": True}
        fresh = await usage.snapshot()
        cache.set(key, fresh, window)
        return {**fresh, "cached": False}


# --------------------------------------------------------------------- 수정 내역


AUDIT_PAGE = 50
# 거르개 목록을 뽑을 때 훑을 최근 기록 수. 표 전체에 `distinct` 를 걸면 기록이
# 쌓이는 만큼 값이 붙습니다. 최근 것만 봐도 지금 활동하는 사람과 영역은 다 나옵니다.
AUDIT_FILTER_SCAN = 500


@router.get("/audit", response_model=AdminAuditPage)
async def admin_audit(
    before: datetime | None = Query(default=None, description="이 시각보다 앞선 기록부터 이어 받습니다."),
    limit: int = Query(default=AUDIT_PAGE, ge=1, le=AUDIT_PAGE),
    actor: UUID | None = Query(default=None, description="이 사람의 기록만"),
    area: str | None = Query(default=None, max_length=40, description="이 영역의 기록만"),
    _: User = Depends(owner_only),
    db: AsyncSession = Depends(get_db),
):
    """운영진이 관리자 화면에서 무엇을 고쳤는지. owner 만 볼 수 있습니다.

    최신순으로 끊어 돌려줍니다. 기록은 지우지 않고 쌓이기만 하므로 상한 없이
    돌려주면 해가 갈수록 응답만 무거워집니다.
    """
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if before:
        query = query.where(AuditLog.created_at < before)
    if actor:
        query = query.where(AuditLog.actor_id == actor)
    if area:
        query = query.where(AuditLog.area == area)
    items = (await db.scalars(query)).all()

    # 거르개 목록은 첫 쪽에서만 만듭니다.
    actors: list[AuditActor] = []
    areas: list[str] = []
    if not before:
        recent = select(AuditLog.actor_id, AuditLog.actor_name, AuditLog.area).order_by(
            AuditLog.created_at.desc()).limit(AUDIT_FILTER_SCAN).subquery()
        rows = (await db.execute(select(recent.c.actor_id, recent.c.actor_name, recent.c.area))).all()
        seen: dict[UUID | None, str] = {}
        for actor_id, actor_name, row_area in rows:
            seen.setdefault(actor_id, actor_name or "알 수 없음")
            if row_area and row_area not in areas:
                areas.append(row_area)
        actors = [AuditActor(id=key, name=value) for key, value in seen.items()]
        actors.sort(key=lambda person: person.name)
        areas.sort()
    return AdminAuditPage(items=items, actors=actors, areas=areas)


# 문의 한 쪽에 담는 수. 화면의 `PAGE` 와 같아야 합니다.
CONTACT_PAGE = 30


@router.get("/contact", response_model=AdminContactPage)
async def list_contact(
    before: datetime | None = Query(default=None, description="이 시각보다 앞선 문의부터 이어 받습니다."),
    limit: int = Query(default=CONTACT_PAGE, ge=1, le=CONTACT_PAGE),
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    _: User = Depends(require_permission("contact:manage")),
    db: AsyncSession = Depends(get_db),
):
    """`/contact` 로 들어온 문의. 최신순으로 끊어 돌려줍니다.

    안 읽은 수는 이 쪽에 실린 것이 아니라 **전체**를 셉니다. 탭 이름 옆 숫자가
    거짓말을 하면 안 되기 때문입니다(`ix_contact_unread_recent` 가 받칩니다).
    """
    query = select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(limit)
    if before:
        query = query.where(ContactMessage.created_at < before)
    if unread_only:
        query = query.where(ContactMessage.is_read.is_(False))
    items = (await db.scalars(query)).all()
    unread = await db.scalar(
        select(func.count()).select_from(ContactMessage).where(ContactMessage.is_read.is_(False))
    )
    return AdminContactPage(items=items, unread=int(unread or 0))


@router.patch("/contact/{message_id}", response_model=AdminContactRead)
async def mark_contact(
    message_id: UUID,
    payload: ContactMark,
    request: Request,
    user: User = Depends(require_permission("contact:manage")),
    db: AsyncSession = Depends(get_db),
):
    """문의 한 건을 읽음·처리로 표시합니다. 준 것만 바뀝니다.

    읽음과 처리를 따로 두는 이유는 **'읽었지만 아직 답을 못 한 것'** 이 운영진이
    실제로 챙겨야 하는 상태이기 때문입니다. 읽었다고 사라지면 그것이 묻힙니다.
    """
    item = await db.get(ContactMessage, message_id)
    if not item:
        raise HTTPException(404, "문의를 찾을 수 없습니다.")
    if payload.is_read is not None:
        item.is_read = payload.is_read
    if payload.handled is not None:
        item.handled_at = datetime.now(UTC) if payload.handled else None
        item.handled_by = user.id if payload.handled else None
    audit.note(request, target=item.audit_label,
               detail="답변 완료" if item.handled_at else ("읽음" if item.is_read else "안 읽음"))
    await db.commit(); await db.refresh(item)
    return item


@router.delete("/contact/{message_id}", status_code=204)
async def remove_contact(
    message_id: UUID,
    request: Request,
    _: User = Depends(require_permission("contact:manage")),
    db: AsyncSession = Depends(get_db),
):
    """문의를 지웁니다. 스팸이 들어왔을 때 쓰는 길입니다."""
    item = await db.get(ContactMessage, message_id)
    if not item:
        raise HTTPException(404, "문의를 찾을 수 없습니다.")
    audit.note(request, target=item.audit_label)
    await db.delete(item)
    await db.commit()
