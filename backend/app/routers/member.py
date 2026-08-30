from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select, update
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
    MyUsage,
    MyUsageEntry,
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
    UnreadCount,
)
from app.security import (
    READING_STATUSES,
    approved_user,
    current_user,
    has_permission,
    optional_user,
    reading_user,
)
from app.services import cloudinary, reservation_policy
from app.services.content import sanitize_html
from app.services.notifications import deliver_push, publish_notice_notifications, publish_owner_notifications
from app.services.reservation_alerts import STAFF_URL, tell_owner, tell_user
from app.services.reservations import (
    PURPOSE_LABEL,
    as_utc,
    cancel,
    companion_names,
    create_pending,
    overlapping_pending,
    publish_to_calendar,
    read_models,
    release_remaining,
    try_auto_approve,
    unit_title,
)
from app.services.revalidate import refresh

router = APIRouter(tags=["member"])
SEOUL = ZoneInfo("Asia/Seoul")


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
    # 분류는 `MemberNoticeWrite` 와 같은 네 가지뿐입니다. 목록에서 거를 때도
    # 같은 잣대를 써야, 없는 분류로 물어 온 요청이 조용히 전체를 돌려주지 않습니다.
    category: str | None = Query(default=None, pattern=r"^(공지|질문|정보|일반)$"),
    keyword: str | None = Query(default=None, max_length=60, alias="q"),
):
    """게시판 목록.

    예전에는 게시된 글을 **전부** 본문까지 담아 보냈습니다. 회원 전용이라 공유
    캐시도 태울 수 없어서, 글이 쌓일수록 목록을 여는 사람마다 그만큼 무거운
    응답이 나갔습니다. 지금은 한 번에 30개까지, 본문은 빼고 보냅니다.
    """
    query = select(Notice).where(Notice.is_published.is_(True))
    if category:
        query = query.where(Notice.category == category)
    if keyword:
        # 제목만 봅니다. 본문까지 훑으면 인덱스를 못 타고 표 전체를 읽습니다.
        # 게시판에서 찾는 것은 대개 제목에 있고, 없으면 분류로 좁히면 됩니다.
        query = query.where(Notice.title.ilike(f"%{keyword.strip()}%"))
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


# 알림 한 쪽에 담는 수. 화면의 `PAGE` 와 같아야 합니다.
NOTIFICATION_PAGE = 50


@router.get("/notifications", response_model=list[NotificationRead])
async def notifications(
    user: User = Depends(reading_user),
    db: AsyncSession = Depends(get_db),
    before: datetime | None = Query(default=None, description="이 시각보다 앞선 알림부터 이어 받습니다."),
    before_id: UUID | None = Query(default=None, alias="beforeId", description="같은 시각일 때 어디까지 받았는지"),
    limit: int = Query(default=NOTIFICATION_PAGE, ge=1, le=NOTIFICATION_PAGE),
):
    """받은 알림 목록.

    예전에는 `limit(50)` 하나뿐이라 51건째부터는 받을 길이 없었습니다. 화면은
    받아 온 만큼을 세어 "알림 50건 전체 보기" 라고 적었으니, 실제로 200건이
    쌓여 있어도 **영영 50이라고 말했습니다.** 이어받기를 두어 '전체 보기' 가
    진짜 전체가 되게 합니다. 안 읽은 수는 아래 `unread_notifications` 가 따로
    셉니다 — 한 쪽 안에서 세면 같은 거짓말이 배지로 옮겨 갑니다.

    ## 시각만으로는 이어받을 수 없습니다

    `created_at` 이 `server_default=func.now()` 인데, Postgres 의 `now()` 는
    **트랜잭션이 시작한 시각**입니다. 공지 하나를 올리면 회원 백 명의 알림이
    한 트랜잭션에서 만들어져 **시각이 모두 같습니다.** 그 상태에서
    `created_at < before` 로 이어받으면 경계에 걸린 같은 시각의 알림이 통째로
    건너뛰어집니다 — 백 명짜리 공지 알림이 한 쪽 경계에 걸리면 그 공지가
    누군가에게는 목록에서 사라집니다.

    그래서 시각과 id 를 짝으로 봅니다. id 는 그 시각 안에서 순서를 갈라 주는
    역할만 하므로 무슨 값이든 상관없고, 정렬도 같은 짝으로 맞춰 둡니다.
    """
    query = select(Notification).where(Notification.user_id == user.id)
    if before is not None:
        # 짝 비교를 `tuple_()` 로 쓰지 않는 이유: 그러면 왼쪽 칼럼의
        # `UtcDateTime` 변환을 타지 않아 시각이 저장된 것과 다른 모양으로
        # 묶입니다(실제로 SQLite 에서 거르개가 통째로 무시됐습니다).
        # 칼럼마다 풀어 쓰면 각자의 타입으로 묶이고, 행 값 비교를 지원하지
        # 않는 데이터베이스에서도 그대로 돕니다.
        query = query.where(
            or_(
                Notification.created_at < before,
                and_(Notification.created_at == before, Notification.id < before_id),
            )
            if before_id is not None
            else Notification.created_at < before
        )
    return (await db.scalars(
        query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
    )).all()


