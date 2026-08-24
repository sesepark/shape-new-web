import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class UtcDateTime(TypeDecorator):
    """UTC 로만 저장하고 UTC 로만 돌려주는 시각 컬럼.

    Postgres 의 TIMESTAMPTZ 는 시간대를 알아서 맞춰 주지만, 로컬 개발용 SQLite 는
    시간대를 떼어 내고 벽시계 시각만 남긴다. 그래서 서울 시각으로 넣은 시드
    데이터와 UTC 로 들어오는 API 요청이 같은 컬럼에 서로 다른 기준으로 섞이고,
    화면에서 아홉 시간씩 어긋난 시각이 나온다. 저장과 조회 양쪽에서 한 번씩
    UTC 로 맞춰 두면 어느 데이터베이스에서도 같은 값을 읽는다.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, _dialect) -> datetime | None:
        if value is None:
            return None
        return (value if value.tzinfo else value.replace(tzinfo=UTC)).astimezone(UTC)

    def process_result_value(self, value: datetime | None, _dialect) -> datetime | None:
        if value is None:
            return None
        return value if value.tzinfo else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class UserStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    # 보기만 하는 회원. 직전 학기에는 활동했지만 이번 학기에는 활동하지 않는
    # 인원(부원 카드의 '멤버')에게 준다. 로그인해서 공지·자료실·예약 현황을
    # 읽을 수 있고, 글쓰기·댓글·예약 신청은 하지 않는다.
    VIEWER = "VIEWER"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"


class EquipmentStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    MAINTENANCE = "MAINTENANCE"
    INACTIVE = "INACTIVE"


class ReservationStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    IN_USE = "IN_USE"
    COMPLETED = "COMPLETED"


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime(), server_default=func.now(), onupdate=func.now())


class User(Base, Timestamped):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    google_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    image_url: Mapped[str | None] = mapped_column(String(1000))
    # 부원 카드에 보이는 한 줄 소개. 본인만 마이페이지에서 수정합니다.
    introduction: Mapped[str | None] = mapped_column(Text)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus), default=UserStatus.PENDING)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime())


class PermissionGrant(Base, Timestamped):
    __tablename__ = "permission_grants"
    __table_args__ = (UniqueConstraint("user_id", "permission", name="uq_permission_grant"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    permission: Mapped[str] = mapped_column(String(80))


class License(Base, Timestamped):
    __tablename__ = "licenses"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserLicense(Base, Timestamped):
    __tablename__ = "user_licenses"
    __table_args__ = (UniqueConstraint("user_id", "license_id", name="uq_user_license"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    license_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("licenses.id", ondelete="CASCADE"))


class ContentPage(Base, Timestamped):
    __tablename__ = "content_pages"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    content_html: Mapped[str] = mapped_column(Text, default="")
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)


class NewsPost(Base, Timestamped):
    __tablename__ = "news_posts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text)
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    content_html: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="활동")
    cover_image: Mapped[str | None] = mapped_column(String(1000))
    external_url: Mapped[str | None] = mapped_column(String(1000))
    published_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)


class Equipment(Base, Timestamped):
    __tablename__ = "equipment"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[EquipmentStatus] = mapped_column(Enum(EquipmentStatus), default=EquipmentStatus.ACTIVE)
    # 예약 단위는 60분이 기본이다. 30분으로 두면 장비마다 다른 단위가 섞여
    # 시간표가 들쭉날쭉해지고, 실제 사용도 대부분 한 시간 단위로 이뤄진다.
    reservation_unit_minutes: Mapped[int] = mapped_column(Integer, default=60)
    open_hour: Mapped[int] = mapped_column(Integer, default=0)
    close_hour: Mapped[int] = mapped_column(Integer, default=24)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class EquipmentUnit(Base, Timestamped):
    __tablename__ = "equipment_units"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    equipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(80))
    status: Mapped[EquipmentStatus] = mapped_column(Enum(EquipmentStatus), default=EquipmentStatus.ACTIVE)


class EquipmentLicenseRequirement(Base):
    __tablename__ = "equipment_license_requirements"
    __table_args__ = (UniqueConstraint("equipment_id", "license_id", name="uq_equipment_license"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    equipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment.id", ondelete="CASCADE"))
    license_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("licenses.id", ondelete="CASCADE"))


class Reservation(Base, Timestamped):
    __tablename__ = "reservations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    equipment_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment_units.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    starts_at: Mapped[datetime] = mapped_column(UtcDateTime())
    ends_at: Mapped[datetime] = mapped_column(UtcDateTime())
    purpose: Mapped[str] = mapped_column(Text)
    status: Mapped[ReservationStatus] = mapped_column(Enum(ReservationStatus), default=ReservationStatus.PENDING)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    before_photo_url: Mapped[str | None] = mapped_column(String(1000))
    after_photo_url: Mapped[str | None] = mapped_column(String(1000))
    # 시간이 되어 보내는 알림은 한 번만 보내야 합니다. 보낸 시각을 적어 둡니다.
    start_notified_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    before_photo_notified_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    photo_notified_at: Mapped[datetime | None] = mapped_column(UtcDateTime())


class ReservationCompanion(Base):
    """장비 하나를 함께 쓰는 사람.

    신청한 사람은 `Reservation.user_id` 에 그대로 있고, 여기에는 함께 쓰는 사람만
    담습니다. 예약 현황만 보고 실제로 누가 함께 쓰는지 알 수 있어야 사고나 파손이
    있을 때 물어볼 곳이 있습니다.
    """

    __tablename__ = "reservation_companions"
    __table_args__ = (UniqueConstraint("reservation_id", "user_id", name="uq_reservation_companion"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class ReservationSlot(Base):
    __tablename__ = "reservation_slots"
    __table_args__ = (UniqueConstraint("equipment_unit_id", "slot_start", name="uq_reservation_slot"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    equipment_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment_units.id", ondelete="CASCADE"))
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id", ondelete="CASCADE"))
    slot_start: Mapped[datetime] = mapped_column(UtcDateTime())


class RoadmapItem(Base, Timestamped):
    __tablename__ = "roadmap_items"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    starts_at: Mapped[datetime] = mapped_column(UtcDateTime())
    ends_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)


class RoadmapMember(Base, Timestamped):
    """Which members are working on a roadmap project."""

    __tablename__ = "roadmap_members"
    __table_args__ = (UniqueConstraint("roadmap_item_id", "user_id", name="uq_roadmap_member"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    roadmap_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roadmap_items.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class LinkVisibility(str, enum.Enum):
    """바로가기 링크를 누구까지 볼 수 있는지.

    `is_published` 와는 다른 축이다. `is_published` 는 '내보냈는가'(임시 저장이면
    운영진 관리 화면에만 남는다)이고, 이 값은 '내보낸 것을 누가 보는가'다. 둘을
    한 칸으로 합치지 않은 이유는, 아직 다듬는 중인 링크를 감춰 두는 일과 다
    만든 링크를 부원에게만 여는 일이 서로 독립이기 때문이다.
    """

    PUBLIC = "PUBLIC"
    # 승인된 회원과 보기 전용 회원(멤버). 자료실의 회원 전용 자료와 같은 기준이다.
    MEMBER = "MEMBER"
    # `links:manage` 권한자와 소유자. 운영진끼리 쓰는 관리 도구 주소를 둔다.
    STAFF = "STAFF"


class RelatedLink(Base, Timestamped):
    __tablename__ = "related_links"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(String(1000))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    visibility: Mapped[LinkVisibility] = mapped_column(
        Enum(LinkVisibility), default=LinkVisibility.PUBLIC, server_default=LinkVisibility.PUBLIC.value
    )


class Notice(Base, Timestamped):
    __tablename__ = "notices"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20), default="일반")
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    content_html: Mapped[str] = mapped_column(Text, default="")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    published_at: Mapped[datetime | None] = mapped_column(UtcDateTime())


class Comment(Base, Timestamped):
    """A board comment. One level of replies via `parent_id`."""

    __tablename__ = "comments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    notice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("notices.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    # 지워도 행은 남긴다. 대댓글이 달린 자리의 맥락이 사라지지 않도록.
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime())


class ShapeUpPost(Base, Timestamped):
    """A SHAPE-UP team's finished work, shown publicly."""

    __tablename__ = "shape_up_posts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    cohort: Mapped[str] = mapped_column(String(20), default="")
    team_name: Mapped[str] = mapped_column(String(120), default="")
    team_members: Mapped[list] = mapped_column(JSON, default=list)
    cover_image: Mapped[str | None] = mapped_column(String(1000))
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    content_html: Mapped[str] = mapped_column(Text, default="")
    github_url: Mapped[str | None] = mapped_column(String(1000))
    video_url: Mapped[str | None] = mapped_column(String(1000))
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)


class Resource(Base, Timestamped):
    """A file or link in the SHAPE 자료실."""

    __tablename__ = "resources"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), default="기타")
    file_url: Mapped[str | None] = mapped_column(String(1000))
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    link_url: Mapped[str | None] = mapped_column(String(1000))
    # 회원 전용 자료는 목록에서 감춥니다.
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)


class Notification(Base, Timestamped):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    notice_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notices.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200))
    # 알림을 눌렀을 때 갈 곳. 게시판 공지는 비워 두고 /notices 로 갑니다.
    # 예약 신청처럼 다른 화면으로 가야 하는 알림만 채웁니다.
    url: Mapped[str | None] = mapped_column(String(300))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


class PushSubscription(Base, Timestamped):
    __tablename__ = "push_subscriptions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    subscription_keys: Mapped[dict] = mapped_column(JSON)
