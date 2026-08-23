"use client";

import Link from "next/link";
import Image from "next/image";
import { BellRing, CalendarClock, Camera, Check, ChevronRight, ClipboardCheck, Clock3, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { AutoTextarea } from "@/components/auto-textarea";
import { useAsk } from "@/components/ask-dialog";
import { PageShell } from "@/components/page-shell";
import { ImageUploadField } from "@/components/image-upload-field";
import { LicenseCard } from "@/components/license-card";
import { API_URL, isPreview } from "@/lib/api";
import { media } from "@/lib/media";
import { useSession } from "@/lib/session";
import { currentSubscription, pushSupported, subscribeToNotices, unsubscribeFromNotices } from "@/lib/push";
import type { NotificationItem, ReservationItem, RoadmapItem, SessionUser } from "@/lib/types";

type EquipmentPermission = {
  equipmentId: string;
  name: string;
  status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
  requiredLicenses: string[];
  missingLicenses: string[];
  licensed: boolean;
  eligible: boolean;
};

const equipmentStatusNote: Record<EquipmentPermission["status"], string> = {
  ACTIVE: "", MAINTENANCE: "점검 중", INACTIVE: "운영 중지",
};

/** 왜 못 쓰는지까지 한 줄로 알려 준다. 교육 미이수와 장비 상태는 다른 문제다. */
function permissionNote(item: EquipmentPermission) {
  if (item.eligible) return "사용 가능";
  if (!item.licensed) return `교육 필요: ${item.missingLicenses.join(", ")}`;
  return equipmentStatusNote[item.status] || "사용 불가";
}

const previewReservations: ReservationItem[] = [
  { id: "demo-reservation-1", equipmentUnitId: "demo-a", userId: "demo", startsAt: "2026-08-25T10:00:00+09:00", endsAt: "2026-08-25T12:00:00+09:00", purpose: "휴머노이드 외장 부품 시제품 출력", status: "APPROVED", equipmentName: "3D 프린터", unitLabel: "1호기" },
  { id: "demo-reservation-2", equipmentUnitId: "demo-b", userId: "demo", startsAt: "2026-08-29T14:00:00+09:00", endsAt: "2026-08-29T16:00:00+09:00", purpose: "ROS 2 센서 캘리브레이션", status: "PENDING", equipmentName: "OMY", unitLabel: "2호기" },
];
const statusLabel: Record<ReservationItem["status"], string> = { PENDING: "승인 대기", APPROVED: "예약 확정", REJECTED: "반려", CANCELLED: "취소", IN_USE: "사용 중", COMPLETED: "사용 완료" };
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
const stamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const span = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" });

async function call(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store", ...init });
}

function ReservationPhotoStep({ reservation, onDone }: { reservation: ReservationItem; onDone: (next: ReservationItem) => void }) {
  const [photo, setPhoto] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const step = reservation.status === "APPROVED" ? "before" : "after";
  const before = step === "before";
  async function submit() {
    if (!photo) { setMessage("사진을 먼저 올려 주세요."); return; }
    setBusy(true);
    const response = await call(`/reservations/${reservation.id}/${step}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: photo }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setMessage("기록하지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
    onDone((await response.json()) as ReservationItem);
    setPhoto("");
    setMessage("");
  }
  return (
    <div className={`reservation-photo-step${before ? "" : " after"}`}>
      <header>
        <span className="step-badge">{before ? "STEP 1" : "STEP 2"}</span>
        <div>
          <strong>{before ? "사용 전 사진을 올리고 시작하기" : "사용 후 사진을 올리고 완료하기"}</strong>
          <p>
            {before
              ? "장비를 만지기 전 상태를 한 장 찍어 올려 주세요. 다음 사용자가 이전 상태를 확인할 수 있고, 이상이 있을 때 원인을 빠르게 좁힐 수 있습니다."
              : "정리를 마친 상태를 찍어 올리면 사용이 완료 처리됩니다. 파손이나 이상 동작을 발견했다면 정리 전에 사진과 함께 운영진에게 알려 주세요."}
          </p>
        </div>
      </header>
      <ImageUploadField purpose="reservation" label={before ? "사용 전 상태 사진" : "사용 후 상태 사진"} value={photo} onChange={setPhoto} />
      <button className="button small" type="button" disabled={busy || !photo} onClick={submit}>
        <Camera size={15} />
        {busy ? "기록 중" : before ? "사용 시작하기" : "사용 완료하기"}
      </button>
      {message && <p className="form-note">{message}</p>}
    </div>
  );
}

/** 아직 차례가 아닌 예약에도 다음에 무엇을 해야 하는지 알려 준다. */
function ReservationNextStep({ status }: { status: ReservationItem["status"] }) {
  if (status === "PENDING")
    return <p className="reservation-hint">운영진 승인을 기다리는 중입니다. 승인되면 이 자리에서 <b>사용 전 사진</b>을 올리고 사용을 시작할 수 있습니다.</p>;
  if (status === "REJECTED" || status === "CANCELLED")
    return null;
  return null;
}

function ReservationCard({ reservation, onChange }: { reservation: ReservationItem; onChange: (next: ReservationItem) => void }) {
  const { ask, dialogNode } = useAsk();
  const [message, setMessage] = useState("");
  const starts = new Date(reservation.startsAt);
  const cancellable = reservation.status === "PENDING" || reservation.status === "APPROVED";
  async function cancel() {
    const confirmed = await ask({
      title: "예약을 취소할까요?",
      description: `${reservation.equipmentName} ${reservation.unitLabel} · ${reservation.purpose || "신청한 예약"}을 취소합니다. 취소하면 그 시간이 다른 회원에게 다시 열립니다.`,
      confirmLabel: "예약 취소",
      tone: "danger",
    });
    if (confirmed === null) return;
    const response = await call(`/reservations/${reservation.id}/cancel`, { method: "POST" }).catch(() => null);
    if (!response?.ok) { setMessage("예약을 취소하지 못했습니다."); return; }
    onChange((await response.json()) as ReservationItem);
  }
  return (
    <article>
      <div className="reservation-date">
        <strong>{starts.getDate()}</strong>
        <span>{new Intl.DateTimeFormat("ko-KR", { month: "short" }).format(starts)}</span>
      </div>
      <div className="reservation-body">
        <h4>{reservation.purpose}</h4>
        <p><Clock3 size={14} />{clock.format(starts)} – {clock.format(new Date(reservation.endsAt))}</p>
        <p className="reservation-target">{reservation.equipmentName || "장비"}{reservation.unitLabel ? ` · ${reservation.unitLabel}` : ""}</p>
        {reservation.rejectionReason && <p className="reservation-reason">사유: {reservation.rejectionReason}</p>}
        {(reservation.status === "APPROVED" || reservation.status === "IN_USE") ? (
          <ReservationPhotoStep reservation={reservation} onDone={onChange} />
        ) : (
          <ReservationNextStep status={reservation.status} />
        )}
        {(reservation.beforePhotoUrl || reservation.afterPhotoUrl) && (
          <div className="reservation-photos">
            {reservation.beforePhotoUrl && <figure><a href={reservation.beforePhotoUrl} target="_blank" rel="noreferrer"><Image src={media(reservation.beforePhotoUrl, 400)} alt="사용 전 사진" width={320} height={220} unoptimized /></a><figcaption>사용 전</figcaption></figure>}
            {reservation.afterPhotoUrl && <figure><a href={reservation.afterPhotoUrl} target="_blank" rel="noreferrer"><Image src={media(reservation.afterPhotoUrl, 400)} alt="사용 후 사진" width={320} height={220} unoptimized /></a><figcaption>사용 후</figcaption></figure>}
          </div>
        )}
        {cancellable && <button className="text-button danger" type="button" onClick={cancel}><X size={14} /> 예약 취소</button>}
        {message && <p className="form-note">{message}</p>}
        {dialogNode}
      </div>
      <span className={`reservation-status ${reservation.status.toLowerCase()}`}>{statusLabel[reservation.status]}</span>
    </article>
  );
}

function ProfileCard({ session }: { session: SessionUser }) {
  const { refresh } = useSession();
  // The gate above holds the session it rendered with, so the saved values are
  // kept here as well to show the new name and portrait straight away.
  const [profile, setProfile] = useState(session);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session.name);
  const [imageUrl, setImageUrl] = useState(session.imageUrl ?? "");
  const [introduction, setIntroduction] = useState(session.introduction ?? "");
  const [message, setMessage] = useState("");
  async function save() {
    if (!name.trim()) { setMessage("이름을 입력해 주세요."); return; }
    const response = await call("/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), imageUrl: imageUrl || null, introduction: introduction.trim() || null }),
    }).catch(() => null);
    if (!response?.ok) { setMessage("회원 정보를 저장하지 못했습니다."); return; }
    setProfile((await response.json()) as SessionUser);
    await refresh();
    setMessage("회원 정보를 저장했습니다.");
    setOpen(false);
  }
  return (
    <section>
      <p className="meta">ACCOUNT</p>
      <h3>계정과 알림</h3>
      <div className="account-summary">
        {profile.imageUrl ? <Image src={media(profile.imageUrl, 112)} alt="" width={56} height={56} unoptimized /> : <span className="account-initial">{profile.name.slice(0, 1)}</span>}
        <div>
          <strong>{profile.name}</strong>
          <span>{profile.email}</span>
        </div>
      </div>
      {open ? (
        <div className="account-editor">
          <label>이름<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <ImageUploadField purpose="profile" label="프로필 사진" value={imageUrl} onChange={setImageUrl} />
          <label>
            소개말
            <AutoTextarea
              value={introduction}
              maxLength={400}
              minRows={3}
              placeholder="부원 페이지에서 내 카드를 눌렀을 때 보일 소개말입니다. 어떤 걸 하고 있는지 편하게 적어 주세요."
              onChange={setIntroduction}
            />
            <small className="field-hint">{introduction.length}/400 · 사진과 소개말은 공개 부원 페이지에 그대로 보입니다.</small>
          </label>
          <div className="inline-actions">
            <button className="button small" type="button" onClick={save}>저장</button>
            <button className="button secondary small" type="button" onClick={() => setOpen(false)}>취소</button>
          </div>
        </div>
      ) : (
        <>
          {profile.introduction && <p className="account-intro">{profile.introduction}</p>}
          <button type="button" onClick={() => setOpen(true)}><Check size={16} />이름 · 사진 · 소개말 설정</button>
        </>
      )}
      {message && <p className="form-note">{message}</p>}
    </section>
  );
}

function NoticeAlerts() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pushMessage, setPushMessage] = useState("");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void call("/notifications", { signal: controller.signal })
      .then(async (response) => setItems(response.ok ? ((await response.json()) as NotificationItem[]) : []))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let active = true;
    // `currentSubscription` already resolves to null where push is unsupported.
    void currentSubscription().then((value) => { if (active) setSubscribed(Boolean(value)); });
    return () => { active = false; };
  }, []);
  async function markRead() {
    if (!(await call("/notifications/read", { method: "POST" }).catch(() => null))?.ok) return;
    setItems((current) => current?.map((item) => ({ ...item, isRead: true })) ?? current);
  }
  async function togglePush() {
    setPushMessage(subscribed ? await unsubscribeFromNotices() : await subscribeToNotices());
    setSubscribed(Boolean(await currentSubscription()));
  }
  const unread = items?.filter((item) => !item.isRead).length ?? 0;
  return (
    <section className="mypage-alerts">
      <div className="mypage-section-head">
        <div><p className="meta">NOTIFICATIONS</p><h3>새 공지 알림{unread > 0 ? ` (${unread})` : ""}</h3></div>
        {unread > 0 && <button type="button" className="text-button" onClick={markRead}>모두 읽음</button>}
      </div>
      <button className="button secondary small push-toggle" type="button" disabled={subscribed === null} onClick={togglePush}>
        <BellRing size={15} />{subscribed ? "브라우저 알림 끄기" : "브라우저 알림 받기"}
      </button>
      {pushMessage && <p className="form-note">{pushMessage}</p>}
      {items === null ? (
        <p className="form-note">알림을 불러오는 중입니다.</p>
      ) : items.length ? (
        <ul className="alert-list">
          {items.slice(0, 8).map((item) => (
            <li key={item.id} className={item.isRead ? "" : "unread"}>
              <Link href="/notices">{item.title}</Link>
              <time>{stamp.format(new Date(item.createdAt))}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">아직 받은 알림이 없습니다.</p>
      )}
    </section>
  );
}

function MyProjects() {
  const [items, setItems] = useState<RoadmapItem[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void call("/roadmap/me", { signal: controller.signal })
      .then(async (response) => setItems(response.ok ? ((await response.json()) as RoadmapItem[]) : []))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);
  return (
    <section className="mypage-projects">
      <div className="mypage-section-head">
        <div><p className="meta">PROJECTS</p><h3>참여 중인 프로젝트</h3></div>
        <Link href="/roadmap">로드맵 <ChevronRight size={15} /></Link>
      </div>
      {items === null ? (
        <p className="form-note">프로젝트 정보를 불러오는 중입니다.</p>
      ) : items.length ? (
        <ul className="project-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className={`board-category ${item.category === "대회" ? "정보" : item.category === "교육" ? "질문" : "공지"}`}>{item.category}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.description || "설명이 아직 없습니다."}</p>
              </div>
              <time>
                {span.format(new Date(item.startsAt))}
                {item.endsAt ? ` — ${span.format(new Date(item.endsAt))}` : ""}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">배정된 프로젝트가 없습니다. 운영진이 로드맵에서 참여 부원을 지정하면 여기에 표시됩니다.</p>
      )}
    </section>
  );
}

function MyPagePanel({ session }: { session: SessionUser }) {
  const [reservations, setReservations] = useState<ReservationItem[] | null>(null);
  const [permissions, setPermissions] = useState<EquipmentPermission[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void call("/reservations/me", { signal: controller.signal })
      .then(async (response) => setReservations(response.ok ? ((await response.json()) as ReservationItem[]) : isPreview ? previewReservations : []))
      .catch(() => setReservations(isPreview ? previewReservations : []));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void call("/equipment-permissions", { signal: controller.signal })
      .then(async (response) => setPermissions(response.ok ? ((await response.json()) as EquipmentPermission[]) : []))
      .catch(() => setPermissions([]));
    return () => controller.abort();
  }, []);
  const replace = useCallback((next: ReservationItem) => {
    setReservations((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? current);
  }, []);
  const items = reservations ?? [];
  const confirmed = items.filter((item) => item.status === "APPROVED" || item.status === "IN_USE").length;
  const completed = items.filter((item) => item.status === "COMPLETED").length;
  return (
    <div className="mypage">
      {isPreview && <p className="demo-ribbon">개발 서버에서는 실제 로그인 전에도 예시 마이페이지가 표시됩니다.</p>}
      <section className="mypage-hero">
        <div><p className="meta">MY SHAPE</p><h3>{session.name}님, 안녕하세요.</h3><p>예약, 장비 사용 권한, SHAPE 활동 정보를 한곳에서 확인하세요.</p></div>
        <Link href="/equipment/reserve" className="button"><CalendarClock size={17} />새 장비 예약</Link>
      </section>
      <div className="mypage-stats">
        <article><CalendarClock /><strong>{confirmed}</strong><span>다가오는 예약</span></article>
        <article><ShieldCheck /><strong>{permissions?.filter((item) => item.eligible).length ?? "–"}</strong><span>보유 장비 권한</span></article>
        <article><ClipboardCheck /><strong>{completed}</strong><span>완료한 사용 기록</span></article>
      </div>
      <div className="mypage-grid">
        <section className="mypage-reservations">
          <div className="mypage-section-head">
            <div><p className="meta">RESERVATIONS</p><h3>내 예약</h3></div>
            <Link href="/equipment/reserve">예약하기 <ChevronRight size={15} /></Link>
          </div>
          {reservations === null ? (
            <p className="form-note">예약 정보를 불러오는 중입니다.</p>
          ) : items.length ? (
            <div className="my-reservation-list">
              {items.map((item) => <ReservationCard key={item.id} reservation={item} onChange={replace} />)}
            </div>
          ) : (
            <p className="empty-inline">아직 신청한 예약이 없습니다.</p>
          )}
          <MyProjects />
        </section>
        <aside className="mypage-side">
          <section>
            <p className="meta">MY LICENSE</p>
            <h3>보유 라이선스</h3>
            {session.licenses.length ? (
              <ul className="license-holdings">
                {session.licenses.map((license) => (
                  <li key={license}>
                    <span>{license}</span>
                    <LicenseCard name={license} eligible />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">아직 이수한 교육이 없습니다. 운영진의 교육을 이수하면 라이선스 카드가 발급됩니다.</p>
            )}
            <p className="meta license-divider">EQUIPMENT</p>
            <h3>장비별 사용 가능 여부</h3>
            <ul>
              {permissions === null ? (
                <li><span>권한 정보를 불러오는 중입니다.</span></li>
              ) : permissions.length ? permissions.map((item) => (
                <li key={item.equipmentId}>
                  <div>
                    <span>{item.name}</span>
                    <small className="permission-note">{permissionNote(item)}</small>
                  </div>
                  <b className={item.eligible ? "" : "denied"}>{item.eligible ? "사용 가능" : "사용 불가"}</b>
                </li>
              )) : <li><span>등록된 장비가 아직 없습니다.</span></li>}
            </ul>
            <Link href="/equipment">장비 목록 보기 <ChevronRight size={15} /></Link>
          </section>
          <NoticeAlerts />
          <ProfileCard session={session} />
        </aside>
      </div>
    </div>
  );
}

export default function MyPage() {
  return <PageShell eyebrow="MY SHAPE" title="마이페이지"><AuthGate localPreview>{(session) => <MyPagePanel session={session} />}</AuthGate></PageShell>;
}