@router.get("/notifications/unread", response_model=UnreadCount)
async def unread_notifications(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """안 읽은 알림 수. 머리글의 배지가 쪽을 옮길 때마다 부릅니다.

    목록을 받아 세지 않고 `COUNT` 로 세는 이유는 두 가지입니다. 세는 값이
    한 쪽에 걸리지 않아야 하고, 배지 하나 때문에 알림 오십 건을 실어 보낼
    이유가 없습니다. `ix_notifications_user_unread` 가 이 질의를 받칩니다.
    """
    total = await db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
    )
    return UnreadCount(unread=int(total or 0))


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


@router.get("/reservations/summary", response_model=MyUsage)
async def my_usage(user: User = Depends(reading_user), db: AsyncSession = Depends(get_db)):
    """내가 장비를 얼마나 썼는지. **내 예약만** 셉니다.

    관리자 사용 통계와 셈법을 같이 씁니다(`admin.reservation_stats`) — 예약 행을
    읽어 파이썬에서 셉니다. 사용 시간 합계는 `ends_at - starts_at` 이라 Postgres 와
    SQLite 의 문법이 갈리고, 한 사람의 예약은 학기를 통틀어도 몇백 건입니다.

    '쓴 시간' 은 **사용을 마친 예약**만 셉니다. 앞으로 잡아 둔 시간은 아직 쓴 것이
    아니고, 반려·취소·만료된 신청은 장비를 한 번도 차지한 적이 없습니다. 조기
    반납으로 줄어든 예약은 줄어든 뒤의 길이로 잡힙니다 — `release_remaining` 이
    `ends_at` 자체를 당겨 두기 때문입니다.
    """
    rows = (await db.execute(
        select(
            Reservation.equipment_unit_id, Reservation.purpose_category, Reservation.status,
            Reservation.starts_at, Reservation.ends_at, Reservation.after_photo_url,
        ).where(Reservation.user_id == user.id)
    )).all()
    if not rows:
        return MyUsage()

    units = {
        row[0]: row[1]
        for row in (await db.execute(
            select(EquipmentUnit.id, Equipment.name)
            .join(Equipment, Equipment.id == EquipmentUnit.equipment_id)
            .where(EquipmentUnit.id.in_({row[0] for row in rows}))
        )).all()
    }

    now = datetime.now(UTC)
    equipment_stats: dict[str, list] = {}
    purpose_stats: dict[str, list] = {}
    total_hours = 0.0
    completed = upcoming = missing_photo = 0
    first_used: datetime | None = None
    last_used: datetime | None = None

    for unit_id, purpose, status, starts_at, ends_at, after_photo in rows:
        begins, finishes = as_utc(starts_at), as_utc(ends_at)
        if status in (ReservationStatus.PENDING, ReservationStatus.APPROVED) and finishes > now:
            upcoming += 1
        # 사용 시간이 끝났는데 사용 후 사진이 없는 예약. 남이 아니라 본인이 볼 수
        # 있어야 챙깁니다 — 지금은 알림 한 번이 지나가면 다시 볼 곳이 없습니다.
        if status in (ReservationStatus.APPROVED, ReservationStatus.IN_USE) and finishes <= now and not after_photo:
            missing_photo += 1
        if status != ReservationStatus.COMPLETED:
            continue
        completed += 1
        hours = max(0.0, (finishes - begins).total_seconds() / 3600)
        total_hours += hours
        first_used = begins if first_used is None or begins < first_used else first_used
        last_used = begins if last_used is None or begins > last_used else last_used
        for bucket, key in ((equipment_stats, units.get(unit_id, "장비")), (purpose_stats, PURPOSE_LABEL.get(purpose, "기타"))):
            entry = bucket.setdefault(key, [0, 0.0])
            entry[0] += 1
            entry[1] += hours

    def listed(bucket: dict) -> list[MyUsageEntry]:
        out = [MyUsageEntry(label=key, count=count, hours=round(hours, 1)) for key, (count, hours) in bucket.items()]
        out.sort(key=lambda entry: entry.hours, reverse=True)
        return out

    return MyUsage(
        total_count=len(rows),
        total_hours=round(total_hours, 1),
        completed_count=completed,
        upcoming_count=upcoming,
        missing_photo_count=missing_photo,
        equipment=listed(equipment_stats),
        purposes=listed(purpose_stats),
        first_used_at=first_used,
        last_used_at=last_used,
    )


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
            user_name=people.get(item.user_id, "회원"),
            purpose_category=item.purpose_category, urgency=item.urgency,
            starts_at=item.starts_at, ends_at=item.ends_at, status=item.status,
            before_photo_url=item.before_photo_url, after_photo_url=item.after_photo_url,
            companions=together.get(item.id, []),
        )
        for item in items
    ]


