import enum
import uuid
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
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

SEOUL = ZoneInfo("Asia/Seoul")


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
    # 아무도 손대지 않은 채 사용 시간이 다 지나간 신청. `CANCELLED` 로 뭉뚱그리면
    # '사람이 물린 것' 과 '그냥 지나간 것' 이 관리자 목록에서 구분되지 않는다.
    EXPIRED = "EXPIRED"


class ReservationPurpose(str, enum.Enum):
    """무엇 때문에 장비를 쓰는가.

    같은 시간에 신청이 겹쳤을 때 운영진이 무엇을 먼저 봐야 하는지 정하는 축이다.
    자유서술 한 줄만으로는 대회 마감 때문에 오늘 꼭 써야 하는 신청과 다음 주에
    해도 되는 연습이 똑같아 보였다.

    한글이 아니라 영문 멤버로 두는 이유는 `LinkVisibility` 와 같다 — 정렬과 점수
    계산을 서버가 하므로 순서가 로케일에 흔들리면 안 된다. 화면 글자는 UI 가 붙인다.
    """

    CONTEST = "CONTEST"      # 대회
    SHAPE_UP = "SHAPE_UP"    # SHAPE-UP
    EDUCATION = "EDUCATION"  # 교육
    OTHER = "OTHER"          # 기타


class ReservationUrgency(str, enum.Enum):
    """얼마나 급한가. 신청한 사람이 스스로 고른다."""

    HIGH = "HIGH"      # 매우 시급
    NORMAL = "NORMAL"  # 보통
    LOW = "LOW"        # 낮음


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
    # 덧붙이는 말. 예전 이름은 `purpose` 였고 '사용 목적 및 작업 내용' 을 받았다.
    # 이제 목적은 아래 `purpose_category` 가 맡고, 이 칸은 '왜 하필 이 시간이어야
    # 하는가' 를 적는 자리다. 시간이 겹쳤을 때 운영진이 실제로 읽는 곳이라,
    # 신청 화면에서도 그렇게 안내한다.
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    purpose_category: Mapped[ReservationPurpose] = mapped_column(
        Enum(ReservationPurpose), default=ReservationPurpose.OTHER, server_default=ReservationPurpose.OTHER.value
    )
    urgency: Mapped[ReservationUrgency] = mapped_column(
        Enum(ReservationUrgency), default=ReservationUrgency.NORMAL, server_default=ReservationUrgency.NORMAL.value
    )
    status: Mapped[ReservationStatus] = mapped_column(Enum(ReservationStatus), default=ReservationStatus.PENDING)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    before_photo_url: Mapped[str | None] = mapped_column(String(1000))
    after_photo_url: Mapped[str | None] = mapped_column(String(1000))
    # 시간이 되어 보내는 알림은 한 번만 보내야 합니다. 보낸 시각을 적어 둡니다.
    start_notified_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    before_photo_notified_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    photo_notified_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    # 운영진에게 "아직 안 보셨습니다" 를 한 번만 보내기 위한 자국.
    staff_reminded_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    # 사람이 아니라 시계가 결정한 예약(자동 확정·자동 만료). 승인·취소 화면에
    # 누른 사람 이름이 없는 이유를 남긴다.
    auto_decided_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    # 정기 예약으로 한꺼번에 만들어진 묶음. 학기 하나를 통째로 물릴 때 쓴다.
    recurrence_group_id: Mapped[uuid.UUID | None] = mapped_column(index=True)

    @property
    def audit_label(self) -> str:
        """수정 내역에 남길 이름.

        예약에는 제목이 없다. 예전에는 '사용 목적' 자유서술을 그대로 썼는데, 그
        칸이 선택 입력이 되면서 비어 있는 예약이 생긴다. 비면 수정 내역에
        "무엇을 승인했는지" 가 사라지므로, 그때는 시각으로 이름을 만든다.
        """
        if self.note and self.note.strip():
            return self.note.strip()
        when = self.starts_at
        if when is None:
            return "예약"
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        return when.astimezone(SEOUL).strftime("%m월 %d일 %H:%M 예약")


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


class ReservationBlackout(Base, Timestamped):
    """운영진이 막아 둔 시간. 부원은 이 시간에 예약을 넣을 수 없습니다.

    지금까지 시간을 막는 방법은 장비 **전체**를 `MAINTENANCE` 로 돌리는 것뿐이었고,
    그러면 정비가 잡힌 목요일 저녁 때문에 나머지 엿새까지 함께 닫혔습니다. 목요일
    저녁 교육 실습 같은 고정 일정은 장비 설명에 "그 시간대 개인 예약은 피해 주세요"
    라고 **글로만** 적혀 있어서, 실제로 막아 주는 것은 아무것도 없었습니다.

    ## 모양이 하나뿐인 이유

    한 번만 막는 것과 매주 막는 것을 따로 두지 않고 **요일 집합 + 시각 범위 + 날짜
    범위** 하나로 적습니다. 9월 3일 하루만 막는 것은 `from_date == until_date` 이고
    요일이 그 하루뿐인 경우이며, 사흘 내리 막는 것은 요일 일곱 개를 모두 고르고
    시각을 0~24시로 두는 경우입니다. 규칙이 한 모양이면 겹침을 따지는 코드도,
    관리자 화면도 하나뿐이고, 바로 위에 있는 정기 예약 입력과 생김새가 같아집니다.

    시각은 **한국 시각 자정에서부터 잰 분**입니다(`start_minute`, `end_minute`).
    UTC 로 저장하면 날짜 경계가 아홉 시간 밀려 "목요일 19시" 가 수요일로 넘어갑니다.
    """

    __tablename__ = "reservation_blackouts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    equipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment.id", ondelete="CASCADE"), index=True)
    # 비어 있으면 그 장비의 **모든 호기**를 막습니다. 카메라 7호기처럼 호기가 많은
    # 장비에서 하나만 정비하는 경우가 있어 호기를 지정할 수 있게 둡니다.
    equipment_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("equipment_units.id", ondelete="CASCADE"), index=True
    )
    reason: Mapped[str] = mapped_column(String(200), default="")
    # 0=월요일. 파이썬 `date.weekday()` 와 같은 기준입니다.
    weekdays: Mapped[list] = mapped_column(JSON, default=list)
    start_minute: Mapped[int] = mapped_column(Integer, default=0)
    # 하루를 통째로 막으면 1440 입니다. 자정을 넘겨 이어지는 구간은 만들지 않습니다
    # — 다음 날 00:00 부터 다시 막으면 되고, 그편이 화면에서도 읽힙니다.
    end_minute: Mapped[int] = mapped_column(Integer, default=1440)
    from_date: Mapped[date] = mapped_column(Date)
    until_date: Mapped[date] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    @property
    def audit_label(self) -> str:
        """수정 내역에 남길 이름. 사유가 비어 있으면 기간으로 대신합니다."""
        if self.reason and self.reason.strip():
            return self.reason.strip()
        return f"{self.from_date} ~ {self.until_date} 사용 제한"


