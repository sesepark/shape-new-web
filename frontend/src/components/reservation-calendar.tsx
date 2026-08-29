"use client";

import { CalendarDays, Camera, ChevronLeft, ChevronRight, Clock3, ShieldAlert, User, Users, Wrench, X } from "lucide-react";
import Image from "next/image";
import { media, optimizable } from "@/lib/media";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { board } from "@/lib/board";
import { CLOCK_OPTIONS, purposeLabel, unitTitle, urgencyLabel } from "@/lib/booking";
import { ReservationPhotoStep } from "@/components/reservation-photo-step";
import { useSession } from "@/lib/session";
import { API_URL } from "@/lib/api";
import type { BlackoutSpan, ReservationCalendarItem, ReservationStatus } from "@/lib/types";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const statusLabel: Record<ReservationStatus, string> = {
  PENDING: "승인 대기", APPROVED: "예약 확정", IN_USE: "사용 중",
  COMPLETED: "사용 완료", REJECTED: "반려", CANCELLED: "취소", EXPIRED: "기간 지남",
};
// 예약 시각은 어디서나 24시간제입니다(`lib/booking.ts` 의 `CLOCK_OPTIONS`).
const clock = new Intl.DateTimeFormat("ko-KR", CLOCK_OPTIONS);
const fullDate = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const range = (item: { startsAt: string; endsAt: string }) => `${clock.format(new Date(item.startsAt))} – ${clock.format(new Date(item.endsAt))}`;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Every day the booking touches, so a multi-day reservation shows on each one. */
function daysCovered(item: { startsAt: string; endsAt: string }) {
  const days: string[] = [];
  const cursor = new Date(item.startsAt);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(item.endsAt);
  while (cursor <= last) {
    days.push(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function ReservationCalendarView() {
  const { session } = useSession();
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [items, setItems] = useState<ReservationCalendarItem[] | null>(null);
  // 운영진이 막아 둔 시간. 예약과 따로 받습니다 — 로그인 없이도 열리는 공개
  // 창구이고, 예약 목록의 응답 모양을 바꾸면 배포 중 한쪽만 올라간 순간에
  // 달력이 통째로 깨집니다.
  const [blocked, setBlocked] = useState<BlackoutSpan[]>([]);
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<ReservationCalendarItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (active && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [active]);

  function close() {
    dialog.current?.close();
    setActive(null);
  }

  const load = useCallback(async () => {
    setItems(null);
    // 막힌 시간은 못 받아 와도 달력은 그립니다. 예약이 본문이고 이것은 덧붙임입니다.
    const blocking = fetch(`${API_URL}/equipment/blackouts?month=${monthKey(month)}`)
      .then(async (answer) => (answer.ok ? ((await answer.json()) as BlackoutSpan[]) : []))
      .catch(() => [] as BlackoutSpan[]);
    const response = await board(`/reservations/calendar?month=${monthKey(month)}`);
    setBlocked(await blocking);
    if (!response.ok) {
      setMessage(response.status === 401 || response.status === 403 ? "승인된 회원만 예약 현황을 볼 수 있습니다." : "예약 현황을 불러오지 못했습니다.");
      setItems([]);
      return;
    }
    setMessage("");
    setItems((await response.json()) as ReservationCalendarItem[]);
  }, [month]);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  /**
   * 장비 종류마다 고정 색을 준다.
   *
   * 예전에는 예약 상태(대기·확정·사용 중·완료)로만 색이 갈렸다. 한 달 화면에
   * 여러 장비가 섞여 있으면 어느 줄이 같은 장비인지 알 수 없었다. 색은 장비가
   * 가져가고, 상태는 아래 CSS 에서 채움·점선으로 구분한다.
   *
   * 이름 순으로 번호를 매기므로, 예약이 생기고 없어져도 같은 장비는 늘 같은 색이다.
   */
  const tone = useMemo(() => {
    const names = [...new Set((items ?? []).map((item) => item.equipmentName))].sort();
    return new Map(names.map((name, index) => [name, index % 8]));
  }, [items]);

  const byDay = useMemo(() => {
    const map = new Map<string, ReservationCalendarItem[]>();
    for (const item of items ?? []) {
      for (const day of daysCovered(item)) {
        map.set(day, [...(map.get(day) ?? []), item]);
      }
    }
    // 같은 날에 여러 건이면 위에서부터 시간순으로 읽히게 한다. 시작이 같으면
    // 짧은 것을 먼저, 그다음 장비 이름 순으로 자리를 고정한다.
    for (const [day, rows] of map) {
      map.set(day, [...rows].sort((a, b) =>
        Date.parse(a.startsAt) - Date.parse(b.startsAt)
        || Date.parse(a.endsAt) - Date.parse(b.endsAt)
        || a.equipmentName.localeCompare(b.equipmentName, "ko")
        || (a.unitLabel ?? "").localeCompare(b.unitLabel ?? "", "ko")));
    }
    return map;
  }, [items]);

  /** 날짜별 막힌 시간. 예약과 같은 열쇠를 써서 한 칸 안에 나란히 놓습니다. */
  const blockedByDay = useMemo(() => {
    const map = new Map<string, BlackoutSpan[]>();
    for (const span of blocked) {
      for (const day of daysCovered(span)) map.set(day, [...(map.get(day) ?? []), span]);
    }
    for (const [day, rows] of map) {
      map.set(day, [...rows].sort((a, b) =>
        Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.equipmentName.localeCompare(b.equipmentName, "ko")));
    }
    return map;
  }, [blocked]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: total }, (_, index) => index + 1),
  ];
  const today = new Date();
  const isThisMonth = today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth();

  return (
    <div className="reservation-calendar">
      <p className="lead">
        모든 장비의 예약 내역을 한 달 단위로 확인합니다. <b>색은 장비</b>를, <b>선 모양은 상태</b>를 나타냅니다. 승인 대기 중인 신청은 점선으로 함께 표시되니, 겹치는 시간을 미리 피해 신청하실 수 있습니다.
      </p>
      {blocked.length > 0 && (
        <p className="calendar-blocked-lead" role="status">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>운영진이 막아 둔 시간은 <b>빗금</b>으로 표시됩니다. 그 시간에는 예약을 신청할 수 없습니다.</span>
        </p>
      )}
      <div className="calendar-toolbar">
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="이전 달">
          <ChevronLeft size={18} />
        </button>
        <strong>{month.getFullYear()}. {month.getMonth() + 1}</strong>
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="다음 달">
          <ChevronRight size={18} />
        </button>
        {/* 상태는 색이 아니라 선 모양으로 알려 줍니다. 색은 아래 장비 범례가 씁니다. */}
        <span className="calendar-legend-inline" aria-label="예약 상태 표시">
          <i className="pending" /> 대기 <i className="approved" /> 확정 <i className="in-use" /> 사용 중 <i className="completed" /> 완료 <i className="blocked" /> 사용 제한
        </span>
      </div>
      {tone.size > 0 && (
        <ul className="calendar-equipment-legend" aria-label="장비별 색">
          {[...tone.entries()].map(([name, index]) => (
            <li key={name} data-tone={index}><i aria-hidden="true" />{name}</li>
          ))}
        </ul>
      )}
      {message && <p className="save-notice">{message}</p>}
      <div className="reservation-grid" role="table" aria-label={`${month.getFullYear()}년 ${month.getMonth() + 1}월 장비 예약 현황`}>
        <div className="reservation-grid-head" role="row">
          {weekdays.map((day) => <span key={day} role="columnheader">{day}</span>)}
        </div>
        <div className="reservation-grid-body" role="rowgroup">
          {cells.map((day, index) => {
            if (day === null) return <div className="reservation-day empty" key={`blank-${index}`} aria-hidden="true" />;
            const key = `${month.getFullYear()}-${month.getMonth()}-${day}`;
            const bookings = byDay.get(key) ?? [];
            const blocks = blockedByDay.get(key) ?? [];
            return (
              <div
                className={`reservation-day${isThisMonth && today.getDate() === day ? " today" : ""}${bookings.length || blocks.length ? "" : " no-bookings"}`}
                role="cell"
                key={key}
              >
                <span className="reservation-date">
                  <b>{day}</b>
                  {/* 좁은 화면에서는 요일 머리글이 사라지므로 날짜를 풀어 씁니다. */}
                  <em>{month.getMonth() + 1}월 {day}일 ({weekdays[new Date(month.getFullYear(), month.getMonth(), day).getDay()]})</em>
                </span>
                {items === null ? null : bookings.length || blocks.length ? (
                  <ul>
                    {/* 막아 둔 시간을 위에 둡니다. 그 날 무엇을 할 수 있는지의
                        테두리를 먼저 읽어야, 아래 예약들이 이해됩니다. */}
                    {blocks.map((span, order) => (
                      <li className="blocked" key={`blocked-${span.equipmentId}-${span.startsAt}-${order}`}>
                        <div className="blocked-body" title={`${span.unitLabel || `${span.equipmentName} 전체 호기`} · 사용 제한${span.reason ? ` · ${span.reason}` : ""}`}>
                          <b>{range(span)}</b>
                          <span>{span.unitLabel || `${span.equipmentName} 전체`}</span>
                          <i>사용 제한{span.reason ? ` · ${span.reason}` : ""}</i>
                        </div>
                      </li>
                    ))}
                    {bookings.map((booking) => (
                      <li className={booking.status.toLowerCase()} data-tone={tone.get(booking.equipmentName) ?? 0} key={`${booking.id}-${day}`}>
                        <button type="button" onClick={() => setActive(booking)} title={`${unitTitle(booking.equipmentName, booking.unitLabel)} · ${booking.userName}${booking.companions?.length ? ` 외 ${booking.companions.length}명` : ""} · ${statusLabel[booking.status]}`}>
                          <b>{range(booking)}</b>
                          <span>{booking.unitLabel || booking.equipmentName}</span>
                          <i>{booking.userName}{booking.companions?.length ? ` 외 ${booking.companions.length}명` : ""}</i>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {items !== null && items.length === 0 && blocked.length === 0 && !message && (
        <p className="empty-inline">이 달에는 등록된 예약이 없습니다.</p>
      )}

      <dialog
        ref={dialog}
        className="reservation-dialog"
        onClose={() => setActive(null)}
        onClick={(event) => { if (event.target === dialog.current) close(); }}
      >
        {active && (
          <article>
            <button className="dialog-close" type="button" onClick={close} aria-label="예약 상세 닫기"><X /></button>
            <p className={`reservation-status ${active.status.toLowerCase()}`}>{statusLabel[active.status]}</p>
            <h3>{active.equipmentName}</h3>
            <dl>
              <div><dt><Wrench size={16} /> 호기</dt><dd>{active.unitLabel || "—"}</dd></div>
              <div><dt><CalendarDays size={16} /> 날짜</dt><dd>{fullDate.format(new Date(active.startsAt))}</dd></div>
              <div><dt><Clock3 size={16} /> 시간</dt><dd>{range(active)}</dd></div>
              <div><dt><User size={16} /> 신청자</dt><dd>{active.userName}</dd></div>
              {/* 함께 쓰는 사람이 있으면 자세히 보기에서 이름을 모두 보여 줍니다.
                  사고나 파손이 있을 때 누구에게 물어봐야 하는지가 여기 남습니다. */}
              {active.companions && active.companions.length > 0 && (
                <div><dt><Users size={16} /> 함께 쓰는 부원</dt><dd>{active.companions.join(", ")}</dd></div>
              )}
            </dl>
            {/* 덧붙인 말(`note`)은 여기 오지 않습니다. 그것은 운영진에게 하는
                말이라 동아리 전체가 보는 달력에 뜨면 솔직하게 쓰지 못합니다.
                무엇을 위한 예약이고 얼마나 급한지만 보여 줍니다. */}
            <section className="reservation-purpose-box">
              <h4>사용 목적</h4>
              <ul className="reservation-tags">
                <li className="purpose-chip">{purposeLabel(active.purposeCategory)}</li>
                <li className="urgency-badge" data-level={active.urgency ?? "NORMAL"}>{urgencyLabel(active.urgency)}</li>
              </ul>
            </section>
            {session?.id === active.userId && (active.status === "APPROVED" || active.status === "IN_USE") && (
              <section className="reservation-mine">
                {/* 장비 앞에서 예약 현황을 열어 본 사람이 마이페이지까지 가지
                    않고 그 자리에서 사진을 올릴 수 있게 합니다. */}
                <ReservationPhotoStep
                  reservation={active}
                  compact
                  onDone={(next) => {
                    setActive({ ...active, status: next.status, beforePhotoUrl: next.beforePhotoUrl ?? null, afterPhotoUrl: next.afterPhotoUrl ?? null });
                    void load();
                  }}
                />
              </section>
            )}
            <section className="reservation-shots">
              <h4><Camera size={15} /> 사용 전후 사진</h4>
              {active.beforePhotoUrl || active.afterPhotoUrl ? (
                <div className="reservation-photos">
                  {active.beforePhotoUrl && (
                    <figure>
                      <a href={active.beforePhotoUrl} target="_blank" rel="noreferrer">
                        <Image src={media(active.beforePhotoUrl, 640)} alt="사용 전 사진" width={640} height={440} unoptimized={!optimizable(active.beforePhotoUrl)} />
                      </a>
                      <figcaption>사용 전</figcaption>
                    </figure>
                  )}
                  {active.afterPhotoUrl && (
                    <figure>
                      <a href={active.afterPhotoUrl} target="_blank" rel="noreferrer">
                        <Image src={media(active.afterPhotoUrl, 640)} alt="사용 후 사진" width={640} height={440} unoptimized={!optimizable(active.afterPhotoUrl)} />
                      </a>
                      <figcaption>사용 후</figcaption>
                    </figure>
                  )}
                </div>
              ) : (
                <p className="reservation-shots-empty">
                  {active.status === "PENDING" || active.status === "APPROVED"
                    ? "아직 사용 전 사진이 등록되지 않았습니다. 사용 직전에 신청자가 올립니다."
                    : "등록된 사진이 없습니다."}
                </p>
              )}
            </section>
          </article>
        )}
      </dialog>
    </div>
  );
}
