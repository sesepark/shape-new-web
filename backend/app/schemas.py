from datetime import date, datetime
from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from app.models import (
    EquipmentStatus,
    LinkVisibility,
    ReservationPurpose,
    ReservationStatus,
    ReservationUrgency,
    UserStatus,
)
from app.services.content import deliver_smaller

PERMISSIONS = ("content", "news", "equipment", "reservations", "roadmap", "links", "notices", "contact")
PERMISSION_PATTERN = rf"^({'|'.join(PERMISSIONS)}):manage$"


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.title() for part in tail)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class InputModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def only_safe_url(value: str | None) -> str | None:
    """사진·파일 주소로 받아도 되는 형태인지.

    이 칸들은 화면에서 `<img src>` 나 `<a href>` 로 그대로 나갑니다. 그런데 받는
    조건이 **길이뿐**이라 `javascript:` 나 `data:` 로 시작하는 값도 그대로
    저장됐습니다. 지금 쓰는 리액트가 `javascript:` 주소를 막아 주고는 있지만,
    막아 주는 것이 화면 라이브러리 하나뿐인 상태를 안전하다고 부를 수는 없습니다.
    저장하는 자리에서 걸러야 합니다.

    받는 것은 `https://` 로 시작하는 주소와 `/` 로 시작하는 우리 사이트 안의
    경로뿐입니다. 지금 저장되어 있는 값(Cloudinary 주소, 구글 계정 사진, 옛
    사이트에서 옮겨 와 `public/figs/` 에 있는 `/figs/…`)이 모두 여기 들어갑니다.
    `http://` 를 빼는 것은 우리 사이트가 https 라서, 넣어 봐야 브라우저가 막는
    주소이기 때문입니다.
    """
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if trimmed.startswith("https://") or (trimmed.startswith("/") and not trimmed.startswith("//")):
        return trimmed
    raise ValueError("https:// 로 시작하는 주소만 넣을 수 있습니다.")


def must_be_safe_url(value: str) -> str:
    """비워 둘 수 없는 자리(예약 사진)에서 쓰는 같은 검사."""
    checked = only_safe_url(value)
    if not checked:
        raise ValueError("주소가 비어 있습니다.")
    return checked


# 사진·파일 주소 칸. 길이 상한은 쓰는 자리에서 따로 겁니다.
SafeUrl = Annotated[str | None, AfterValidator(only_safe_url)]
RequiredSafeUrl = Annotated[str, AfterValidator(must_be_safe_url)]


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
    image_url: SafeUrl = Field(default=None, max_length=1000)
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


class MemberCardItem(ORMModel):
    """부원 페이지에 놓인 카드 한 장. 마이페이지가 내 카드를 확인할 때 씁니다."""

    id: str
    name: str
    role: str = ""
    membership: str = ""
    image_url: str | None = None


class MemberCardRead(ORMModel):
    """내게 연결된 카드, 이름이 같은 후보, 그리고 아직 비어 있는 카드 전부.

    이름이 다르게 적혀 있으면 후보가 뜨지 않습니다(구글 계정 이름이 영문이거나
    띄어쓰기가 다른 경우). 그때도 본인이 목록에서 직접 고를 수 있도록 비어 있는
    카드를 함께 보냅니다. `my_name` 은 왜 후보가 안 뜨는지 화면에서 알려 주기
    위한 것입니다.
    """

    card: MemberCardItem | None = None
    candidates: list[MemberCardItem] = []
    available: list[MemberCardItem] = []
    my_name: str = ""


class MemberCardClaim(InputModel):
    card_id: str = Field(min_length=1, max_length=120)


# 읽을 때 한 번 더 손보는 본문.
#
# 저장할 때 `sanitize_html` 이 Cloudinary 원본 주소를 변환본 주소로 바꿉니다.
# 다만 그 규칙이 생기기 전에 저장된 글은 여전히 원본을 가리킵니다. 예전 글까지
# DB 를 직접 고치려면 운영 DB 접속이 필요하고, 그 사이에도 글을 여는 사람마다
# 원본이 통째로 나갑니다. 내보낼 때 한 번 더 고치면 저장된 값과 상관없이 항상
# 줄어든 사진이 나갑니다. 문자열 치환이라 값이 싸고, 공개 응답은 어차피 캐시에
# 올라갑니다.
DeliveredHtml = Annotated[str, AfterValidator(deliver_smaller)]



