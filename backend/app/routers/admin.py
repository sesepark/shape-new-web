from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
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
    Notice,
    PermissionGrant,
    RelatedLink,
    Reservation,
    ReservationStatus,
    RoadmapItem,
    RoadmapMember,
    User,
    UserLicense,
    UserStatus,
)
from app.schemas import (
    PERMISSIONS,
    AdminEquipmentRead,
    AdminLinkRead,
    AdminNewsRead,
    AdminNoticeRead,
    AdminReservationRead,
    AdminRoadmapRead,
    AdminUserRead,
    DirectoryUser,
    EquipmentLicenseWrite,
    EquipmentUnitRead,
    EquipmentUnitWrite,
    EquipmentWrite,
    LicenseAssignment,
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
    ReservationDecision,
    RoadmapWrite,
    UserDecision,
)
from app.security import READING_STATUSES, any_manager, owner_only, require_permission
from app.services import cloudinary
from app.services.content import sanitize_html
from app.services.link_preview import build as build_link_preview
from app.services.member_cards import ensure_card
from app.services.notifications import deliver_push, publish_notice_notifications
from app.services.reservation_alerts import label as reservation_label
from app.services.reservation_alerts import tell_owner as tell_reservation_owner
from app.services.reservation_alerts import tell_upcoming_users, tell_user
from app.services.reservation_alerts import when as reservation_when
from app.services.reservations import approve, cancel, read_models
from app.services.revalidate import refresh

router = APIRouter(prefix="/admin", tags=["admin"])

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
    assignments = (await db.execute(select(RoadmapMember.roadmap_item_id, RoadmapMember.user_id))).all()
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


@router.get("/reservations", response_model=list[AdminReservationRead])
async def list_reservations(
    status: ReservationStatus | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    _: User = Depends(require_permission("reservations:manage")),
    db: AsyncSession = Depends(get_db),
):
    query = select(Reservation).order_by(Reservation.starts_at.desc()).limit(limit)
    if status:
        query = query.where(Reservation.status == status)
    items = (await db.scalars(query)).all()
    people = {user.id: user for user in (await db.scalars(select(User).where(User.id.in_({item.user_id for item in items})))).all()} if items else {}
    return await read_models(
        db,
        items,
        model=AdminReservationRead,
        extra=lambda item: {
            "user_name": getattr(people.get(item.user_id), "name", ""),
            "user_email": getattr(people.get(item.user_id), "email", ""),
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


# ---------------------------------------------------------------------- members


@router.get("/users", response_model=list[AdminUserRead])
async def list_users(_: User = Depends(owner_only), db: AsyncSession = Depends(get_db)):
    users = (await db.scalars(select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc()))).all()
    grants = (await db.execute(select(PermissionGrant.user_id, PermissionGrant.permission))).all()
    licenses = (await db.execute(select(UserLicense.user_id, UserLicense.license_id))).all()
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
