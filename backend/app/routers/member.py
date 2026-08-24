from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import (
    Comment,
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentUnit,
    License,
    Notice,
    Notification,
    PushSubscription,
    Reservation,
    ReservationStatus,
    Resource,
    RoadmapItem,
    RoadmapMember,
    ShapeUpPost,
    User,
    UserLicense,
    UserStatus,
)
from app.schemas import (
    CommentRead,
    CommentWrite,
    MemberNoticeWrite,
    MemberPick,
    NoticeDetailRead,
    NoticeRead,
    NotificationRead,
    PushSubscriptionWrite,
    ReservationCalendarItem,
    ReservationCreate,
    ReservationPhotoWrite,
    ReservationRead,
    ResourceRead,
    ResourceWrite,
    RoadmapRead,
    ShapeUpDetailRead,
    ShapeUpRead,
    ShapeUpWrite,
)
from app.security import (
    READING_STATUSES,
    approved_user,
    current_user,
    has_permission,
    optional_user,
    reading_user,
)
from app.services import cloudinary
from app.services.content import sanitize_html
from app.services.notifications import deliver_push, publish_notice_notifications, publish_owner_notifications
from app.services.reservation_alerts import tell_user
from app.services.reservations import cancel, companion_names, create_pending, read_models
from app.services.revalidate import refresh

router = APIRouter(tags=["member"])
SEOUL = ZoneInfo("Asia/Seoul")


def as_utc(value: datetime) -> datetime:
    """저장된 시각을 항상 UTC 기준으로 비교한다(로컬 SQLite 는 시간대를 잃는다)."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


@router.get("/equipment-permissions")
async def equipment_permissions(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """All equipment is returned so members can see both granted and missing access."""
    items = (await db.scalars(select(Equipment).order_by(Equipment.sort_order, Equipment.name))).all()
    if not items:
        return []
    owned = set((await db.scalars(select(UserLicense.license_id).where(UserLicense.user_id == user.id))).all())
    # 공개 장비 목록과 같은 이유로 이 장비들의 요구 교육만 읽는다.
    requirements = (await db.execute(
        select(EquipmentLicenseRequirement.equipment_id, EquipmentLicenseRequirement.license_id, License.name)
        .join(License, License.id == EquipmentLicenseRequirement.license_id)
        .where(EquipmentLicenseRequirement.equipment_id.in_([item.id for item in items]))
    )).all()
    result = []
    for item in items:
        needed = [row for row in requirements if row[0] == item.id]
        missing = [row[2] for row in needed if row[1] not in owned]
        result.append({
            "equipmentId": item.id,
            "name": item.name,
            "status": item.status.value,
            "requiredLicenses": [row[2] for row in needed],
            # 이수하지 않은 교육과 장비 상태를 나눠서 돌려준다. 둘을 합쳐 버리면
            # 점검 중인 장비가 "교육 미이수"처럼 보인다.
            "missingLicenses": missing,
            "licensed": not missing,
            "eligible": item.status.value == "ACTIVE" and not missing,
        })
    return result


async def notice_reads(db: AsyncSession, notices: list[Notice], model=NoticeRead, **extra):
    """Attach the author's name and the comment count each row needs."""
    if not notices:
        return []
    authors = {
        user.id: user.name
        for user in (await db.scalars(select(User).where(User.id.in_({item.author_id for item in notices if item.author_id})))).all()
    } if any(item.author_id for item in notices) else {}
    counts = dict((await db.execute(
        select(Comment.notice_id, func.count())
        .where(Comment.notice_id.in_([item.id for item in notices]), Comment.deleted_at.is_(None))
        .group_by(Comment.notice_id)
    )).all())
    return [
        model(
            **model.model_validate(item).model_dump(exclude={"author_name", "comment_count", "can_edit"}),
            author_name=authors.get(item.author_id, "운영진"),
            comment_count=counts.get(item.id, 0),
            **({"can_edit": extra["editor"](item)} if "editor" in extra else {}),
        )
        for item in notices
    ]


# 게시판 목록에 한 번에 실어 보내는 글 수. 글이 쌓여도 응답 크기가 함께
# 자라지 않도록 막아 두는 자리다. 넘치는 글은 `before` 로 이어 받는다.
NOTICE_PAGE = 30


