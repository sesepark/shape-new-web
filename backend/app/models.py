import enum
import uuid
from datetime import datetime

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


class Base(DeclarativeBase):
    pass


class UserStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


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
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)


class Equipment(Base, Timestamped):
    __tablename__ = "equipment"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[EquipmentStatus] = mapped_column(Enum(EquipmentStatus), default=EquipmentStatus.ACTIVE)
    reservation_unit_minutes: Mapped[int] = mapped_column(Integer, default=30)
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
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    purpose: Mapped[str] = mapped_column(Text)
    status: Mapped[ReservationStatus] = mapped_column(Enum(ReservationStatus), default=ReservationStatus.PENDING)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    before_photo_url: Mapped[str | None] = mapped_column(String(1000))
    after_photo_url: Mapped[str | None] = mapped_column(String(1000))


class ReservationSlot(Base):
    __tablename__ = "reservation_slots"
    __table_args__ = (UniqueConstraint("equipment_unit_id", "slot_start", name="uq_reservation_slot"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    equipment_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment_units.id", ondelete="CASCADE"))
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id", ondelete="CASCADE"))
    slot_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RoadmapItem(Base, Timestamped):
    __tablename__ = "roadmap_items"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)


class RoadmapMember(Base, Timestamped):
    """Which members are working on a roadmap project."""

    __tablename__ = "roadmap_members"
    __table_args__ = (UniqueConstraint("roadmap_item_id", "user_id", name="uq_roadmap_member"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    roadmap_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roadmap_items.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class RelatedLink(Base, Timestamped):
    __tablename__ = "related_links"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(String(1000))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)


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
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Comment(Base, Timestamped):
    """A board comment. One level of replies via `parent_id`."""

    __tablename__ = "comments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    notice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("notices.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    # 지워도 행은 남긴다. 대댓글이 달린 자리의 맥락이 사라지지 않도록.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


class PushSubscription(Base, Timestamped):
    __tablename__ = "push_subscriptions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    subscription_keys: Mapped[dict] = mapped_column(JSON)
