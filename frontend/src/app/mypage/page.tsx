"use client";

import Link from "next/link";
import Image from "next/image";
import { BellRing, CalendarClock, Check, ChevronRight, ClipboardCheck, Clock3, Eye, ShieldCheck, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { AutoTextarea } from "@/components/auto-textarea";
import { useAsk } from "@/components/ask-dialog";
import { PageShell } from "@/components/page-shell";
import { ImageUploadField } from "@/components/image-upload-field";
import { ReservationPhotoStep } from "@/components/reservation-photo-step";
import { LicenseCard } from "@/components/license-card";
import { API_URL } from "@/lib/api";
import { MyUsagePanel } from "@/components/my-usage";
import { CLOCK_OPTIONS, confirmNotice, purposeLabel, seoulDayOfMonth, seoulMonth, unitTitle, urgencyLabel } from "@/lib/booking";
import { media, optimizable } from "@/lib/media";
import { clearUnread } from "@/lib/notifications";
import { loadSession, useSession } from "@/lib/session";
import { appleDevice, currentSubscription, installedToHomeScreen, pushSupported, subscribeToNotices, unsubscribeFromNotices } from "@/lib/push";
import type { MemberCardItem, MemberCardState, NotificationItem, ReservationItem, RoadmapItem, SessionUser } from "@/lib/types";

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
  ACTIVE: "", MAINTENANCE: "점검 중", INACTIVE: "예약 불가",
};

/** 왜 못 쓰는지까지 한 줄로 알려 준다. 교육 미이수와 장비 상태는 다른 문제다. */
function permissionNote(item: EquipmentPermission) {
  if (item.eligible) return "사용 가능";
  if (!item.licensed) return `교육 필요: ${item.missingLicenses.join(", ")}`;
  return equipmentStatusNote[item.status] || "사용 불가";
}

const statusLabel: Record<ReservationItem["status"], string> = { PENDING: "승인 대기", APPROVED: "예약 확정", REJECTED: "반려", CANCELLED: "취소", IN_USE: "사용 중", COMPLETED: "사용 완료", EXPIRED: "기간 지남" };
// 예약 시각은 어디서나 24시간제입니다(`lib/booking.ts` 의 `CLOCK_OPTIONS`).
const clock = new Intl.DateTimeFormat("ko-KR", CLOCK_OPTIONS);
const stamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", ...CLOCK_OPTIONS });
/** 마이페이지에 바로 보여 주는 알림 수. 나머지는 '전체 보기' 팝업에서 봅니다. */
const PREVIEW = 8;
/** 서버가 한 쪽에 담아 주는 알림 수. 백엔드의 `NOTIFICATION_PAGE` 와 같아야 합니다. */
const ALERT_PAGE = 50;

const span = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" });

async function call(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store", ...init });
}

/**
 * 아직 차례가 아닌 예약에도 다음에 무엇을 해야 하는지 알려 준다.
 *
 * 대기 중인 신청에는 **언제 확정되는지를 시각으로** 적는다. "같은 시간에 다른
 * 신청이 없으면 시작 한 시간 전에 저절로 확정됩니다" 는 규칙일 뿐, 내 신청이
 * 어느 쪽인지는 말해 주지 않는다. 겹쳤는지는 내 예약 목록만으로는 알 수 없어
 * 서버가 판정해 `autoConfirmAt`·`contested` 로 알려 준다.
 */
function ReservationNextStep({ reservation }: { reservation: ReservationItem }) {
  if (reservation.status === "PENDING")
    return (
      <p className={`reservation-hint${reservation.contested ? " warn" : ""}`}>
        {confirmNotice(reservation.autoConfirmAt, reservation.contested)}
        {reservation.contested
          ? " 신청서의 ‘기타 내용’ 이 판단에 쓰입니다."
          : " 확정되면 이 자리에서 사용 전 사진을 올리고 시작할 수 있습니다."}
      </p>
    );
  if (reservation.status === "EXPIRED")
    return <p className="reservation-hint">신청한 시간이 지나 자동으로 만료되었습니다. 다시 쓰시려면 새로 신청해 주세요.</p>;
  return null;
}