class OrderWrite(InputModel):
    """목록의 새 차례. 받은 순서가 곧 노출 순서가 됩니다."""

    ids: list[UUID] = Field(min_length=1, max_length=200)


class GoogleExchange(InputModel):
    """구글이 돌려준 인가 코드. 화면이 받아 서버로 넘깁니다."""

    code: str = Field(min_length=1, max_length=2048)
    redirect_uri: str = Field(min_length=1, max_length=500)


class ContentPageRead(ORMModel):
    slug: str
    title: str
    content_json: dict
    content_html: DeliveredHtml
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
    content_html: DeliveredHtml
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
    # 이 장비의 확정된 예약이 동아리 공유 구글 캘린더에도 올라가는지.
    # 화면에서 미리 알려 주기 위한 것이라, 연동이 실제로 켜져 있을 때만 참입니다.
    shared_calendar: bool = False


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
    reservation_unit_minutes: int = Field(default=60, ge=30, le=120, multiple_of=30)
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
    # 세 칸 모두 기본값을 둡니다. 필수로 만들면 이 스키마를 쓰는 기존 호출이 전부
    # 422 가 됩니다. 반드시 고르게 하는 일은 신청 화면이 맡습니다.
    purpose_category: ReservationPurpose = ReservationPurpose.OTHER
    urgency: ReservationUrgency = ReservationUrgency.NORMAL
    note: str = Field(default="", max_length=2000)
    # 함께 쓰는 부원. 신청한 사람은 여기 넣지 않습니다(이미 신청자입니다).
    companion_ids: list[UUID] = Field(default_factory=list, max_length=10)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def times_must_be_on_half_hour(cls, value: datetime) -> datetime:
        """시작과 끝 **양쪽 다** 30분 단위여야 합니다.

        예전에는 끝만 봤습니다. 그래서 `17:00:30` 으로 시작하는 신청이 통과했고,
        확정 슬롯이 `17:00:30`·`17:30:30` 으로 깔렸습니다. 이미 있는 `17:00:00`
        슬롯과 초가 달라 겹침 검사에도, `uq_reservation_slot` 제약에도 걸리지
        않습니다. 같은 장비 같은 시간에 확정 예약이 둘 생기는 길이었습니다.
        """
        if value.minute not in {0, 30} or value.second or value.microsecond:
            raise ValueError("예약 시간은 30분 단위여야 합니다.")
        return value


class ReservationRead(ORMModel):
    id: UUID
    equipment_unit_id: UUID
    user_id: UUID
    starts_at: datetime
    ends_at: datetime
    note: str = ""
    purpose_category: ReservationPurpose = ReservationPurpose.OTHER
    urgency: ReservationUrgency = ReservationUrgency.NORMAL
    status: ReservationStatus
    rejection_reason: str | None = None
    before_photo_url: str | None = None
    after_photo_url: str | None = None
    equipment_name: str = ""
    unit_label: str = ""
    # 사람이 아니라 시계가 정한 예약이면 그 시각. 화면에서 '자동 확정' 으로 보입니다.
    auto_decided_at: datetime | None = None
    # 함께 쓰는 사람의 이름. 예약 현황과 마이페이지에 그대로 보입니다.
    companions: list[str] = []
    # 대기 중인 신청이 **저절로 확정될 시각**. 규칙만 설명하고 내 경우가 어느
    # 쪽인지는 말해 주지 않으면, 부원은 결국 운영진에게 직접 물어보게 됩니다.
    # 겹치는 신청이 있어 사람이 골라야 하는 경우에는 비워 둡니다.
    auto_confirm_at: datetime | None = None
    # 같은 호기·같은 시간을 두고 다투는 **다른** 대기 신청이 있는지.
    contested: bool = False


class AdminReservationRead(ReservationRead):
    user_name: str = ""
    user_email: str = ""
    created_at: datetime | None = None
    recurrence_group_id: UUID | None = None
    # 이 대기 신청과 시간이 겹치는 **다른 대기 신청**. 승인된 예약은 이미 슬롯이
    # 잠겨 있어 여기 오지 않습니다. 찾는 범위는 돌려준 목록 안입니다.
    conflicts_with: list[UUID] = []
    # 겹친 신청을 줄 세울 때 쓰는 점수와 그 근거. **추천일 뿐 결정이 아닙니다** —
    # 자동 확정은 겹침이 있으면 아예 손대지 않습니다. 근거를 함께 돌려주는 이유는,
    # 이유를 못 보여 주는 점수는 운영진이 믿을 수도 반박할 수도 없기 때문입니다.
    priority: int = 0
    priority_reasons: list[str] = []


