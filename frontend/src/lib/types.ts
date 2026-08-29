export type EquipmentStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";
/**
 * 계정 상태. `VIEWER` 는 보기 전용 회원입니다 — 로그인해서 공지·자료실·예약
 * 현황을 읽지만 글쓰기·댓글·예약 신청은 하지 않습니다. 직전 학기에는 활동했지만
 * 이번 학기에는 활동하지 않는 인원(부원 카드의 '멤버')에게 줍니다.
 */
export type MemberStatus = "PENDING" | "APPROVED" | "VIEWER" | "REJECTED" | "SUSPENDED";
/** `EXPIRED` 는 아무도 손대지 않은 채 사용 시간이 다 지나간 신청입니다. */
export type ReservationStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "IN_USE" | "COMPLETED" | "EXPIRED";
/** 무엇을 위해 장비를 쓰는가. 시간이 겹쳤을 때 운영진이 보는 첫 기준입니다. */
export type ReservationPurpose = "CONTEST" | "SHAPE_UP" | "EDUCATION" | "OTHER";
/** 얼마나 급한가. 분류가 같을 때 순서를 가르는 두 번째 기준입니다. */
export type ReservationUrgency = "HIGH" | "NORMAL" | "LOW";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  imageUrl?: string | null;
  introduction?: string | null;
  status: MemberStatus;
  isOwner: boolean;
  permissions: string[];
  licenses: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  category: string;
  coverImage?: string;
  externalUrl?: string;
}

export interface LinkPreview {
  status: "embed" | "card" | "unreachable" | "unsupported" | "invalid";
  url: string;
  embed?: { provider: string; src: string; ratio: string };
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface NewsDetail extends NewsItem {
  contentHtml: string;
  contentJson?: { linkPreview?: boolean; preview?: LinkPreview; [key: string]: unknown };
}

export interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl?: string;
  status: EquipmentStatus;
  requiredLicenses: string[];
  availableUnits: number;
  reservationUnitMinutes: number;
  openHour: number;
  closeHour: number;
  /** 확정된 예약이 동아리 공유 구글 캘린더에도 올라가는 장비인지. */
  sharedCalendar?: boolean;
}

export interface EquipmentUnitItem {
  id: string;
  equipmentId: string;
  label: string;
  status: EquipmentStatus;
}

export interface AdminEquipmentItem {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl?: string | null;
  status: EquipmentStatus;
  reservationUnitMinutes: number;
  sortOrder: number;
  requiredLicenseIds: string[];
  units: EquipmentUnitItem[];
}

export interface LicenseItem {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
}

export interface RoadmapItem {
  id: string;
  title: string;
  category: string;
  startsAt: string;
  endsAt?: string;
  description: string;
}

export interface AdminRoadmapItem extends RoadmapItem {
  isPublished: boolean;
  memberIds: string[];
}

/** 부원 페이지에 놓인 카드 한 장. 마이페이지가 내 카드를 확인할 때 씁니다. */
export interface MemberCardItem {
  id: string;
  name: string;
  role: string;
  membership: string;
  imageUrl?: string | null;
}

export interface MemberCardState {
  card: MemberCardItem | null;
  /** 내 계정 이름과 같은 카드. 이름이 다르게 적혀 있으면 비어 있습니다. */
  candidates: MemberCardItem[];
  /** 아직 아무도 연결하지 않은 카드 전부. 직접 고를 때 씁니다. */
  available: MemberCardItem[];
  /** 내 계정에 저장된 이름. 왜 후보가 안 뜨는지 알려 줄 때 씁니다. */
  myName: string;
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  /** 구글 계정 프로필 사진. 관리자 화면에서 사람을 고를 때 함께 보여 줍니다. */
  imageUrl?: string | null;
  status: MemberStatus;
}

export interface ContentPage {
  slug: string;
  title: string;
  contentJson: Record<string, unknown>;
  contentHtml: string;
  updatedAt: string;
}

export interface EquipmentAvailability {
  equipmentId: string;
  reservationUnitMinutes: number;
  openHour: number;
  closeHour: number;
  units: {
    id: string;
    label: string;
    /** 이미 확정된 30분 칸의 시작 시각(한국 시각 ISO). */
    reservedStarts: string[];
    /**
     * 아직 승인되지 않은 신청이 잡고 있는 칸. 같은 시각이 여러 번 나오면 그만큼
     * 겹친 것입니다.
     *
     * 없을 수도 있게(`?`) 둡니다. 프런트엔드와 백엔드는 서로 다른 곳에 배포되어
     * 한쪽이 먼저 올라갑니다. 화면이 먼저 올라간 몇 분 동안 이 값이 없다고
     * 깨지면 안 됩니다.
     */
    pendingStarts?: string[];
    /**
     * 운영진이 막아 둔 칸(정비·교육 실습·대회 준비). 화면은 이 칸을 아예 누를
     * 수 없게 그리고, 서버도 같은 규칙으로 신청을 거절합니다.
     *
     * `pendingStarts` 와 같은 이유로 없을 수도 있게 둡니다 — 화면이 백엔드보다
     * 먼저 올라간 몇 분 동안 이 값이 없다고 깨지면 안 됩니다.
     */
    blockedStarts?: string[];
  }[];
  /** 그 날 걸려 있는 사용 제한의 사유. 왜 못 누르는지 화면이 말해 줍니다. */
  blockedReasons?: string[];
}

