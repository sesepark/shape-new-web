from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from app.models import EquipmentStatus, ReservationStatus, UserStatus

PERMISSIONS = ("content", "news", "equipment", "reservations", "roadmap", "links", "notices")
PERMISSION_PATTERN = rf"^({'|'.join(PERMISSIONS)}):manage$"


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.title() for part in tail)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class InputModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SessionUser(ORMModel):
    id: UUID
    name: str
    email: str
    image_url: str | None = None
    introduction: str | None = None
    status: UserStatus
    is_owner: bool
    permissions: list[str] = []
    licenses: list[str] = []


class ProfileWrite(InputModel):
    name: str = Field(min_length=1, max_length=120)
    image_url: str | None = Field(default=None, max_length=1000)
    introduction: str | None = Field(default=None, max_length=400)


class MemberProject(ORMModel):
    id: UUID
    title: str
    category: str
    starts_at: datetime
    ends_at: datetime | None = None


class MemberProfile(ORMModel):
    """Only what a member chose to show publicly on their 부원 card."""

    id: UUID
    name: str
    image_url: str | None = None
    introduction: str | None = None
    projects: list[MemberProject] = []


class ContentPageRead(ORMModel):
    slug: str
    title: str
    content_json: dict
    content_html: str
    updated_at: datetime


class NewsRead(ORMModel):
    id: UUID
    title: str
    summary: str
    category: str
    cover_image: str | None = None
    external_url: str | None = None
    published_at: datetime


class NewsDetailRead(NewsRead):
    content_html: str
    content_json: dict = Field(default_factory=dict)


class AdminNewsRead(ORMModel):
    id: UUID
    title: str
    summary: str
    category: str
    cover_image: str | None = None
    external_url: str | None = None
    content_html: str = ""
    content_json: dict = Field(default_factory=dict)
    is_published: bool
    published_at: datetime | None = None
    updated_at: datetime


class LinkInspect(InputModel):
    """저장 전에 읽어 볼 외부 링크."""

    url: HttpUrl


class NewsWrite(InputModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=2000)
    category: str = Field(default="활동", max_length=60)
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    cover_image: str | None = None
    external_url: HttpUrl | None = None
    # 소식이 실제로 있었던 날. 관리자 화면에서 고르며, 기본값은 오늘입니다.
    # 언론보도는 원문의 발행일을 읽어 채웁니다. 비워 두면 저장하는 날로 잡습니다.
    published_at: datetime | None = None
    is_published: bool = False


class EquipmentRead(ORMModel):
    id: UUID
    name: str
    category: str
    description: str
    image_url: str | None = None
    status: EquipmentStatus
    reservation_unit_minutes: int
    open_hour: int
    close_hour: int
    required_licenses: list[str] = []
    available_units: int = 0


class AdminEquipmentRead(ORMModel):
    id: UUID
    name: str
    category: str
    description: str
    image_url: str | None = None
    status: EquipmentStatus
    reservation_unit_minutes: int
    sort_order: int
    required_license_ids: list[UUID] = []
    units: list["EquipmentUnitRead"] = []


class EquipmentWrite(InputModel):
    name: str = Field(min_length=1, max_length=160)
    category: str = Field(min_length=1, max_length=80)
    description: str = ""
    image_url: str | None = None
    status: EquipmentStatus = EquipmentStatus.ACTIVE
    reservation_unit_minutes: int = Field(default=30, ge=30, le=120, multiple_of=30)
    sort_order: int = Field(default=0, ge=0, le=999)


class EquipmentUnitRead(ORMModel):
    id: UUID
    equipment_id: UUID
    label: str
    status: EquipmentStatus


class EquipmentUnitWrite(InputModel):
    label: str = Field(min_length=1, max_length=80)
    status: EquipmentStatus = EquipmentStatus.ACTIVE


class EquipmentLicenseWrite(InputModel):
    license_ids: list[UUID] = Field(default_factory=list, max_length=20)