class ReservationPhotoWrite(InputModel):
    photo_url: RequiredSafeUrl = Field(min_length=1, max_length=1000)
    # 사용 후 사진을 올리며 남은 시간을 돌려줄지. 지금까지는 일찍 끝내도 확정
    # 슬롯이 끝 시각까지 그대로 남아, 아무도 그 시간을 쓸 수 없었습니다.
    release_remaining: bool = False


class ReservationDecision(InputModel):
    approve: bool
    reason: str | None = Field(default=None, max_length=1000)


class RecurringReservationCreate(InputModel):
    """요일과 기간으로 정기 예약을 한 번에 잡습니다.

    교육 트랙은 화·수·목이 학기 내내 고정인데, 지금까지는 같은 신청을 매주 손으로
    되풀이해야 했습니다. 운영진만 쓰는 기능이라 일반 예약 화면은 그대로 둡니다.
    """

    equipment_unit_id: UUID
    # 0 = 월요일. `datetime.weekday()` 와 같은 기준입니다.
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start_time: str = Field(pattern=r"^([01]\d|2[0-3]):(00|30)$")
    end_time: str = Field(pattern=r"^([01]\d|2[0-3]):(00|30)$|^24:00$")
    from_date: date
    until_date: date
    purpose_category: ReservationPurpose = ReservationPurpose.EDUCATION
    urgency: ReservationUrgency = ReservationUrgency.NORMAL
    note: str = Field(default="", max_length=2000)
    companion_ids: list[UUID] = Field(default_factory=list, max_length=10)

    @field_validator("weekdays")
    @classmethod
    def weekdays_must_be_real(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("요일은 0(월)부터 6(일) 사이여야 합니다.")
        return sorted(set(value))


class RecurringSkip(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    date: date
    reason: str


class RecurringReservationResult(BaseModel):
    """만든 것과 건너뛴 것을 함께 돌려줍니다.

    한 주가 겹친다고 학기 전체를 실패시키면, 운영진이 겹치는 주를 스스로 찾아내
    기간을 쪼개 다시 넣어야 합니다. 겹친 날짜만 빼고 나머지는 만듭니다.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    group_id: UUID
    created: list[ReservationRead] = []
    skipped: list[RecurringSkip] = []


class RecurringGroupRead(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    group_id: UUID
    equipment_name: str = ""
    unit_label: str = ""
    weekdays: list[int] = []
    start_time: str = ""
    end_time: str = ""
    first_date: date | None = None
    last_date: date | None = None
    total: int = 0
    upcoming: int = 0


class UsageCount(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    key: str
    label: str
    count: int = 0
    hours: float = 0.0
    # 장비별 묶음에서만 채웁니다. 0~100.
    utilisation: float | None = None


class UsageStats(BaseModel):
    """관리자 사용 통계. 모두 SQL 집계로 세고 예약 행을 끌어오지 않습니다."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    from_date: date
    until_date: date
    days: int = 0
    total_count: int = 0
    total_hours: float = 0.0
    equipment: list[UsageCount] = []
    purposes: list[UsageCount] = []
    urgencies: list[UsageCount] = []
    decisions: list[UsageCount] = []
    people: list[UsageCount] = []
    # 요일(0=월) × 시(0~23) 격자. 그 시간대에 걸쳐 있던 예약 수입니다.
    heatmap: list[list[int]] = []


class BlackoutWrite(InputModel):
    """운영진이 시간을 막을 때 보내는 것.

    모양이 정기 예약 입력과 같습니다(요일 + 시각 범위 + 날짜 범위). 한 번만 막는
    것도 같은 모양으로 적습니다 — 시작 날짜와 끝 날짜를 같은 날로 두면 됩니다.
    """

    equipment_id: UUID
    # 비우면 그 장비의 **모든 호기**를 막습니다.
    equipment_unit_id: UUID | None = None
    reason: str = Field(default="", max_length=200)
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start_time: str = Field(pattern=r"^([01]\d|2[0-3]):(00|30)$")
    end_time: str = Field(pattern=r"^([01]\d|2[0-3]):(00|30)$|^24:00$")
    from_date: date
    until_date: date
    # 걸리는 예약을 함께 취소할지. **기본이 거짓인 것이 중요합니다** — 미리 보여
    # 주지 않은 호출이 남의 확정 예약을 조용히 물리면 안 됩니다. 화면은 먼저
    # 미리보기를 띄우고, 운영진이 확인한 뒤에만 참으로 보냅니다.
    cancel_conflicts: bool = False

    @field_validator("weekdays")
    @classmethod
    def weekdays_must_be_real(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("요일은 0(월)부터 6(일) 사이여야 합니다.")
        return sorted(set(value))


class BlackoutRead(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    id: UUID
    equipment_id: UUID
    equipment_unit_id: UUID | None = None
    equipment_name: str = ""
    unit_label: str = ""
    reason: str = ""
    weekdays: list[int] = []
    start_time: str = ""
    end_time: str = ""
    from_date: date
    until_date: date
    # 아직 오지 않은 날 중 실제로 막히는 날의 수. 지난 규칙을 지워도 되는지
    # 판단하는 데 씁니다.
    upcoming_days: int = 0
    # 이번에 실제로 취소된 예약 수. 미리보기와 등록 사이에 새 신청이 들어올 수
    # 있으므로, 화면은 미리보기의 수가 아니라 이 값을 말해야 사실과 맞습니다.
    cancelled_count: int = 0


class BlackoutClash(BaseModel):
    """막으려는 시간에 이미 들어와 있는 예약 한 건."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    id: UUID
    user_name: str = ""
    equipment_name: str = ""
    unit_label: str = ""
    starts_at: datetime
    ends_at: datetime
    status: ReservationStatus


class BlackoutPreview(BaseModel):
    """등록하면 무슨 일이 일어나는지 미리 보여 줍니다.

    막는 일은 남의 확정 예약을 물리는 일이 될 수 있으므로, 몇 건이 취소되는지
    **이름과 함께** 먼저 보여 주고 확인을 받습니다.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    days: int = 0
    clashes: list[BlackoutClash] = []


class ReservationPolicyRead(ORMModel):
    """관리자 화면이 읽는 예약 정책. 전부 분 단위이거나 개수입니다."""

    auto_approve_minutes: int
    staff_reminder_minutes: int
    start_grace_minutes: int
    before_photo_grace_minutes: int
    max_hours: int
    booking_window_days: int
    recurring_max: int


class ReservationPolicyWrite(InputModel):
    """정책을 고칠 때 보내는 것. 상한은 실수로 사이트를 잠그지 않을 만큼만 넓습니다.

    자동 확정을 0분으로 두면 '시작하는 순간 확정' 이 되고, 아주 크게 두면 사실상
    '신청하면 곧바로 확정' 이 됩니다. 둘 다 뜻이 있는 설정이라 막지 않습니다.
    """

    auto_approve_minutes: int = Field(ge=0, le=60 * 24 * 30)
    staff_reminder_minutes: int = Field(ge=0, le=60 * 24 * 30)
    start_grace_minutes: int = Field(ge=0, le=60 * 12)
    before_photo_grace_minutes: int = Field(ge=1, le=60 * 24)
    max_hours: int = Field(ge=1, le=24)
    booking_window_days: int = Field(ge=1, le=365)
    recurring_max: int = Field(ge=1, le=100)


class PublicBlackout(BaseModel):
    """예약 현황 달력에 얹는 '막힌 시간' 한 칸.

    규칙(요일 + 시각 + 기간)을 그대로 주지 않고 **그 달의 날짜마다 펼쳐서** 줍니다.
    달력은 날짜 칸에 무엇을 그릴지만 알면 되므로, 요일 규칙을 화면이 다시 펴게
    하면 서버와 화면 두 곳에 같은 계산이 생깁니다.

    누가 무엇을 예약했는지는 들어가지 않습니다 — 장비와 시각과 사유뿐이라
    공개 읽기 캐시를 그대로 씁니다. 사유는 이미 예약 화면에서도 공개됩니다.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    equipment_id: UUID
    equipment_name: str = ""
    # 비어 있으면 그 장비의 **모든 호기**가 막힌 것입니다.
    unit_label: str = ""
    reason: str = ""
    starts_at: datetime
    ends_at: datetime


class PublicReservationPolicy(BaseModel):
    """부원 화면이 읽는 부분.

    예약 신청 화면과 마이페이지가 "이 신청은 언제 확정되는가" 를 **정확한 시각**
    으로 적으려면 자동 확정 시점을 알아야 합니다. 여기 실리는 것은 규칙 값뿐이고
    누구의 정보도 들어가지 않으므로 공개 읽기 캐시를 그대로 씁니다.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    auto_approve_minutes: int
    start_grace_minutes: int
    max_hours: int
    booking_window_days: int


class LicenseMembersWrite(InputModel):
    """이 교육을 이수한 사람 목록을 통째로 맞춥니다.

    예전에는 회원 한 명을 고르고 그 사람의 라이선스를 손보는 길밖에 없었습니다.
    교육을 한 번 하고 마흔 명에게 부여하려면 마흔 번 들어갔다 나와야 했습니다.
    """

    user_ids: list[UUID] = Field(default_factory=list, max_length=500)


class LicenseMembersResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    granted: int = 0
    revoked: int = 0
    total: int = 0


class MyUsageEntry(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    label: str
    count: int = 0
    hours: float = 0.0


class MyUsage(BaseModel):
    """부원 본인의 사용 기록. 남의 기록은 한 건도 들어가지 않습니다."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    total_count: int = 0
    total_hours: float = 0.0
    # 사용을 마친 것만 셉니다. 앞으로의 예약은 '쓴 시간' 이 아닙니다.
    completed_count: int = 0
    upcoming_count: int = 0
    # 사용 후 사진을 올리지 않은 채 끝난 예약. 스스로 볼 수 있어야 챙깁니다.
    missing_photo_count: int = 0
    equipment: list[MyUsageEntry] = []
    purposes: list[MyUsageEntry] = []
    first_used_at: datetime | None = None
    last_used_at: datetime | None = None


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
    # 화면에서 '부원 전용'·'운영진 전용' 표를 달아 주려면 어떤 범위로 열린
    # 링크인지 읽는 쪽도 알아야 합니다. 볼 수 없는 링크는 애초에 목록에
    # 들어오지 않으므로 이 값이 새어 나가 문제가 되지는 않습니다.
    visibility: LinkVisibility = LinkVisibility.PUBLIC


class AdminLinkRead(LinkRead):
    is_published: bool


class LinkWrite(InputModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    url: HttpUrl
    sort_order: int = Field(default=0, ge=0)
    is_published: bool = True
    visibility: LinkVisibility = LinkVisibility.PUBLIC


class NoticeRead(ORMModel):
    """게시판 목록에 나가는 한 줄.

    본문(`content_html`)은 **일부러 빼 두었습니다.** 목록 화면은 제목·분류·글쓴이
    ·날짜·댓글 수만 그리는데, 본문까지 실어 보내면 글이 쌓일수록 목록 응답만
    수십 KB 로 불어납니다. 게시판은 회원 전용이라 공유 캐시도 못 태워, 그 무게가
    누가 목록을 열 때마다 그대로 나갑니다. 본문은 글을 눌렀을 때 상세에서 옵니다.
    """

    id: UUID
    title: str
    category: str
    is_pinned: bool
    published_at: datetime
    author_name: str = ""
    comment_count: int = 0


class NoticeDetailRead(NoticeRead):
    content_html: DeliveredHtml = ""
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


class MemberPick(ORMModel):
    """장비를 함께 쓸 사람을 고를 때 보이는 최소한의 정보."""

    id: UUID
    name: str
    image_url: str | None = None


class ReservationCalendarItem(ORMModel):
    id: UUID
    # 예약 현황 화면에서 "내 예약"을 알아보고 사용 전후 사진을 바로 올리게 합니다.
    user_id: UUID
    equipment_name: str
    unit_label: str
    user_name: str
    # 덧붙인 말(`note`)은 여기 싣지 않습니다. 그것은 운영진에게 하는 말이라
    # ("금요일이 대회 마감이라 오늘밖에 없습니다") 동아리 전체가 보는 달력에
    # 뜨면 사람들이 솔직하게 쓰지 못합니다. 분류와 시급도만 보여 줍니다.
    purpose_category: ReservationPurpose = ReservationPurpose.OTHER
    urgency: ReservationUrgency = ReservationUrgency.NORMAL
    starts_at: datetime
    ends_at: datetime
    status: ReservationStatus
    before_photo_url: str | None = None
    after_photo_url: str | None = None
    # 함께 쓰는 사람. 예약 현황에서 누가 같이 오는지 보입니다.
    companions: list[str] = []


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
    file_url: SafeUrl = Field(default=None, max_length=1000)
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


YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}


def looks_like_youtube(url: str | None) -> bool:
    """이 주소가 유튜브인가. 그림 칸에 잘못 붙여 넣은 영상을 알아보는 데 씁니다."""
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return host.lower() in YOUTUBE_HOSTS


def youtube_only(value: HttpUrl | None) -> HttpUrl | None:
    """유튜브 주소만 통과시킵니다.

    영상을 우리가 받아 두지 않는 이유는 `models.ShapeUpPost` 설명에 있습니다.
    화면에서도 막지만, **화면만 믿으면 안 되므로** 여기서 한 번 더 봅니다.
    걸러 내는 김에 무엇이 잘못됐는지도 사람 말로 알려 줍니다.
    """
    if value is None:
        return None
    if (value.host or "").lower() not in YOUTUBE_HOSTS:
        raise ValueError("영상은 유튜브 주소만 넣을 수 있습니다.")
    return value


class ShapeUpBlock(InputModel):
    """방법·결과에 하나씩 쌓는 덩이. 그림이나 영상 하나에 설명 한 토막입니다.

    **셋 다 빈 덩이를 거절하지 않습니다.** 화면에서 '블록 추가' 를 누르고 채우지
    않은 채 저장하는 일이 흔한데, 그때 422 를 돌려주면 부원은 여덟 덩이 중 어느
    것이 비었는지 찾아 헤매게 됩니다. 받아서 `shape_up_blocks` 가 조용히
    버립니다 — 그리는 쪽에서도 어차피 아무것도 나오지 않습니다.
    """

    image: str | None = Field(default=None, max_length=1000)
    video: HttpUrl | None = None
    caption: str = Field(default="", max_length=2000)

    _check_video = field_validator("video")(youtube_only)


class ShapeUpBlockRead(ORMModel):
    """화면에 내보내는 덩이. 주소는 문자열로 나갑니다."""

    image: str | None = None
    video: str | None = None
    caption: str = ""


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
    """상세 화면이 그리는 데 필요한 것 전부.

    목록(`ShapeUpRead`)에는 담지 않습니다. 카드에 쓰이지 않는 초록·블록까지
    목록마다 실어 보내면, 결과물이 쌓이는 만큼 목록을 여는 값이 함께 자랍니다.
    """

    slides_url: str | None = None
    # 글쓰기 도구가 게시판·소식과 같은 편집기라 값이 HTML 입니다. `DeliveredHtml`
    # 은 본문에 박힌 Cloudinary 주소에 줄이는 규칙을 한 번 더 붙입니다 — 규칙이
    # 생기기 전에 저장된 글까지 덮기 위한 자리입니다(`NewsDetailRead` 와 같음).
    abstract: DeliveredHtml = ""
    problem: DeliveredHtml = ""
    limitations: DeliveredHtml = ""
    method_blocks: list[ShapeUpBlockRead] = Field(default_factory=list)
    result_blocks: list[ShapeUpBlockRead] = Field(default_factory=list)


class ShapeUpWrite(InputModel):
    """제출 화면이 보내는 것.

    덩이 수에 상한을 두는 이유는 한 쪽이 끝없이 무거워지지 않게 하기 위해서입니다.
    방법·결과 각각 열두 덩이면 논문 프로젝트 페이지로도 넉넉합니다.
    """

    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=2000)
    cohort: str = Field(default="", max_length=20)
    team_name: str = Field(default="", max_length=120)
    team_members: list[str] = Field(default_factory=list, max_length=20)
    cover_image: SafeUrl = Field(default=None, max_length=1000)
    github_url: HttpUrl | None = None
    video_url: HttpUrl | None = None
    slides_url: HttpUrl | None = None
    # 게시판·소식과 같은 편집기를 쓰므로 값이 HTML 입니다. 태그가 붙는 만큼
    # 같은 분량의 글이 서너 배로 불어나므로 상한을 글자 수가 아니라 **본문 크기**로
    # 봅니다. 게시판(`MemberNoticeWrite`)은 상한이 없지만, 여기는 한 글에 칸이
    # 셋이라 어느 정도 울타리를 둡니다. 미들웨어의 요청 크기 한도(2MB)가 그
    # 바깥 울타리입니다.
    abstract: str = Field(default="", max_length=60_000)
    problem: str = Field(default="", max_length=60_000)
    limitations: str = Field(default="", max_length=60_000)
    method_blocks: list[ShapeUpBlock] = Field(default_factory=list, max_length=12)
    result_blocks: list[ShapeUpBlock] = Field(default_factory=list, max_length=12)

    _check_video = field_validator("video_url")(youtube_only)


class NotificationRead(ORMModel):
    id: UUID
    title: str
    is_read: bool
    notice_id: UUID | None = None
    url: str | None = None
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


class AdminAuditRead(ORMModel):
    """수정 내역 한 줄. 그때의 이름을 그대로 돌려줍니다(회원이 바뀌어도 기록은 그대로)."""

    id: UUID
    created_at: datetime
    actor_id: UUID | None = None
    actor_name: str = ""
    actor_email: str = ""
    action: str = ""
    area: str = ""
    target: str = ""
    detail: str = ""
    method: str = ""
    path: str = ""


class AuditActor(BaseModel):
    id: UUID | None = None
    name: str = ""


class AdminAuditPage(BaseModel):
    """수정 내역 한 쪽과, 거르개에 쓸 목록.

    거르개 목록을 첫 쪽에만 실어 보냅니다. 이어받기(`before`)로 다음 쪽을 받을
    때마다 다시 계산하면 표가 커질수록 값이 붙는데, 화면은 첫 쪽에서 받은 목록을
    그대로 쓰기 때문입니다.
    """

    items: list[AdminAuditRead]
    actors: list[AuditActor] = Field(default_factory=list)
    areas: list[str] = Field(default_factory=list)


class ContactWrite(InputModel):
    """`/contact` 로 들어오는 문의. **로그인 없이 쓰는 유일한 창구입니다.**

    길이 상한은 화면의 `maxLength` 와 같은 값입니다. 화면만 믿으면 안 되므로
    서버에서 한 번 더 자릅니다.
    """

    name: str = Field(min_length=1, max_length=80)
    reply_to: str = Field(min_length=3, max_length=200)
    subject: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=3000)
    # 사람 눈에는 안 보이는 칸. 자동 프로그램은 폼의 모든 칸을 채우므로, 여기에
    # 무언가 들어오면 사람이 쓴 것이 아닙니다. 글자 확인(캡차)을 붙이지 않고
    # 거르는 가장 가벼운 방법입니다.
    website: str = Field(default="", max_length=200)

    @field_validator("name", "reply_to", "subject", "message")
    @classmethod
    def _strip(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("빈칸은 보낼 수 없습니다.")
        return trimmed

    @field_validator("reply_to")
    @classmethod
    def _looks_like_email(cls, value: str) -> str:
        # 정식 검사는 하지 않습니다. 답장을 보낼 주소이므로 사람이 눈으로 보고
        # 판단하면 되고, 지나치게 깐깐하면 멀쩡한 주소가 막힙니다.
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("회신 이메일을 확인해 주세요.")
        return value


class AdminContactRead(ORMModel):
    id: UUID
    name: str
    reply_to: str
    subject: str
    message: str
    is_read: bool
    handled_at: datetime | None = None
    created_at: datetime


class AdminContactPage(ORMModel):
    """문의 한 쪽과 아직 안 읽은 수.

    안 읽은 수를 목록과 함께 보내는 이유는, 관리자 화면의 탭 이름 옆 숫자가
    **지금 쪽에 실린 것만이 아니라 전체**를 가리켜야 하기 때문입니다.
    """

    items: list[AdminContactRead]
    unread: int = 0


class ContactMark(InputModel):
    """문의 한 건의 상태를 바꿉니다. 준 것만 바뀝니다."""

    is_read: bool | None = None
    handled: bool | None = None


class UnreadCount(BaseModel):
    """안 읽은 알림 수. 목록과 따로 세는 이유는 `models.Notification` 설명에."""

    unread: int = 0