/** 장비를 함께 쓸 사람을 고를 때 보이는 최소한의 정보. 로그인한 회원에게만 옵니다. */
export interface MemberPick {
  id: string;
  name: string;
  imageUrl?: string | null;
}

export interface ReservationItem {
  id: string;
  equipmentUnitId: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  /**
   * 덧붙인 말. 예전 이름은 `purpose` 였고 '사용 목적 및 작업 내용' 을 받았습니다.
   * 이제 목적은 `purposeCategory` 가 맡고, 이 칸은 '왜 하필 이 시간이어야
   * 하는가' 를 적는 자리입니다.
   */
  note?: string;
  purposeCategory?: ReservationPurpose;
  urgency?: ReservationUrgency;
  status: ReservationStatus;
  rejectionReason?: string | null;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  equipmentName: string;
  unitLabel: string;
  /** 사람이 아니라 시계가 확정한 예약이면 그 시각. */
  autoDecidedAt?: string | null;
  /**
   * 대기 중인 신청이 **저절로 확정될 시각**. 겹치는 신청이 있어 사람이 골라야
   * 하면 비어 있습니다. 규칙만 설명하고 내 경우가 어느 쪽인지는 말해 주지
   * 않으면, 부원은 결국 운영진에게 직접 물어보게 됩니다.
   */
  autoConfirmAt?: string | null;
  /** 같은 호기·같은 시간을 두고 다투는 다른 대기 신청이 있는지. */
  contested?: boolean;
  /** 함께 쓰는 사람의 이름. 없으면 빈 목록입니다. */
  companions?: string[];
}

export interface AdminReservationItem extends ReservationItem {
  userName: string;
  userEmail: string;
  createdAt?: string | null;
  recurrenceGroupId?: string | null;
  /** 시간이 겹치는 **다른 대기 신청**의 id. 겹치지 않으면 빈 목록입니다. */
  conflictsWith?: string[];
  /** 추천 점수와 그 근거. 추천일 뿐 결정이 아닙니다. */
  priority?: number;
  priorityReasons?: string[];
}

/** 정기 예약 묶음 하나. 관리자 화면에서만 씁니다. */
export interface RecurringGroup {
  groupId: string;
  equipmentName: string;
  unitLabel: string;
  /** 0 = 월요일. */
  weekdays: number[];
  startTime: string;
  endTime: string;
  firstDate?: string | null;
  lastDate?: string | null;
  total: number;
  upcoming: number;
}

export interface RecurringResult {
  groupId: string;
  created: ReservationItem[];
  skipped: { date: string; reason: string }[];
}

/** 사용 통계의 한 줄. `utilisation` 은 장비별 묶음에서만 채워집니다. */
export interface UsageCount {
  key: string;
  label: string;
  count: number;
  hours: number;
  utilisation?: number | null;
}

export interface UsageStats {
  fromDate: string;
  untilDate: string;
  days: number;
  totalCount: number;
  totalHours: number;
  equipment: UsageCount[];
  purposes: UsageCount[];
  urgencies: UsageCount[];
  decisions: UsageCount[];
  people: UsageCount[];
  /** 요일(0=월) × 시(0~23) 격자. */
  heatmap: number[][];
}

export interface AdminUserItem {
  id: string;
  name: string;
  email: string;
  imageUrl?: string | null;
  status: MemberStatus;
  isOwner: boolean;
  createdAt: string;
  permissions: string[];
  licenseIds: string[];
}

export interface MemberProject {
  id: string;
  title: string;
  category: string;
  startsAt: string;
  endsAt?: string | null;
}

export interface MemberProfile {
  id: string;
  name: string;
  imageUrl?: string | null;
  introduction?: string | null;
  projects: MemberProject[];
}

export type ResourceCategory = "양식" | "교육 자료" | "장비 매뉴얼" | "발표 자료" | "기타";

export interface ResourceItem {
  id: string;
  title: string;
  description: string;
  category: ResourceCategory;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize: number;
  linkUrl?: string | null;
  isPublic: boolean;
  authorName: string;
  createdAt: string;
  canEdit: boolean;
}

export interface ShapeUpItem {
  id: string;
  title: string;
  summary: string;
  cohort: string;
  teamName: string;
  teamMembers: string[];
  coverImage?: string | null;
  githubUrl?: string | null;
  videoUrl?: string | null;
  authorName: string;
  createdAt: string;
  canEdit: boolean;
}