class ReservationPolicy(Base, Timestamped):
    """예약이 굴러가는 시각과 상한. **행이 하나뿐인 표**입니다.

    여기 있는 값은 모두 예전에 파이썬 상수였습니다. 그래서 자동 확정을 한 시간에서
    두 시간으로 바꾸는 일에도 코드 수정과 배포가 필요했고, 실제로 운영을 맡은
    사람이 스스로 조절할 수 없었습니다.

    행이 하나뿐이므로 `id` 를 정수 1 로 고정합니다. UUID 를 쓰면 "어느 행이
    진짜인가" 를 매번 정해야 하는데, 설정은 하나여야 뜻이 분명합니다. 값을 읽는
    곳이 예약 창구마다 있으므로 `services/reservation_policy.py` 가 잠깐 들고
    있습니다 — 신청 한 번에 Neon 을 한 번 더 두드리지 않기 위해서입니다.
    """

    __tablename__ = "reservation_policy"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # 시작까지 이만큼 남으면 겹치는 신청이 없는 한 시계가 대신 확정합니다.
    auto_approve_minutes: Mapped[int] = mapped_column(Integer, default=60, server_default="60")
    # 시작이 이만큼 앞인데 아직 대기 중이면 운영진에게 한 번 더 알립니다.
    staff_reminder_minutes: Mapped[int] = mapped_column(Integer, default=120, server_default="120")
    # 예약 시작 이만큼 전부터 '사용 시작' 을 누를 수 있습니다.
    start_grace_minutes: Mapped[int] = mapped_column(Integer, default=10, server_default="10")
    # 사용 시작 뒤 이만큼 지나도 사용 전 사진이 없으면 한 번 더 재촉합니다.
    before_photo_grace_minutes: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    # 한 건에 잡을 수 있는 최대 길이.
    max_hours: Mapped[int] = mapped_column(Integer, default=12, server_default="12")
    # 오늘부터 며칠 앞까지 신청할 수 있는지.
    booking_window_days: Mapped[int] = mapped_column(Integer, default=180, server_default="180")
    # 정기 예약을 한 번에 몇 건까지 만들 수 있는지.
    recurring_max: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    @property
    def audit_label(self) -> str:
        return "예약 정책"


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


class AuditLog(Base):
    """운영진이 관리자 화면에서 무엇을 고쳤는지 남기는 기록.

    ## 왜 이름을 따로 저장하는가

    `actor_id` 만 두고 읽을 때 회원 표와 이어 붙이면, 회원이 탈퇴하거나 이름을
    바꾼 순간 지난 기록이 함께 바뀝니다. 수정 내역은 **그때 누가 했는지**를 남기는
    것이므로, 그 시점의 이름과 이메일을 그대로 박아 둡니다. `actor_id` 는 같은
    사람의 기록을 모아 보려고 함께 두고, 회원이 지워지면 NULL 이 됩니다.

    ## 지우지 않습니다

    한 줄이 300바이트 남짓입니다. 부원 200명이 하루에 쉰 번을 고쳐도 1년에 6MB
    정도라 Neon 무료 저장 0.5GB 안에서 몇 해를 버팁니다. 화면은 이어받기로 끊어
    읽으므로 쌓여도 응답이 무거워지지 않습니다.
    """

    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=lambda: datetime.now(UTC), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    # 그때의 이름과 이메일. 회원이 바뀌어도 기록은 그대로여야 합니다.
    actor_name: Mapped[str] = mapped_column(String(120), default="")
    actor_email: Mapped[str] = mapped_column(String(320), default="")
    # 무엇을 했는가 (만듦·고침·지움·순서·결정·권한 …). 화면이 한글로 옮깁니다.
    action: Mapped[str] = mapped_column(String(20), default="update")
    # 어디를 (소식·공지·장비·로드맵 …)
    area: Mapped[str] = mapped_column(String(40), default="")
    # 무엇을 — 사람이 읽는 이름. 지운 것도 이름이 남도록 지우기 전에 담습니다.
    target: Mapped[str] = mapped_column(String(200), default="")
    # 덧붙일 말 (승인/반려 사유, 바뀐 권한 이름 따위)
    detail: Mapped[str] = mapped_column(String(400), default="")
    # 어느 창구였는지. 화면에는 안 보이지만 나중에 원인을 찾을 때 씁니다.
    method: Mapped[str] = mapped_column(String(10), default="")
    path: Mapped[str] = mapped_column(String(300), default="")
