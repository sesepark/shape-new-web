export type EquipmentStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";
/**
 * 계정 상태. `VIEWER` 는 보기 전용 회원입니다 — 로그인해서 공지·자료실·예약
 * 현황을 읽지만 글쓰기·댓글·예약 신청은 하지 않습니다. 직전 학기에는 활동했지만
 * 이번 학기에는 활동하지 않는 인원(부원 카드의 '멤버')에게 줍니다.
 */
export type MemberStatus = "PENDING" | "APPROVED" | "VIEWER" | "REJECTED" | "SUSPENDED";
export type ReservationStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "IN_USE" | "COMPLETED";

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
  units: { id: string; label: string; reservedStarts: string[] }[];
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
  purpose: string;
  status: ReservationStatus;
  rejectionReason?: string | null;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  equipmentName: string;
  unitLabel: string;
  /** 함께 쓰는 사람의 이름. 없으면 빈 목록입니다. */
  companions?: string[];
}

export interface AdminReservationItem extends ReservationItem {
  userName: string;
  userEmail: string;
  createdAt?: string | null;
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
  purpose: string;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  /** 함께 쓰는 사람의 이름. */
  companions?: string[];
}