export interface ShapeUpDetail extends ShapeUpItem {
  contentHtml: string;
  contentJson?: Record<string, unknown>;
}

export interface NotificationItem {
  id: string;
  title: string;
  isRead: boolean;
  noticeId?: string | null;
  /** 알림을 눌렀을 때 갈 곳. 비어 있으면 게시판으로 갑니다. */
  url?: string | null;
  createdAt: string;
}

/**
 * 바로가기 링크를 누구까지 볼 수 있는지.
 *
 * `PUBLIC` 은 비로그인 방문자까지, `MEMBER` 는 승인된 회원과 보기 전용
 * 회원(멤버), `STAFF` 는 링크를 관리하는 운영진입니다. 서버가 볼 수 없는
 * 링크는 목록에서 아예 빼고 보내므로, 화면에서는 표를 다는 데만 씁니다.
 */
export type LinkVisibility = "PUBLIC" | "MEMBER" | "STAFF";

export interface RelatedLink {
  id: string;
  title: string;
  description?: string;
  url: string;
  icon?: string;
  visibility?: LinkVisibility;
}

export type NoticeCategory = "공지" | "질문" | "정보" | "일반";

/**
 * 게시판 목록에 나오는 한 줄.
 *
 * 본문은 들어 있지 않습니다. 목록은 제목·분류·글쓴이·날짜·댓글 수만 그리는데,
 * 본문까지 받으면 글이 쌓일수록 목록만 무거워집니다. 본문은 글을 눌렀을 때
 * `NoticeDetail` 로 옵니다.
 */
export interface NoticeItem {
  id: string;
  title: string;
  category: NoticeCategory;
  publishedAt: string;
  isPinned: boolean;
  authorName: string;
  commentCount: number;
}

export interface NoticeDetail extends NoticeItem {
  contentHtml: string;
  authorId?: string | null;
  canEdit: boolean;
}

export interface CommentItem {
  id: string;
  parentId?: string | null;
  body: string;
  authorName: string;
  authorId?: string | null;
  createdAt: string;
  isDeleted: boolean;
  canDelete: boolean;
}

export interface ReservationCalendarItem {
  id: string;
  userId: string;
  equipmentName: string;
  unitLabel: string;
  userName: string;
  /**
   * 덧붙인 말(`note`)은 여기 오지 않습니다. 그것은 운영진에게 하는 말이라
   * 동아리 전체가 보는 달력에 뜨면 사람들이 솔직하게 쓰지 못합니다.
   */
  purposeCategory?: ReservationPurpose;
  urgency?: ReservationUrgency;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  /** 함께 쓰는 사람의 이름. */
  companions?: string[];
}


/** 운영진이 막아 둔 시간 한 건. 관리자 화면에서만 씁니다. */
export interface BlackoutItem {
  id: string;
  equipmentId: string;
  equipmentUnitId?: string | null;
  equipmentName: string;
  unitLabel: string;
  reason: string;
  /** 0 = 월요일. */
  weekdays: number[];
  startTime: string;
  endTime: string;
  fromDate: string;
  untilDate: string;
  /** 아직 오지 않은 날 중 실제로 막히는 날의 수. */
  upcomingDays: number;
  /** 이번에 실제로 취소된 예약 수. 등록 응답에만 채워집니다. */
  cancelledCount?: number;
}

/** 막으면 취소될 예약 한 건. 등록 전에 이름과 함께 보여 줍니다. */
export interface BlackoutClash {
  id: string;
  userName: string;
  equipmentName: string;
  unitLabel: string;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
}

export interface BlackoutPreview {
  days: number;
  clashes: BlackoutClash[];
}

/** 예약이 굴러가는 시각과 상한. 관리자 화면에서 고칩니다. */
export interface ReservationPolicy {
  autoApproveMinutes: number;
  staffReminderMinutes: number;
  startGraceMinutes: number;
  beforePhotoGraceMinutes: number;
  maxHours: number;
  bookingWindowDays: number;
  recurringMax: number;
}

/** 부원 화면이 읽는 부분. 안내를 **정확한 시각**으로 적는 데 씁니다. */
export interface PublicReservationPolicy {
  autoApproveMinutes: number;
  startGraceMinutes: number;
  maxHours: number;
  bookingWindowDays: number;
}

export interface MyUsageEntry {
  label: string;
  count: number;
  hours: number;
}

/** 부원 본인의 사용 기록. 남의 기록은 한 건도 들어가지 않습니다. */
export interface MyUsage {
  totalCount: number;
  totalHours: number;
  completedCount: number;
  upcomingCount: number;
  missingPhotoCount: number;
  equipment: MyUsageEntry[];
  purposes: MyUsageEntry[];
  firstUsedAt?: string | null;
  lastUsedAt?: string | null;
}
