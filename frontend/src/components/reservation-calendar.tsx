"use client";

import { CalendarDays, Camera, ChevronLeft, ChevronRight, Clock3, User, Wrench, X } from "lucide-react";
import Image from "next/image";
import { media } from "@/lib/media";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { board } from "@/lib/board";
import { ReservationPhotoStep } from "@/components/reservation-photo-step";
import { useSession } from "@/lib/session";
import type { ReservationCalendarItem, ReservationStatus } from "@/lib/types";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const statusLabel: Record<ReservationStatus, string> = {
  PENDING: "승인 대기", APPROVED: "예약 확정", IN_USE: "사용 중",
  COMPLETED: "사용 완료", REJECTED: "반려", CANCELLED: "취소",
};
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
const fullDate = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const range = (item: ReservationCalendarItem) => `${clock.format(new Date(item.startsAt))} – ${clock.format(new Date(item.endsAt))}`;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Every day the booking touches, so a multi-day reservation shows on each one. */
function daysCovered(item: ReservationCalendarItem) {
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
    const response = await board(`/reservations/calendar?month=${monthKey(month)}`);
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

  const byDay = useMemo(() => {
    const map = new Map<string, ReservationCalendarItem[]>();
    for (const item of items ?? []) {
      for (const day of daysCovered(item)) {
        map.set(day, [...(map.get(day) ?? []), item]);
      }
    }
    return map;
  }, [items]);

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
        모든 장비의 예약 내역을 한 달 단위로 확인합니다. 승인 대기 중인 신청도 회색으로 함께 표시되니, 겹치는 시간을 미리 피해 신청하실 수 있습니다.
      </p>
      <div className="calendar-toolbar">
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="이전 달">
          <ChevronLeft size={18} />
        </button>
        <strong>{month.getFullYear()}. {month.getMonth() + 1}</strong>
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="다음 달">
          <ChevronRight size={18} />
        </button>
        <span className="calendar-legend-inline">
          <i className="approved" /> 확정 <i className="in-use" /> 사용 중 <i className="pending" /> 대기 <i className="completed" /> 완료
        </span>
      </div>
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
            return (
              <div
                className={`reservation-day${isThisMonth && today.getDate() === day ? " today" : ""}${bookings.length ? "" : " no-bookings"}`}
                role="cell"
                key={key}
              >
                <span className="reservation-date">
                  <b>{day}</b>
                  {/* 좁은 화면에서는 요일 머리글이 사라지므로 날짜를 풀어 씁니다. */}
                  <em>{month.getMonth() + 1}월 {day}일 ({weekdays[new Date(month.getFullYear(), month.getMonth(), day).getDay()]})</em>
                </span>
                {items === null ? null : bookings.length ? (
                  <ul>
                    {bookings.map((booking) => (
                      <li className={booking.status.toLowerCase()} key={`${booking.id}-${day}`}>
                        <button type="button" onClick={() => setActive(booking)} title={`${booking.equipmentName} ${booking.unitLabel} · ${booking.userName} · ${statusLabel[booking.status]}`}>
                          <b>{range(booking)}</b>
                          <span>{booking.unitLabel || booking.equipmentName}</span>
                          <i>{booking.userName}</i>
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
      {items !== null && items.length === 0 && !message && (
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
            </dl>
            <section className="reservation-purpose-box">
              <h4>사용 목적</h4>
              <p>{active.purpose || "신청 시 입력한 사용 목적이 없습니다."}</p>
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
                        <Image src={media(active.beforePhotoUrl, 640)} alt="사용 전 사진" width={640} height={440} unoptimized />
                      </a>
                      <figcaption>사용 전</figcaption>
                    </figure>
                  )}
                  {active.afterPhotoUrl && (
                    <figure>
                      <a href={active.afterPhotoUrl} target="_blank" rel="noreferrer">
                        <Image src={media(active.afterPhotoUrl, 640)} alt="사용 후 사진" width={640} height={440} unoptimized />
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
