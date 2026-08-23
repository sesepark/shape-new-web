from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    ContentPage,
    Equipment,
    EquipmentLicenseRequirement,
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
    LicenseWrite,
    LinkWrite,
    NewsWrite,
    NoticeWrite,
    PageWrite,
    PermissionWrite,
    ReservationDecision,
    RoadmapWrite,
    UserDecision,
)
from app.security import any_manager, owner_only, require_permission
from app.services.content import sanitize_html
from app.services.link_preview import build as build_link_preview
from app.services.notifications import publish_notice_notifications
from app.services.reservations import approve, cancel, read_models
from app.services.revalidate import refresh

router = APIRouter(prefix="/admin", tags=["admin"])

EDITABLE_PAGES = {"greeting", "club-introduction", "organization", "members"}


def editor_payload(payload):
    data = payload.model_dump()
    data["content_html"] = sanitize_html(data.get("content_html", ""))
    return data


async def news_payload(payload: NewsWrite):
    data = editor_payload(payload)
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
    item = NewsPost(**await news_payload(payload), published_at=datetime.now(UTC) if payload.is_published else None)
    db.add(item); await db.commit()
    refresh("news")
    return {"id": item.id}


@router.patch("/news/{item_id}")
async def update_news(item_id: UUID, payload: NewsWrite, _: User = Depends(require_permission("news:manage")), db: AsyncSession = Depends(get_db)):
    item = await db.get(NewsPost, item_id)
    if not item:
        raise HTTPException(404, "뉴스를 찾을 수 없습니다.")
    for key, value in (await news_payload(payload)).items():
        setattr(item, key, value)
    if payload.is_published and not item.published_at:
        item.published_at = datetime.now(UTC)
    await db.commit()
    refresh("news")
    return {"ok": True}


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
    await db.execute(delete(NewsPost).where(NewsPost.id == item_id)); await db.commit()
    refresh("news")


# --------------------------------------------------------------------- notices


@router.get("/notices", response_model=list[AdminNoticeRead])
async def admin_notices(_: User = Depends(require_permission("notices:manage")), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(Notice).order_by(Notice.updated_at.desc()))).all()


@router.post("/notices", status_code=201)
async def create_notice(payload: NoticeWrite, actor: User = Depends(require_permission("notices:manage")), db: AsyncSession = Depends(get_db)):
    item = Notice(**editor_payload(payload), author_id=actor.id, published_at=datetime.now(UTC) if payload.is_published else None)
    db.add(item); await db.flush()
    if payload.is_published:
        await publish_notice_notifications(db, item.id, item.title)
    await db.commit()
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
    if announce:
        await publish_notice_notifications(db, item.id, item.title)
    await db.commit()
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
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "같은 이름의 장비가 이미 있습니다.") from exc
    refresh("equipment")
    return {"ok": True}


@router.delete("/equipment/{equipment_id}", status_code=204)
async def delete_equipment(equipment_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(delete(Equipment).where(Equipment.id == equipment_id)); await db.commit()
        refresh("equipment")
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
    """Approved members, for assigning roadmap projects without owner rights."""
    return (await db.scalars(select(User).where(User.status == UserStatus.APPROVED, User.deleted_at.is_(None)).order_by(User.name))).all()


async def set_roadmap_members(db: AsyncSession, item_id: UUID, member_ids: list[UUID]) -> None:
    wanted = set(member_ids)
    known = set((await db.scalars(select(User.id).where(User.id.in_(wanted), User.status == UserStatus.APPROVED))).all()) if wanted else set()
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
    if payload.approve:
        await approve(db, item)
    else:
        if item.status != ReservationStatus.PENDING:
            raise HTTPException(409, "대기 예약만 거절할 수 있습니다.")
        item.status, item.rejection_reason = ReservationStatus.REJECTED, payload.reason
        await db.commit()
    return {"ok": True}


@router.post("/reservations/{reservation_id}/cancel")
async def reservation_cancel(reservation_id: UUID, payload: ReservationDecision | None = None, _: User = Depends(require_permission("reservations:manage")), db: AsyncSession = Depends(get_db)):
    """Withdraw an already approved reservation and free its slots again."""
    item = await db.get(Reservation, reservation_id)
    if not item:
        raise HTTPException(404, "예약을 찾을 수 없습니다.")
    await cancel(db, item, payload.reason if payload else None)
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
    user.status = payload.status
    await db.commit()
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
    if not existing:
        db.add(UserLicense(user_id=user_id, license_id=payload.license_id))
        await db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/licenses/{license_id}", status_code=204)
async def revoke_license(user_id: UUID, license_id: UUID, _: User = Depends(require_permission("equipment:manage")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(UserLicense).where(UserLicense.user_id == user_id, UserLicense.license_id == license_id))
    await db.commit()
