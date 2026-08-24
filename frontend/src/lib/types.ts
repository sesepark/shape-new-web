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

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
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
  createdAt: string;
}

export interface RelatedLink {
  id: string;
  title: string;
  description?: string;
  url: string;
  icon?: string;
}

export type NoticeCategory = "공지" | "질문" | "정보" | "일반";

export interface NoticeItem {
  id: string;
  title: string;
  category: NoticeCategory;
  publishedAt: string;
  isPinned: boolean;
  contentHtml: string;
  authorName: string;
  commentCount: number;
}

export interface NoticeDetail extends NoticeItem {
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
}