@router.get("/notices", response_model=list[NoticeRead])
async def notices(
    _: User = Depends(reading_user),
    db: AsyncSession = Depends(get_db),
    before: datetime | None = Query(default=None, description="이 시각보다 앞선 글부터 이어 받습니다."),
    limit: int = Query(default=NOTICE_PAGE, ge=1, le=NOTICE_PAGE),
):
    """게시판 목록.

    예전에는 게시된 글을 **전부** 본문까지 담아 보냈습니다. 회원 전용이라 공유
    캐시도 태울 수 없어서, 글이 쌓일수록 목록을 여는 사람마다 그만큼 무거운
    응답이 나갔습니다. 지금은 한 번에 30개까지, 본문은 빼고 보냅니다.
    """
    query = select(Notice).where(Notice.is_published.is_(True))
    if before is not None:
        query = query.where(Notice.published_at < before)
    items = (await db.scalars(
        query.order_by(Notice.is_pinned.desc(), Notice.published_at.desc()).limit(limit)
    )).all()
    return await notice_reads(db, list(items))


@router.get("/notices/{notice_id}", response_model=NoticeDetailRead)
async def notice_detail(notice_id: UUID, user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    item = await db.get(Notice, notice_id)
    if not item or not item.is_published:
        raise HTTPException(404, "글을 찾을 수 없습니다.")
    manager = await has_permission(db, user, "notices:manage")
    reads = await notice_reads(db, [item], model=NoticeDetailRead, editor=lambda row: manager or row.author_id == user.id)
    return reads[0]


@router.post("/notices", response_model=NoticeDetailRead, status_code=201)
async def write_notice(payload: MemberNoticeWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    """Any approved member may post; only board managers may use 공지 or pin."""
    manager = await has_permission(db, user, "notices:manage")
    if not manager and (payload.category == "공지" or payload.is_pinned):
        raise HTTPException(403, "공지 등록과 상단 고정은 게시판 관리 권한이 필요합니다.")
    item = Notice(
        author_id=user.id, title=payload.title, category=payload.category,
        content_json=payload.content_json, content_html=sanitize_html(payload.content_html),
        is_pinned=payload.is_pinned, is_published=True, published_at=datetime.now(UTC),
    )
    db.add(item)
    await db.flush()
    # 알림은 운영진 공지에만 보낸다. 자유 글까지 전체 발송하면 알림이 무의미해진다.
    devices = await publish_notice_notifications(db, item.id, item.title) if payload.category == "공지" else []
    await db.commit()
    await deliver_push(devices, item.title)
    reads = await notice_reads(db, [item], model=NoticeDetailRead, editor=lambda _: True)
    return reads[0]


async def own_notice(db: AsyncSession, notice_id: UUID, user: User) -> Notice:
    item = await db.get(Notice, notice_id)
    if not item:
        raise HTTPException(404, "글을 찾을 수 없습니다.")
    if item.author_id != user.id and not await has_permission(db, user, "notices:manage"):
        raise HTTPException(403, "본인이 쓴 글만 수정하거나 삭제할 수 있습니다.")
    return item


@router.patch("/notices/{notice_id}", response_model=NoticeDetailRead)
async def edit_notice(notice_id: UUID, payload: MemberNoticeWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = await own_notice(db, notice_id, user)
    manager = await has_permission(db, user, "notices:manage")
    if not manager and (payload.category == "공지" or payload.is_pinned):
        raise HTTPException(403, "공지 등록과 상단 고정은 게시판 관리 권한이 필요합니다.")
    item.title, item.category = payload.title, payload.category
    item.content_json, item.content_html = payload.content_json, sanitize_html(payload.content_html)
    item.is_pinned = payload.is_pinned
    await db.commit()
    reads = await notice_reads(db, [item], model=NoticeDetailRead, editor=lambda _: True)
    return reads[0]


@router.delete("/notices/{notice_id}", status_code=204)
async def remove_notice(notice_id: UUID, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = await own_notice(db, notice_id, user)
    await db.delete(item)
    await db.commit()


@router.get("/notices/{notice_id}/comments", response_model=list[CommentRead])
async def list_comments(notice_id: UUID, user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Comment).where(Comment.notice_id == notice_id).order_by(Comment.created_at))).all()
    names = {
        person.id: person.name
        for person in (await db.scalars(select(User).where(User.id.in_({row.user_id for row in rows if row.user_id})))).all()
    } if rows else {}
    manager = await has_permission(db, user, "notices:manage")
    return [
        CommentRead(
            id=row.id, parent_id=row.parent_id,
            body="삭제된 댓글입니다." if row.deleted_at else row.body,
            author_name="" if row.deleted_at else names.get(row.user_id, "탈퇴한 회원"),
            author_id=None if row.deleted_at else row.user_id,
            created_at=row.created_at, is_deleted=row.deleted_at is not None,
            can_delete=not row.deleted_at and (manager or row.user_id == user.id),
        )
        for row in rows
    ]


@router.post("/notices/{notice_id}/comments", response_model=CommentRead, status_code=201)
async def write_comment(notice_id: UUID, payload: CommentWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    notice = await db.get(Notice, notice_id)
    if not notice or not notice.is_published:
        raise HTTPException(404, "글을 찾을 수 없습니다.")
    parent_id = None
    if payload.parent_id:
        parent = await db.get(Comment, payload.parent_id)
        if not parent or parent.notice_id != notice_id:
            raise HTTPException(404, "답글을 달 댓글을 찾을 수 없습니다.")
        # 답글의 답글은 원 댓글에 붙여 한 단계로 유지한다.
        parent_id = parent.parent_id or parent.id
    comment = Comment(notice_id=notice_id, parent_id=parent_id, user_id=user.id, body=payload.body.strip())
    db.add(comment)
    await db.commit(); await db.refresh(comment)
    return CommentRead(
        id=comment.id, parent_id=comment.parent_id, body=comment.body, author_name=user.name,
        author_id=user.id, created_at=comment.created_at, is_deleted=False, can_delete=True,
    )


@router.delete("/comments/{comment_id}", status_code=204)
async def remove_comment(comment_id: UUID, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    comment = await db.get(Comment, comment_id)
    if not comment or comment.deleted_at:
        raise HTTPException(404, "댓글을 찾을 수 없습니다.")
    if comment.user_id != user.id and not await has_permission(db, user, "notices:manage"):
        raise HTTPException(403, "본인이 쓴 댓글만 삭제할 수 있습니다.")
    comment.deleted_at = datetime.now(UTC)
    await db.commit()


@router.get("/notifications", response_model=list[NotificationRead])
async def notifications(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(50))).all()


@router.post("/notifications/read", status_code=204)
async def read_notifications(user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False)).values(is_read=True))
    await db.commit()


@router.get("/roadmap/me", response_model=list[RoadmapRead])
async def my_roadmap(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """Roadmap projects this member was assigned to, newest deadline last."""
    return (await db.scalars(
        select(RoadmapItem)
        .join(RoadmapMember, RoadmapMember.roadmap_item_id == RoadmapItem.id)
        .where(RoadmapMember.user_id == user.id)
        .order_by(RoadmapItem.starts_at)
    )).all()


@router.get("/reservations/me", response_model=list[ReservationRead])
async def my_reservations(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    items = (await db.scalars(select(Reservation).where(Reservation.user_id == user.id).order_by(Reservation.starts_at.desc()))).all()
    return await read_models(db, items)


# 확정된 예약과, 겹침을 미리 피할 수 있도록 승인 대기 중인 신청까지 보여준다.
CALENDAR_STATUSES = (
    ReservationStatus.PENDING, ReservationStatus.APPROVED,
    ReservationStatus.IN_USE, ReservationStatus.COMPLETED,
)


@router.get("/members/directory", response_model=list[MemberPick])
async def member_directory(_: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """장비를 함께 쓸 사람을 고를 때 쓰는 회원 목록.

    **로그인한 회원에게만** 보입니다. 이름과 사진만 담고 이메일은 넣지 않습니다 —
    누구를 고를지 알아보는 데 필요한 만큼만입니다. 공개 부원 페이지의
    `/member-profiles` 는 카드에 연결된 사람만 나오므로, 이제 막 가입해 카드가
    없는 회원을 고를 수 없어 이 창구를 따로 둡니다.
    """
    people = (await db.scalars(
        select(User).where(User.status.in_(READING_STATUSES), User.deleted_at.is_(None)).order_by(User.name)
    )).all()
    return [MemberPick(id=person.id, name=person.name, image_url=person.image_url) for person in people]


@router.get("/reservations/calendar", response_model=list[ReservationCalendarItem])
async def reservation_calendar(
    month: str = Query(pattern=r"^\d{4}-\d{2}$", description="조회할 달 (YYYY-MM)"),
    _: User = Depends(reading_user),
    db: AsyncSession = Depends(get_db),
):
    """Every equipment booking in one month, for the 예약 현황 calendar."""
    year, number = (int(part) for part in month.split("-"))
    if not 1 <= number <= 12:
        raise HTTPException(422, "조회할 달이 올바르지 않습니다.")
    start = datetime(year, number, 1, tzinfo=SEOUL)
    end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=SEOUL)
    items = (await db.scalars(
        select(Reservation)
        .where(Reservation.status.in_(CALENDAR_STATUSES), Reservation.starts_at < end, Reservation.ends_at > start)
        .order_by(Reservation.starts_at)
    )).all()
    if not items:
        return []
    context = (await db.execute(
        select(EquipmentUnit.id, EquipmentUnit.label, Equipment.name)
        .join(Equipment, Equipment.id == EquipmentUnit.equipment_id)
        .where(EquipmentUnit.id.in_({item.equipment_unit_id for item in items}))
    )).all()
    units = {row[0]: (row[1], row[2]) for row in context}
    people = {
        person.id: person.name
        for person in (await db.scalars(select(User).where(User.id.in_({item.user_id for item in items})))).all()
    }
    together = await companion_names(db, items)
    return [
        ReservationCalendarItem(
            id=item.id,
            user_id=item.user_id,
            equipment_name=units.get(item.equipment_unit_id, ("", ""))[1],
            unit_label=units.get(item.equipment_unit_id, ("", ""))[0],
            user_name=people.get(item.user_id, "회원"), purpose=item.purpose,
            starts_at=item.starts_at, ends_at=item.ends_at, status=item.status,
            before_photo_url=item.before_photo_url, after_photo_url=item.after_photo_url,
            companions=together.get(item.id, []),
        )
        for item in items
    ]


@router.post("/reservations", response_model=ReservationRead, status_code=201)
async def request_reservation(payload: ReservationCreate, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    """장비 예약을 신청합니다.

    신청은 운영진이 승인해야 진행되므로, 신청이 들어오면 운영진에게 알립니다.
    예전에는 아무 표시가 없어서 관리자 화면을 직접 열어 보기 전에는 기다리는
    신청이 있는지 알 수 없었습니다.
    """
    reservation, created = await create_pending(db, user.id, payload)
    read = (await read_models(db, [reservation]))[0]
    if not created:
        return read
    when = reservation.starts_at.astimezone(SEOUL).strftime("%m월 %d일 %H:%M")
    title = f"새 예약 신청 · {read.equipment_name} {read.unit_label} · {when}"
    devices = await publish_owner_notifications(db, title, "/admin")

    # 함께 쓰기로 이름이 올라간 사람에게도 알립니다. 모르는 사이에 이름이 올라가
    # 있으면 곤란하고, 시간에 맞춰 와야 하는 사람이기도 합니다.
    together = payload.companion_ids or []
    mate_devices: list[dict] = []
    mate_title = f"함께 쓰는 예약에 이름이 올라갔습니다 · {read.equipment_name} {read.unit_label} · {when}"
    for mate in {companion for companion in together if companion != user.id}:
        mate_devices += await tell_user(db, mate, mate_title)

    await db.commit()
    # 푸시는 저장이 끝난 뒤에 보냅니다. 저장이 실패했는데 알림만 가는 일을 막습니다.
    await deliver_push(devices, title, body=f"{user.name} 님이 예약을 신청했습니다. 승인해 주세요.", path="/admin")
    if mate_devices:
        await deliver_push(mate_devices, mate_title, body=f"{user.name} 님이 신청했습니다.", path="/mypage")
    return read


async def owned_reservation(db: AsyncSession, reservation_id: UUID, user: User) -> Reservation:
    reservation = await db.get(Reservation, reservation_id)
    if not reservation or reservation.user_id != user.id:
        raise HTTPException(404, "예약을 찾을 수 없습니다.")
    return reservation


# 예약 시각보다 한참 앞서 "사용 중"으로 바꿔 버리면 예약 현황이 실제 장비 상태와
# 어긋나므로, 시작 직전부터만 사용을 시작할 수 있게 한다. 늦게 온 경우는 막지 않는다.
START_GRACE = timedelta(minutes=10)


@router.post("/reservations/{reservation_id}/before", response_model=ReservationRead)
async def start_reservation(reservation_id: UUID, payload: ReservationPhotoWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    reservation = await owned_reservation(db, reservation_id, user)
    if reservation.status != ReservationStatus.APPROVED:
        raise HTTPException(409, "승인된 예약만 시작할 수 있습니다.")
    if as_utc(reservation.starts_at) - START_GRACE > datetime.now(UTC):
        raise HTTPException(409, "예약 시작 10분 전부터 사용을 시작할 수 있습니다.")
    reservation.before_photo_url, reservation.status = payload.photo_url, ReservationStatus.IN_USE
    await db.commit(); await db.refresh(reservation)
    return (await read_models(db, [reservation]))[0]


@router.post("/reservations/{reservation_id}/after", response_model=ReservationRead)
async def complete_reservation(reservation_id: UUID, payload: ReservationPhotoWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    reservation = await owned_reservation(db, reservation_id, user)
    if reservation.status != ReservationStatus.IN_USE:
        raise HTTPException(409, "사용 중인 예약만 완료할 수 있습니다.")
    reservation.after_photo_url, reservation.status = payload.photo_url, ReservationStatus.COMPLETED
    await db.commit(); await db.refresh(reservation)
    return (await read_models(db, [reservation]))[0]


@router.post("/reservations/{reservation_id}/cancel", response_model=ReservationRead)
async def cancel_reservation(reservation_id: UUID, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    reservation = await cancel(db, await owned_reservation(db, reservation_id, user))
    return (await read_models(db, [reservation]))[0]


@router.get("/push/public-key")
async def push_public_key():
    """The browser needs the VAPID public key before it can create a subscription."""
    return {"publicKey": get_settings().vapid_public_key or ""}


@router.post("/push-subscriptions", status_code=201)
async def subscribe_push(payload: PushSubscriptionWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    subscription = await db.scalar(select(PushSubscription).where(PushSubscription.endpoint == str(payload.endpoint)))
    if subscription:
        subscription.user_id, subscription.subscription_keys = user.id, payload.keys
    else:
        db.add(PushSubscription(user_id=user.id, endpoint=str(payload.endpoint), subscription_keys=payload.keys))
    await db.commit()
    return {"ok": True}


@router.delete("/push-subscriptions", status_code=204)
async def unsubscribe_push(endpoint: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    subscription = await db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint, PushSubscription.user_id == user.id))
    if subscription:
        await db.delete(subscription)
        await db.commit()


# ------------------------------------------------------------------ 자료실


async def resource_reads(db: AsyncSession, rows, viewer: User | None, manager: bool) -> list[ResourceRead]:
    names = {
        person.id: person.name
        for person in (await db.scalars(select(User).where(User.id.in_({row.author_id for row in rows if row.author_id})))).all()
    } if rows else {}
    return [
        ResourceRead(
            **ResourceRead.model_validate(row).model_dump(exclude={"author_name", "can_edit"}),
            author_name=names.get(row.author_id, "운영진"),
            can_edit=bool(viewer and (manager or row.author_id == viewer.id)),
        )
        for row in rows
    ]


# 자료실은 기수가 바뀔 때마다 쌓이기만 하는 표다. 게시판에 이미 넣은 것과 같은
# 방식으로 한 번에 받는 양을 끊고, 더 보려면 마지막 글의 시각으로 이어받는다.
RESOURCE_PAGE = 40


@router.get("/resources", response_model=list[ResourceRead])
async def list_resources(
    viewer: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
    before: datetime | None = Query(default=None, description="이 시각보다 앞선 자료부터 이어 받습니다."),
    limit: int = Query(default=RESOURCE_PAGE, ge=1, le=RESOURCE_PAGE),
):
    """Public entries for everyone; member-only entries once signed in."""
    # 보기 전용 회원도 회원 전용 자료를 읽는다. 고치는 것은 아래에서 막는다.
    member = bool(viewer and viewer.status in READING_STATUSES)
    query = select(Resource).order_by(Resource.created_at.desc())
    if not member:
        query = query.where(Resource.is_public.is_(True))
    if before is not None:
        query = query.where(Resource.created_at < before)
    rows = list((await db.scalars(query.limit(limit))).all())
    editable = bool(viewer and viewer.status == UserStatus.APPROVED)
    manager = bool(editable and await has_permission(db, viewer, "content:manage"))
    return await resource_reads(db, rows, viewer if editable else None, manager)


@router.post("/resources", response_model=ResourceRead, status_code=201)
async def add_resource(payload: ResourceWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = Resource(
        author_id=user.id, title=payload.title.strip(), description=payload.description,
        category=payload.category, file_url=payload.file_url, file_name=payload.file_name,
        file_size=payload.file_size, link_url=str(payload.link_url) if payload.link_url else None,
        is_public=payload.is_public,
    )
    db.add(item)
    await db.commit(); await db.refresh(item)
    return (await resource_reads(db, [item], user, True))[0]


async def own_resource(db: AsyncSession, resource_id: UUID, user: User) -> Resource:
    item = await db.get(Resource, resource_id)
    if not item:
        raise HTTPException(404, "자료를 찾을 수 없습니다.")
    if item.author_id != user.id and not await has_permission(db, user, "content:manage"):
        raise HTTPException(403, "본인이 올린 자료만 수정하거나 삭제할 수 있습니다.")
    return item


@router.patch("/resources/{resource_id}", response_model=ResourceRead)
async def edit_resource(resource_id: UUID, payload: ResourceWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = await own_resource(db, resource_id, user)
    # 파일을 갈아 끼웠으면 옛 파일은 아무도 가리키지 않는다. 남겨 두면 저장
    # 용량만 계속 먹으므로 여기서 지운다.
    replaced = item.file_url if item.file_url and item.file_url != payload.file_url else None
    item.title, item.description, item.category = payload.title.strip(), payload.description, payload.category
    item.file_url, item.file_name, item.file_size = payload.file_url, payload.file_name, payload.file_size
    item.link_url = str(payload.link_url) if payload.link_url else None
    item.is_public = payload.is_public
    await db.commit(); await db.refresh(item)
    if replaced:
        await cloudinary.destroy(replaced)
    return (await resource_reads(db, [item], user, True))[0]


@router.delete("/resources/{resource_id}", status_code=204)
async def remove_resource(resource_id: UUID, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = await own_resource(db, resource_id, user)
    # 표에서 지우기 전에 주소를 챙겨 둔다. 파일을 함께 지우지 않으면 Cloudinary
    # 저장 용량이 한 방향으로만 늘어난다(services/cloudinary.py 의 설명 참고).
    stored = item.file_url
    await db.delete(item)
    await db.commit()
    await cloudinary.destroy(stored)


# ---------------------------------------------------------------- SHAPE-UP


async def shape_up_reads(db: AsyncSession, rows, viewer: User | None, manager: bool, model=ShapeUpRead):
    names = {
        person.id: person.name
        for person in (await db.scalars(select(User).where(User.id.in_({row.author_id for row in rows if row.author_id})))).all()
    } if rows else {}
    return [
        model(
            **model.model_validate(row).model_dump(exclude={"author_name", "can_edit"}),
            author_name=names.get(row.author_id, "SHAPE"),
            can_edit=bool(viewer and (manager or row.author_id == viewer.id)),
        )
        for row in rows
    ]


async def shape_up_viewer(db: AsyncSession, viewer: User | None):
    """글을 고칠 수 있는 사람인지 본다. 보기 전용 회원은 읽기만 한다."""
    member = bool(viewer and viewer.status == UserStatus.APPROVED)
    manager = bool(member and await has_permission(db, viewer, "content:manage"))
    return (viewer if member else None), manager


# 기수마다 팀 수만큼 늘어난다. 공개 목록이라 사이트맵과 재검증도 같이 읽는다.
SHAPE_UP_PAGE = 60


@router.get("/shape-up", response_model=list[ShapeUpRead])
async def list_shape_up(
    viewer: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
    before: datetime | None = Query(default=None, description="이 시각보다 앞선 글부터 이어 받습니다."),
    limit: int = Query(default=SHAPE_UP_PAGE, ge=1, le=SHAPE_UP_PAGE),
):
    """Finished team work, open to anyone; writing stays with members."""
    query = select(ShapeUpPost).where(ShapeUpPost.is_published.is_(True))
    if before is not None:
        query = query.where(ShapeUpPost.created_at < before)
    rows = list((await db.scalars(query.order_by(ShapeUpPost.created_at.desc()).limit(limit))).all())
    member, manager = await shape_up_viewer(db, viewer)
    return await shape_up_reads(db, rows, member, manager)


@router.get("/shape-up/{post_id}", response_model=ShapeUpDetailRead)
async def shape_up_detail(post_id: UUID, viewer: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    item = await db.get(ShapeUpPost, post_id)
    if not item or not item.is_published:
        raise HTTPException(404, "결과물을 찾을 수 없습니다.")
    member, manager = await shape_up_viewer(db, viewer)
    return (await shape_up_reads(db, [item], member, manager, model=ShapeUpDetailRead))[0]


def shape_up_payload(payload: ShapeUpWrite) -> dict:
    data = payload.model_dump()
    data["content_html"] = sanitize_html(data.get("content_html", ""))
    data["github_url"] = str(payload.github_url) if payload.github_url else None
    data["video_url"] = str(payload.video_url) if payload.video_url else None
    data["team_members"] = [name.strip() for name in payload.team_members if name.strip()]
    return data


@router.post("/shape-up", response_model=ShapeUpDetailRead, status_code=201)
async def write_shape_up(payload: ShapeUpWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = ShapeUpPost(author_id=user.id, is_published=True, **shape_up_payload(payload))
    db.add(item)
    await db.commit(); await db.refresh(item)
    # 공개 목록은 캐시되므로, 새로 올린 글이 바로 보이도록 새로 고쳐 준다.
    refresh("shape-up", [f"/shape-up/{item.id}"])
    return (await shape_up_reads(db, [item], user, True, model=ShapeUpDetailRead))[0]


async def own_shape_up(db: AsyncSession, post_id: UUID, user: User) -> ShapeUpPost:
    item = await db.get(ShapeUpPost, post_id)
    if not item:
        raise HTTPException(404, "결과물을 찾을 수 없습니다.")
    if item.author_id != user.id and not await has_permission(db, user, "content:manage"):
        raise HTTPException(403, "본인이 올린 결과물만 수정하거나 삭제할 수 있습니다.")
    return item


@router.patch("/shape-up/{post_id}", response_model=ShapeUpDetailRead)
async def edit_shape_up(post_id: UUID, payload: ShapeUpWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = await own_shape_up(db, post_id, user)
    before_cover = item.cover_image
    for key, value in shape_up_payload(payload).items():
        setattr(item, key, value)
    replaced = before_cover if before_cover and before_cover != item.cover_image else None
    await db.commit(); await db.refresh(item)
    refresh("shape-up", [f"/shape-up/{item.id}"])
    if replaced:
        await cloudinary.destroy(replaced)
    return (await shape_up_reads(db, [item], user, True, model=ShapeUpDetailRead))[0]


@router.delete("/shape-up/{post_id}", status_code=204)
async def remove_shape_up(post_id: UUID, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    item = await own_shape_up(db, post_id, user)
    # 본문에 박힌 사진은 여기서 다루지 않는다. 같은 사진이 다른 글에도 붙어 있을
    # 수 있어 모든 글을 훑어 본 뒤 판단해야 하고, 그 일은 정리 스크립트가 한다.
    cover = item.cover_image
    await db.delete(item)
    await db.commit()
    refresh("shape-up", [f"/shape-up/{post_id}"])
    await cloudinary.destroy(cover)