/** 예약 카드에 붙는 분류·시급도 딱지. 무엇을 위한 예약인지 한눈에 보입니다. */
function ReservationTags({ reservation }: { reservation: ReservationItem }) {
  return (
    <ul className="reservation-tags">
      <li className="purpose-chip">{purposeLabel(reservation.purposeCategory)}</li>
      <li className="urgency-badge" data-level={reservation.urgency ?? "NORMAL"}>{urgencyLabel(reservation.urgency)}</li>
      {reservation.autoDecidedAt && <li className="auto-chip">자동 확정</li>}
    </ul>
  );
}

function ReservationCard({ reservation, onChange }: { reservation: ReservationItem; onChange: (next: ReservationItem) => void }) {
  const { ask, dialogNode } = useAsk();
  const [message, setMessage] = useState("");
  const starts = new Date(reservation.startsAt);
  const cancellable = reservation.status === "PENDING" || reservation.status === "APPROVED";
  async function cancel() {
    const confirmed = await ask({
      title: "예약을 취소할까요?",
      description: `${unitTitle(reservation.equipmentName, reservation.unitLabel)} · ${stamp.format(starts)} 예약을 취소합니다. 취소하면 그 시간이 다른 회원에게 다시 열립니다.`,
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
        {/* 날짜 배지도 서울 기준입니다. 옆의 시각이 서울인데 이것만
            현지 날짜면 자정 근처 예약에서 하루가 어긋납니다. */}
        <strong>{seoulDayOfMonth(starts)}</strong>
        <span>{seoulMonth(starts)}</span>
      </div>
      <div className="reservation-body">
        <h4>{unitTitle(reservation.equipmentName, reservation.unitLabel)}</h4>
        <p><Clock3 size={14} />{clock.format(starts)} – {clock.format(new Date(reservation.endsAt))}</p>
        <ReservationTags reservation={reservation} />
        {reservation.note && <p className="reservation-note">{reservation.note}</p>}
        {/* 함께 쓰는 사람이 있으면 누구인지 보여 줍니다. */}
        {reservation.companions && reservation.companions.length > 0 && (
          <p className="reservation-companions"><Users size={14} /> 함께 쓰는 부원: {reservation.companions.join(", ")}</p>
        )}
        {reservation.rejectionReason && <p className="reservation-reason">사유: {reservation.rejectionReason}</p>}
        {(reservation.status === "APPROVED" || reservation.status === "IN_USE") ? (
          <ReservationPhotoStep reservation={reservation} onDone={onChange} />
        ) : (
          <ReservationNextStep reservation={reservation} />
        )}
        {(reservation.beforePhotoUrl || reservation.afterPhotoUrl) && (
          <div className="reservation-photos">
            {reservation.beforePhotoUrl && <figure><a href={reservation.beforePhotoUrl} target="_blank" rel="noreferrer"><Image src={media(reservation.beforePhotoUrl, 400)} alt="사용 전 사진" width={320} height={220} unoptimized={!optimizable(reservation.beforePhotoUrl)} /></a><figcaption>사용 전</figcaption></figure>}
            {reservation.afterPhotoUrl && <figure><a href={reservation.afterPhotoUrl} target="_blank" rel="noreferrer"><Image src={media(reservation.afterPhotoUrl, 400)} alt="사용 후 사진" width={320} height={220} unoptimized={!optimizable(reservation.afterPhotoUrl)} /></a><figcaption>사용 후</figcaption></figure>}
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

/**
 * 내 부원 카드.
 *
 * 부원 페이지의 카드와 구글 계정은 원래 따로 놀았습니다. 운영진이 마흔 장을
 * 하나씩 맞춰 주는 대신, 각자 로그인해서 자기 카드를 집습니다. 이름이 같은
 * 카드만 후보로 나오고, 집으면 카드 사진이 내 프로필 사진이 됩니다.
 */
const EMPTY_CARD_STATE: MemberCardState = { card: null, candidates: [], available: [], myName: "" };

function MyMemberCard({ onProfile }: { onProfile: (user: SessionUser) => void }) {
  const [state, setState] = useState<MemberCardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // 이름이 안 맞아 후보가 안 뜨는 경우가 있어, 비어 있는 카드에서 직접 고르는 길.
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void call("/auth/me/member-card", { signal: controller.signal })
      .then(async (response) => setState(response.ok ? ((await response.json()) as MemberCardState) : EMPTY_CARD_STATE))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function claim(cardId: string) {
    setBusy(true);
    const response = await call("/auth/me/member-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const detail = (await response?.json().catch(() => null)) as { detail?: string } | null;
      setMessage(detail?.detail ?? "카드를 연결하지 못했습니다.");
      return;
    }
    setState((await response.json()) as MemberCardState);
    setPicking(false);
    setQuery("");
    // 카드 사진을 계정 사진으로 삼았을 수 있다. 옆의 계정 칸까지 같이 새로 읽는다.
    const user = await loadSession(true);
    if (user) onProfile(user);
    setMessage("내 부원 카드로 연결했습니다. 이제 부원 페이지의 이 카드에 내 사진과 소개말이 나옵니다.");
  }

  /**
   * 명단에 내 카드가 없을 때, 내 계정으로 카드를 새로 만듭니다.
   * 새로 가입한 부원은 고를 카드가 아예 없습니다.
   */
  async function createMine() {
    setBusy(true);
    const response = await call("/auth/me/member-card/new", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setMessage("카드를 만들지 못했습니다."); return; }
    setState((await response.json()) as MemberCardState);
    setPicking(false);
    const user = await loadSession(true);
    if (user) onProfile(user);
    setMessage("부원 페이지에 내 카드가 만들어졌습니다. 사진과 소개말은 아래 '계정과 알림' 에서 바꾸면 카드에도 함께 반영됩니다.");
  }

  async function release() {
    setBusy(true);
    const response = await call("/auth/me/member-card", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setMessage("연결을 해제하지 못했습니다."); return; }
    setState((await response.json()) as MemberCardState);
    setMessage("연결을 해제했습니다. 명단에 있던 카드는 그대로 남고, 내 계정으로 만든 카드는 함께 지워집니다.");
  }

  if (state === null) return null;
  const free = state.available.filter((card) =>
    `${card.name} ${card.role}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const row = (card: MemberCardItem, label: string) => (
    <li key={card.id}>
      {card.imageUrl
        ? <Image src={media(card.imageUrl, 110, "eco")} alt="" width={44} height={44} unoptimized={!optimizable(card.imageUrl)} />
        : <span className="account-initial">{card.name.slice(0, 1)}</span>}
      <div>
        <strong>{card.name}</strong>
        <span>{[card.membership, card.role].filter(Boolean).join(" · ")}</span>
      </div>
      <button type="button" className="button small" disabled={busy} onClick={() => void claim(card.id)}>
        {label}
      </button>
    </li>
  );
  return (
    <section className="my-member-card">
      <p className="meta">MEMBER CARD</p>
      <h3>내 부원 카드</h3>
      {state.card ? (
        <>
          <div className="card-link">
            {state.card.imageUrl
              ? <Image src={media(state.card.imageUrl, 130, "eco")} alt="" width={56} height={56} unoptimized={!optimizable(state.card.imageUrl)} />
              : <span className="account-initial">{state.card.name.slice(0, 1)}</span>}
            <div>
              <strong>{state.card.name}</strong>
              <span>{[state.card.membership, state.card.role].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <p className="form-note">
            부원 페이지의 이 카드에 <b>내 사진과 소개말</b>이 나옵니다. 아래 <b>‘계정과 알림’</b> 에서 바꾸면
            부원 페이지에도 함께 반영됩니다. 이름·팀·역할은 운영진이 관리합니다.
          </p>
          <button type="button" className="text-button danger" disabled={busy} onClick={() => void release()}>
            연결 해제
          </button>
        </>
      ) : (
        <>
          {state.candidates.length > 0 && (
            <>
              <p className="form-note">이름이 같은 부원 카드를 찾았습니다. 내 카드가 맞으면 연결해 주세요.</p>
              <ul className="card-candidates">{state.candidates.map((card) => row(card, "내 카드입니다"))}</ul>
            </>
          )}
          {state.candidates.length === 0 && (
            <p className="form-note">
              아직 연결된 부원 카드가 없습니다. <b>새로 가입했다면 아래에서 카드를 만들면 됩니다.</b>
              이름·사진·소개말은 이 계정에서 그대로 가져오고, 팀과 역할은 운영진이 채웁니다.
              이전 학기부터 활동해 <b>명단에 이미 내 카드가 있다면</b> 그 카드를 골라 연결해 주세요.
              (내 계정 이름은 <b>{state.myName}</b> 입니다. 카드에 적힌 이름과 다르면 이름이 같은 카드로 추천되지 않습니다.)
            </p>
          )}
          {/* 고를 카드가 있든 없든 '만들기' 는 늘 열어 둡니다. 이름이 같은 카드가
              떠도 그것이 내 카드가 아닐 수 있습니다. */}
          <div className="card-make">
            <button type="button" className="button" disabled={busy} onClick={() => void createMine()}>
              내 계정으로 부원 카드 만들기
            </button>
            <small className="field-hint">새로 가입한 부원은 이 길로 가면 됩니다.</small>
          </div>
          {picking || state.candidates.length === 0 ? (
            state.available.length ? (
              <div className="card-chooser">
                <input
                  type="search"
                  value={query}
                  placeholder="이름이나 역할로 카드 찾기"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <ul className="card-candidates">{free.slice(0, 8).map((card) => row(card, "이 카드"))}</ul>
                {free.length > 8 && <p className="field-hint">{free.length - 8}장 더 있습니다. 이름을 입력해 좁혀 주세요.</p>}
                {free.length === 0 && <p className="empty-inline">찾는 이름의 빈 카드가 없습니다.</p>}
                <p className="field-hint">
                  아직 아무도 연결하지 않은 카드만 보입니다. 한 카드에는 한 사람만 연결할 수 있습니다.
                  <b> 내 카드가 맞는지 확인하고</b> 눌러 주세요. 내 카드가 없으면 위에서 새로 만들면 됩니다.
                </p>
              </div>
            ) : (
              <p className="empty-inline">명단에 비어 있는 카드가 없습니다. 위에서 내 카드를 새로 만들어 주세요.</p>
            )
          ) : (
            <button type="button" className="text-button" onClick={() => setPicking(true)}>
              내 카드가 목록에 없어요 · 직접 고르기
            </button>
          )}
        </>
      )}
      {message && <p className="form-note">{message}</p>}
    </section>
  );
}

function ProfileCard({ profile, onProfile }: { profile: SessionUser; onProfile: (user: SessionUser) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.name);
  const [imageUrl, setImageUrl] = useState(profile.imageUrl ?? "");
  const [introduction, setIntroduction] = useState(profile.introduction ?? "");
  const [message, setMessage] = useState("");
  async function save() {
    if (!name.trim()) { setMessage("이름을 입력해 주세요."); return; }
    const response = await call("/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), imageUrl: imageUrl || null, introduction: introduction.trim() || null }),
    }).catch(() => null);
    if (!response?.ok) { setMessage("회원 정보를 저장하지 못했습니다."); return; }
    onProfile((await response.json()) as SessionUser);
    await loadSession(true);
    setMessage("회원 정보를 저장했습니다.");
    setOpen(false);
  }
  return (
    <section>
      <p className="meta">ACCOUNT</p>
      <h3>계정과 알림</h3>
      <div className="account-summary">
        {profile.imageUrl ? <Image src={media(profile.imageUrl, 130, "eco")} alt="" width={56} height={56} unoptimized={!optimizable(profile.imageUrl)} /> : <span className="account-initial">{profile.name.slice(0, 1)}</span>}
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
          <button
            type="button"
            onClick={() => {
              setName(profile.name);
              setImageUrl(profile.imageUrl ?? "");
              setIntroduction(profile.introduction ?? "");
              setOpen(true);
            }}
          >
            <Check size={16} />이름 · 사진 · 소개말 설정
          </button>
        </>
      )}
      {message && <p className="form-note">{message}</p>}
    </section>
  );
}

function NoticeAlerts() {
  const { session } = useSession();
  // 공지 알림은 활동 중인 회원에게만 갑니다.
  const readOnly = session?.status === "VIEWER";
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  /**
   * 더 받아 올 것이 남았는지, 그리고 **전체가 몇 건인지.**
   *
   * 예전에는 받아 온 만큼을 세어 "알림 50건 전체 보기" 라고 적었습니다. 서버가
   * 50건에서 끊었으므로 실제로 200건이 쌓여 있어도 **영영 50이라고
   * 말했습니다.** 지금은 이어받기로 정말 전부를 받아 옵니다.
   */
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  // 알림이 쌓여도 마이페이지가 길어지지 않도록, 앞의 몇 개만 놓고 나머지는 팝업에서 봅니다.
  const [allOpen, setAllOpen] = useState(false);
  const allDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (allOpen && allDialog.current && !allDialog.current.open) allDialog.current.showModal();
  }, [allOpen]);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void call("/notifications", { signal: controller.signal })
      .then(async (response) => {
        const rows = response.ok ? ((await response.json()) as NotificationItem[]) : [];
        setItems(rows);
        setMore(rows.length >= ALERT_PAGE);
      })
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);

  /**
   * 다음 쪽을 이어 받습니다.
   *
   * 시각만으로 끊지 않고 `beforeId` 를 함께 보내는 것이 중요합니다. 공지 하나를
   * 올리면 회원 전원의 알림이 한 트랜잭션에서 만들어져 **시각이 모두 같기**
   * 때문에, 시각만으로 끊으면 그 경계의 알림이 통째로 사라집니다.
   */
  async function loadOlder() {
    const last = items?.[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const query = new URLSearchParams({ before: last.createdAt, beforeId: last.id });
    const response = await call(`/notifications?${query}`).catch(() => null);
    setLoadingMore(false);
    if (!response?.ok) return;
    const rows = (await response.json()) as NotificationItem[];
    setMore(rows.length >= ALERT_PAGE);
    setItems((current) => {
      const seen = new Set((current ?? []).map((item) => item.id));
      return [...(current ?? []), ...rows.filter((item) => !seen.has(item.id))];
    });
  }
  useEffect(() => {
    let active = true;
    // `currentSubscription` already resolves to null where push is unsupported.
    void currentSubscription().then((value) => { if (active) setSubscribed(Boolean(value)); });
    return () => { active = false; };
  }, []);
  async function markRead() {
    if (!(await call("/notifications/read", { method: "POST" }).catch(() => null))?.ok) return;
    setItems((current) => current?.map((item) => ({ ...item, isRead: true })) ?? current);
    // 머리글의 배지도 그 자리에서 지웁니다. 이것이 없으면 세어 둔 값이
    // 다음 창까지 남아, 다 읽었는데도 점이 계속 떠 있습니다.
    clearUnread();
  }
  async function togglePush() {
    setPushMessage(subscribed ? await unsubscribeFromNotices() : await subscribeToNotices());
    setSubscribed(Boolean(await currentSubscription()));
  }
  // 아이폰은 홈 화면에 추가한 상태에서만 알림을 받을 수 있습니다. 그냥 사파리에서
  // 누르면 아무 일도 일어나지 않으므로, 먼저 무엇을 해야 하는지 알려 줍니다.
  const needsInstall = appleDevice() && !installedToHomeScreen();
  const unread = items?.filter((item) => !item.isRead).length ?? 0;
  return (
    <section className="mypage-alerts">
      <div className="mypage-section-head">
        <div><p className="meta">NOTIFICATIONS</p><h3>새 공지 알림{unread > 0 ? ` (${unread})` : ""}</h3></div>
        {unread > 0 && <button type="button" className="text-button" onClick={markRead}>모두 읽음</button>}
      </div>
      {/* 공지 알림은 활동 중인 회원에게만 갑니다. 보기 전용 계정에는 켜 두어도
          올 것이 없으므로 단추를 두지 않습니다. */}
      {readOnly ? (
        <p className="read-only-note"><Eye size={15} /> 보기 전용 계정에는 공지 알림이 발송되지 않습니다.</p>
      ) : (
      <>
      {/* 켜졌는지 글씨로만 알려 주면 눈에 들어오지 않습니다. 켜져 있으면 단추
          자체가 파랗게 채워지고, 꺼져 있으면 테두리만 남습니다. */}
      {needsInstall ? (
        <p className="read-only-note">
          <BellRing size={15} /> 아이폰은 <b>홈 화면에 추가한 뒤</b>에만 알림을 받을 수 있습니다.
          공유 → ‘홈 화면에 추가’ 를 먼저 해 주세요.
        </p>
      ) : (
        <button
          className={`button small push-toggle${subscribed ? " on" : " secondary"}`}
          type="button"
          disabled={subscribed === null}
          aria-pressed={subscribed === true}
          onClick={togglePush}
        >
          <BellRing size={15} />
          {subscribed === null ? "알림 설정 확인 중" : subscribed ? "브라우저 알림 켜짐" : "브라우저 알림 받기"}
        </button>
      )}
      {pushMessage && <p className="form-note">{pushMessage}</p>}
      </>
      )}
      {items === null ? (
        <p className="form-note">알림을 불러오는 중입니다.</p>
      ) : items.length ? (
        <>
        <ul className="alert-list">
          {items.slice(0, PREVIEW).map((item) => (
            <li key={item.id} className={item.isRead ? "" : "unread"}>
              {/* 게시판 공지는 게시판으로, 예약 신청 알림은 관리자 화면으로 갑니다. */}
              <Link href={item.url || "/notices"}>{item.title}</Link>
              <time>{stamp.format(new Date(item.createdAt))}</time>
            </li>
          ))}
        </ul>
        {/* 알림이 쌓이면 이 자리에 다 담을 수 없습니다. 앞의 몇 개만 보여 주고
            나머지는 팝업에서 봅니다. */}
        {(items.length > PREVIEW || more) && (
          <button type="button" className="text-button alert-more" onClick={() => setAllOpen(true)}>
            알림 {items.length}{more ? "건 이상" : "건"} 전체 보기
          </button>
        )}
        </>
      ) : (
        <p className="empty-inline">아직 받은 알림이 없습니다.</p>
      )}
      {allOpen && items && (
        <dialog className="alert-dialog" ref={allDialog} onClose={() => setAllOpen(false)} onClick={(event) => { if (event.target === allDialog.current) allDialog.current?.close(); }}>
          <article>
            <header>
              <div>
                <p className="meta">NOTIFICATIONS</p>
                {/* 아직 더 받아 올 것이 남았으면 그렇다고 적습니다. 받아 온 만큼을
                    "전부" 라고 말하면 그것이 곧 거짓말이 됩니다. */}
                <h3>받은 알림 {items.length}건{more ? " 이상" : ""}</h3>
              </div>
              <button type="button" className="dialog-close" aria-label="닫기" onClick={() => allDialog.current?.close()}>
                <X />
              </button>
            </header>
            <ul className="alert-list">
              {items.map((item) => (
                <li key={item.id} className={item.isRead ? "" : "unread"}>
                  <Link href={item.url || "/notices"}>{item.title}</Link>
                  <time>{stamp.format(new Date(item.createdAt))}</time>
                </li>
              ))}
            </ul>
            {more && (
              <button type="button" className="button secondary board-more" disabled={loadingMore} onClick={() => void loadOlder()}>
                {loadingMore ? "불러오는 중…" : "이전 알림 더 보기"}
              </button>
            )}
          </article>
        </dialog>
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
  // 위의 로그인 문지기는 처음 읽은 회원 정보를 그대로 들고 있다. 이름·사진을
  // 고치거나 부원 카드를 연결하면 바뀐 값을 여기에 담아 곧바로 보여 준다.
  const [profile, setProfile] = useState(session);
  const [reservations, setReservations] = useState<ReservationItem[] | null>(null);
  const [permissions, setPermissions] = useState<EquipmentPermission[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void call("/reservations/me", { signal: controller.signal })
      .then(async (response) => setReservations(response.ok ? ((await response.json()) as ReservationItem[]) : []))
      .catch(() => setReservations([]));
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
  // 예약은 학기가 지나면 계속 쌓입니다. 지금 손을 써야 하는 것(대기·확정·사용 중)을
  // 먼저 보여 주고, 끝난 기록은 접어 두었다가 펼쳐 봅니다.
  const live = items.filter((item) => item.status === "PENDING" || item.status === "APPROVED" || item.status === "IN_USE");
  const done = items.filter((item) => item.status === "COMPLETED" || item.status === "REJECTED" || item.status === "CANCELLED");
  return (
    <div className="mypage">
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
            <>
              {live.length ? (
                <div className="my-reservation-list">
                  {live.map((item) => <ReservationCard key={item.id} reservation={item} onChange={replace} />)}
                </div>
              ) : (
                <p className="empty-inline">진행 중인 예약이 없습니다.</p>
              )}
              {done.length > 0 && (
                <details className="reservation-history">
                  <summary>지난 예약 기록 {done.length}건 모두 보기</summary>
                  <div className="my-reservation-list">
                    {done.map((item) => <ReservationCard key={item.id} reservation={item} onChange={replace} />)}
                  </div>
                </details>
              )}
            </>
          ) : (
            <p className="empty-inline">아직 신청한 예약이 없습니다.</p>
          )}
          <MyUsagePanel />
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
          <ProfileCard profile={profile} onProfile={setProfile} />
          <MyMemberCard onProfile={setProfile} />
        </aside>
      </div>
    </div>
  );
}

export default function MyPage() {
  return <PageShell eyebrow="MY SHAPE" title="마이페이지"><AuthGate localPreview>{(session) => <MyPagePanel session={session} />}</AuthGate></PageShell>;
}