@router.post("/reservations", response_model=ReservationRead, status_code=201)
async def request_reservation(payload: ReservationCreate, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    """장비 예약을 신청합니다.

    신청이 들어오면 운영진에게 알립니다. 예전에는 아무 표시가 없어서 관리자 화면을
    직접 열어 보기 전에는 기다리는 신청이 있는지 알 수 없었습니다.

    다만 **모든 신청이 사람의 승인을 기다리지는 않습니다.** 시작이 한 시간 안이고
    다투는 신청이 없으면 여기서 곧바로 확정됩니다(`try_auto_approve`). 그래서
    운영진에게 보내는 말도 세 갈래로 갈립니다 — 자동으로 확정됐다, 겹쳐서 사람이
    골라야 한다, 평소처럼 승인해 달라.
    """
    reservation, created, _ = await create_pending(db, user.id, payload)
    if not created:
        return (await read_models(db, [reservation]))[0]

    # 지금 돌고 있는 칸을 장비 앞에서 잡는 경우가 가장 흔한데, 그때 운영진을
    # 기다리게 하면 자동화의 의미가 없다. 시작이 한 시간 안이고 다투는 신청이
    # 없으면 여기서 곧바로 확정된다.
    confirmed = await try_auto_approve(db, reservation)
    read = (await read_models(db, [reservation]))[0]
    when = as_utc(reservation.starts_at).astimezone(SEOUL).strftime("%m월 %d일 %H:%M")
    what = f"{unit_title(read.equipment_name, read.unit_label)} · {when}"

    if confirmed:
        # 이미 확정된 것을 두고 "승인해 주세요" 라고 하면 안 된다. 운영진에게는
        # 무슨 일이 있었는지만 알리고, 신청한 본인에게는 확정을 알린다.
        staff_title = f"예약이 자동으로 확정되었습니다 · {what}"
        staff_body = f"{user.name} 님의 신청입니다. 겹치는 예약이 없어 자동으로 확정했습니다."
    elif await overlapping_pending(db, reservation):
        # 자동 확정이 막히는 유일한 경우이자, 사람이 반드시 개입해야 하는 유일한
        # 경우다. 그래서 접수 알림과 다른 제목으로 따로 알린다.
        staff_title = f"같은 시간에 신청이 겹쳤습니다 · {what}"
        staff_body = f"{user.name} 님의 신청이 다른 신청과 겹칩니다. 누구를 확정할지 정해 주세요."
    else:
        staff_title = f"새 예약 신청 · {what}"
        staff_body = f"{user.name} 님이 예약을 신청했습니다. 승인해 주세요."

    staff_devices = await publish_owner_notifications(db, staff_title, STAFF_URL)

    # 확정되었으면 신청한 본인에게도 남깁니다. 알림 상자에 기록이 남아야 나중에
    # "언제 확정됐지?" 를 화면에서 되짚을 수 있습니다.
    mine = f"예약이 확정되었습니다 · {what}" if confirmed else ""
    mine_devices = await tell_owner(db, reservation, mine) if confirmed else []

    # 함께 쓰기로 이름이 올라간 사람에게도 알립니다. 모르는 사이에 이름이 올라가
    # 있으면 곤란하고, 시간에 맞춰 와야 하는 사람이기도 합니다.
    together = payload.companion_ids or []
    mate_devices: list[dict] = []
    mate_title = f"함께 쓰는 예약에 이름이 올라갔습니다 · {what}"
    for mate in {companion for companion in together if companion != user.id}:
        mate_devices += await tell_user(db, mate, mate_title)

    await db.commit()
    # 푸시는 저장이 끝난 뒤에 보냅니다. 저장이 실패했는데 알림만 가는 일을 막습니다.
    await deliver_push(staff_devices, staff_title, body=staff_body, path=STAFF_URL)
    if mate_devices:
        await deliver_push(mate_devices, mate_title, body=f"{user.name} 님이 신청했습니다.", path="/mypage")
    if mine_devices:
        await deliver_push(mine_devices, mine, body="시간이 되면 사용 전 사진을 올리고 시작해 주세요.", path="/mypage")
    return read


async def owned_reservation(db: AsyncSession, reservation_id: UUID, user: User) -> Reservation:
    reservation = await db.get(Reservation, reservation_id)
    if not reservation or reservation.user_id != user.id:
        raise HTTPException(404, "예약을 찾을 수 없습니다.")
    return reservation


# 예약 시각보다 한참 앞서 "사용 중"으로 바꿔 버리면 예약 현황이 실제 장비 상태와
# 어긋나므로, 시작 직전부터만 사용을 시작할 수 있게 한다. 늦게 온 경우는 막지 않는다.
# 그 '직전' 이 몇 분인지는 관리자 화면에서 정한다(`services/reservation_policy.py`).


@router.post("/reservations/{reservation_id}/before", response_model=ReservationRead)
async def start_reservation(reservation_id: UUID, payload: ReservationPhotoWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    reservation = await owned_reservation(db, reservation_id, user)
    if reservation.status != ReservationStatus.APPROVED:
        raise HTTPException(409, "승인된 예약만 시작할 수 있습니다.")
    grace = (await reservation_policy.current(db)).start_grace
    if as_utc(reservation.starts_at) - grace > datetime.now(UTC):
        raise HTTPException(409, f"예약 시작 {int(grace.total_seconds() // 60)}분 전부터 사용을 시작할 수 있습니다.")
    reservation.before_photo_url, reservation.status = payload.photo_url, ReservationStatus.IN_USE
    await db.commit(); await db.refresh(reservation)
    return (await read_models(db, [reservation]))[0]


@router.post("/reservations/{reservation_id}/after", response_model=ReservationRead)
async def complete_reservation(reservation_id: UUID, payload: ReservationPhotoWrite, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    """사용을 마칩니다. 원하면 남은 시간을 그 자리에서 돌려줍니다.

    예전에는 상태만 `COMPLETED` 로 바뀌고 확정 슬롯은 끝 시각까지 그대로 남았습니다.
    17~19시를 잡고 17시 10분에 끝내도 19시까지 아무도 그 장비를 쓸 수 없었습니다.
    """
    reservation = await owned_reservation(db, reservation_id, user)
    if reservation.status != ReservationStatus.IN_USE:
        raise HTTPException(409, "사용 중인 예약만 완료할 수 있습니다.")
    reservation.after_photo_url, reservation.status = payload.photo_url, ReservationStatus.COMPLETED
    returned = await release_remaining(db, reservation) if payload.release_remaining else None
    await db.commit(); await db.refresh(reservation)
    if returned:
        # 시간이 바뀌었으니 공유 캘린더의 일정도 새 끝 시각으로 맞춥니다. 일정
        # 식별자가 예약 번호에서 나오므로 같은 일정이 갱신됩니다.
        await publish_to_calendar(db, reservation)
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