class LicenseRead(ORMModel):
    id: UUID
    name: str
    description: str | None = None
    is_active: bool


class LicenseWrite(InputModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool = True


class LicenseAssignment(InputModel):
    license_id: UUID


class ReservationCreate(InputModel):
    equipment_unit_id: UUID
    starts_at: datetime
    ends_at: datetime
    purpose: str = Field(min_length=3, max_length=2000)

    @field_validator("ends_at")
    @classmethod
    def end_must_be_on_half_hour(cls, value: datetime) -> datetime:
        if value.minute not in {0, 30} or value.second or value.microsecond:
            raise ValueError("예약 시간은 30분 단위여야 합니다.")
        return value


class ReservationRead(ORMModel):
    id: UUID
    equipment_unit_id: UUID
    user_id: UUID
    starts_at: datetime
    ends_at: datetime
    purpose: str
    status: ReservationStatus
    rejection_reason: str | None = None
    before_photo_url: str | None = None
    after_photo_url: str | None = None
    equipment_name: str = ""
    unit_label: str = ""


class AdminReservationRead(ReservationRead):
    user_name: str = ""
    user_email: str = ""
    created_at: datetime | None = None


class ReservationPhotoWrite(InputModel):
    photo_url: str = Field(min_length=1, max_length=1000)


class ReservationDecision(InputModel):
    approve: bool
    reason: str | None = Field(default=None, max_length=1000)


class RoadmapRead(ORMModel):
    id: UUID
    title: str
    category: str
    description: str
    starts_at: datetime
    ends_at: datetime | None = None


class AdminRoadmapRead(RoadmapRead):
    is_published: bool
    member_ids: list[UUID] = []


class RoadmapWrite(InputModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=80)
    description: str = ""
    starts_at: datetime
    ends_at: datetime | None = None
    is_published: bool = False
    member_ids: list[UUID] = Field(default_factory=list, max_length=100)


class DirectoryUser(ORMModel):
    """관리자 화면에서 사람을 고를 때 쓰는 최소한의 정보.

    사진을 함께 내려보내는 이유는, 이름만 늘어놓으면 동명이인이나 비슷한 이름을
    고를 때 이메일을 하나하나 읽어야 하기 때문입니다.
    """

    id: UUID
    name: str
    email: str
    image_url: str | None = None
    status: UserStatus


class LinkRead(ORMModel):
    id: UUID
    title: str
    description: str | None = None
    url: str
    sort_order: int


class AdminLinkRead(LinkRead):
    is_published: bool


class LinkWrite(InputModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    url: HttpUrl
    sort_order: int = Field(default=0, ge=0)
    is_published: bool = True


class NoticeRead(ORMModel):
    id: UUID
    title: str
    category: str
    is_pinned: bool
    published_at: datetime
    content_html: str = ""
    author_name: str = ""
    comment_count: int = 0


class NoticeDetailRead(NoticeRead):
    author_id: UUID | None = None
    can_edit: bool = False


class MemberNoticeWrite(InputModel):
    """A board post written by any approved member."""

    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="일반", pattern=r"^(공지|질문|정보|일반)$")
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    is_pinned: bool = False


class CommentWrite(InputModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: UUID | None = None


class CommentRead(ORMModel):
    id: UUID
    parent_id: UUID | None = None
    body: str
    author_name: str = ""
    author_id: UUID | None = None
    created_at: datetime
    is_deleted: bool = False
    can_delete: bool = False


class ReservationCalendarItem(ORMModel):
    id: UUID
    # 예약 현황 화면에서 "내 예약"을 알아보고 사용 전후 사진을 바로 올리게 합니다.
    user_id: UUID
    equipment_name: str
    unit_label: str
    user_name: str
    purpose: str = ""
    starts_at: datetime
    ends_at: datetime
    status: ReservationStatus
    before_photo_url: str | None = None
    after_photo_url: str | None = None


class AdminNoticeRead(ORMModel):
    id: UUID
    title: str
    category: str
    is_pinned: bool
    is_published: bool
    published_at: datetime | None = None
    content_html: str = ""
    content_json: dict = Field(default_factory=dict)
    updated_at: datetime


class NoticeWrite(InputModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="일반", pattern=r"^(공지|질문|정보|일반)$")
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    is_pinned: bool = False
    is_published: bool = False


class PageWrite(InputModel):
    title: str = Field(min_length=1, max_length=200)
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    is_published: bool = True


RESOURCE_CATEGORIES = ("양식", "교육 자료", "장비 매뉴얼", "발표 자료", "기타")


class ResourceRead(ORMModel):
    id: UUID
    title: str
    description: str
    category: str
    file_url: str | None = None
    file_name: str | None = None
    file_size: int = 0
    link_url: str | None = None
    is_public: bool
    author_name: str = ""
    created_at: datetime
    can_edit: bool = False


class ResourceWrite(InputModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="기타", pattern=rf"^({'|'.join(RESOURCE_CATEGORIES)})$")
    file_url: str | None = Field(default=None, max_length=1000)
    file_name: str | None = Field(default=None, max_length=255)
    file_size: int = Field(default=0, ge=0)
    link_url: HttpUrl | None = None
    is_public: bool = False

    @model_validator(mode="after")
    def needs_something_to_open(self):
        # 필드 검증기는 기본값에는 돌지 않으므로 모델 단계에서 확인합니다.
        if not self.link_url and not self.file_url:
            raise ValueError("파일을 올리거나 링크 주소를 입력해 주세요.")
        return self


class ShapeUpRead(ORMModel):
    id: UUID
    title: str
    summary: str
    cohort: str
    team_name: str
    team_members: list[str] = []
    cover_image: str | None = None
    github_url: str | None = None
    video_url: str | None = None
    author_name: str = ""
    created_at: datetime
    can_edit: bool = False


class ShapeUpDetailRead(ShapeUpRead):
    content_html: str = ""
    content_json: dict = Field(default_factory=dict)


class ShapeUpWrite(InputModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=2000)
    cohort: str = Field(default="", max_length=20)
    team_name: str = Field(default="", max_length=120)
    team_members: list[str] = Field(default_factory=list, max_length=20)
    cover_image: str | None = Field(default=None, max_length=1000)
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    github_url: HttpUrl | None = None
    video_url: HttpUrl | None = None


class NotificationRead(ORMModel):
    id: UUID
    title: str
    is_read: bool
    notice_id: UUID | None = None
    created_at: datetime


class AdminUserRead(ORMModel):
    id: UUID
    name: str
    email: str
    image_url: str | None = None
    status: UserStatus
    is_owner: bool
    created_at: datetime
    permissions: list[str] = []
    license_ids: list[UUID] = []


class UserDecision(InputModel):
    status: UserStatus


class PermissionWrite(InputModel):
    permission: str = Field(pattern=PERMISSION_PATTERN)


class PermissionSetWrite(InputModel):
    """이 회원이 가질 기능 권한 전체. 목록에 없는 권한은 회수됩니다.

    한 칸씩 켜고 끄는 창구를 그대로 두면서 이것을 따로 둔 이유는 '전체 부여'
    입니다. 권한 일곱 개를 한 칸씩 보내면 요청이 일곱 번 나가는데, 분당 쓰기가
    20회로 묶여 있어 두 사람만 연달아 처리해도 한도에 걸립니다.
    """

    permissions: list[str] = Field(default_factory=list, max_length=40)


class LicenseSetWrite(InputModel):
    """이 회원이 이수한 교육 전체. 목록에 없는 교육은 취소됩니다."""

    license_ids: list[UUID] = Field(default_factory=list, max_length=80)


class OwnerWrite(InputModel):
    """owner 로 올리거나 내립니다."""

    is_owner: bool


class PushSubscriptionWrite(InputModel):
    endpoint: HttpUrl
    keys: dict


AdminEquipmentRead.model_rebuild()
