import type { ReservationPurpose, ReservationUrgency } from "@/lib/types";

/** 하루를 여는 시각과 닫는 시각. 지금은 온종일 예약을 받습니다. */
export const RESERVATION_OPEN_HOUR = 0;
export const RESERVATION_CLOSE_HOUR = 24;
/** 화면에 쓰는 시각은 모두 한국 시각입니다. 서버도 같은 기준으로 칸을 끊습니다. */
const KST = "+09:00";

export const timeLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** 하루를 예약 단위로 쪼갠 시작 시각 목록. 장비마다 단위가 달라 매번 새로 만듭니다. */
export function slotLabels(unitMinutes: number): string[] {
  const step = Math.max(30, unitMinutes || 60);
  const count = Math.floor(((RESERVATION_CLOSE_HOUR - RESERVATION_OPEN_HOUR) * 60) / step);
  return Array.from({ length: Math.max(0, count) }, (_, index) => timeLabel(RESERVATION_OPEN_HOUR * 60 + index * step));
}

/** `YYYY-MM-DD` 와 `HH:MM` 을 한국 시각으로 읽어 밀리초로. 못 읽으면 NaN. */
export function at(day: string, time: string): number {
  return new Date(`${day}T${time}:00${KST}`).getTime();
}

/** 서버에 보낼 ISO 문자열. 화면에서 고른 시각은 언제나 한국 시각입니다. */
export function iso(day: string, time: string): string {
  return new Date(`${day}T${time}:00${KST}`).toISOString();
}

export type SlotKind = "past" | "taken" | "live" | "open";

export interface SlotState {
  kind: SlotKind;
  /** 이 칸을 두고 기다리는 신청 수. 0 이면 다투는 사람이 없습니다. */
  pending: number;
  selectable: boolean;
}

/**
 * 한 칸이 지금 어떤 상태인지.
 *
 * 예전에는 **시작** 시각이 지금+5분보다 앞이면 잠갔다. 그래서 14시 37분에 장비
 * 앞에 선 부원이 14~15시 칸을 누를 수 없었다 — 장비는 비어 있는데 23분을 버리고
 * 15시를 기다려야 했다.
 *
 * 이제는 **끝 시각이 지났을 때만** 잠근다. 서버도 같은 규칙이다(`ends_at > now`
 * 이고 시작이 지금 칸보다 앞서지 않을 것). 두 규칙이 어긋나면 눌리는데 거절되거나
 * 받아 주는데 눌리지 않는, 어느 쪽이든 설명할 수 없는 화면이 된다.
 *
 * 다투는 신청(`pending`)은 **모든 상태에 함께 실어 준다.** 지금 쓸 수 있으면서
 * 동시에 남도 신청해 둔 칸이 있기 때문이다.
 */
export function slotState(
  day: string,
  start: string,
  end: string,
  reserved: Set<string>,
  pending: Map<string, number>,
  now: number = Date.now(),
): SlotState {
  const count = pending.get(start) ?? 0;
  const startsAt = at(day, start);
  const endsAt = at(day, end);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= now) {
    return { kind: "past", pending: count, selectable: false };
  }
  if (reserved.has(start)) return { kind: "taken", pending: count, selectable: false };
  if (startsAt <= now) return { kind: "live", pending: count, selectable: true };
  return { kind: "open", pending: count, selectable: true };
}

/** `reservedStarts`·`pendingStarts` 의 ISO 목록을 `HH:MM` 로 줄여 셉니다. */
export function pendingCounts(starts: string[] | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of starts ?? []) {
    const mark = value.slice(11, 16);
    counts.set(mark, (counts.get(mark) ?? 0) + 1);
  }
  return counts;
}

export interface WeekDay {
  day: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 오늘 기준 `YYYY-MM-DD`. 브라우저가 있는 곳의 날짜입니다. */
export function localDay(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** 날짜 띠에 쓸 며칠치. `from` 부터 이어집니다. */
export function weekDays(from: string, count = 7, today: string = localDay()): WeekDay[] {
  const base = new Date(`${from}T12:00:00`);
  if (Number.isNaN(base.getTime())) return [];
  return Array.from({ length: count }, (_, index) => {
    const moment = new Date(base.getTime() + index * 86_400_000);
    const day = localDay(moment);
    return { day, weekday: WEEKDAYS[moment.getDay()], dayOfMonth: moment.getDate(), isToday: day === today };
  });
}

export const PURPOSE_CATEGORIES: [ReservationPurpose, string][] = [
  ["CONTEST", "대회"],
  ["SHAPE_UP", "SHAPE-UP"],
  ["EDUCATION", "교육"],
  ["OTHER", "기타"],
];

export const URGENCY_LEVELS: [ReservationUrgency, string][] = [
  ["HIGH", "매우 시급"],
  ["NORMAL", "보통"],
  ["LOW", "낮음"],
];

export const purposeLabel = (value?: ReservationPurpose | null) =>
  PURPOSE_CATEGORIES.find(([key]) => key === value)?.[1] ?? "기타";
export const urgencyLabel = (value?: ReservationUrgency | null) =>
  URGENCY_LEVELS.find(([key]) => key === value)?.[1] ?? "보통";

/**
 * '장비 · 호기' 를 한 줄로. 호기 이름이 이미 장비 이름으로 시작하면 겹쳐 적지 않는다.
 *
 * 호기는 보통 `OMY 1호기` 처럼 장비 이름을 달고 등록된다. 그대로 이어 붙이면
 * "OMY · OMY 1호기" 가 되어 읽는 사람이 두 번 읽는다.
 */
export function unitTitle(equipmentName?: string, unitLabel?: string): string {
  const gear = (equipmentName ?? "").trim();
  const unit = (unitLabel ?? "").trim();
  if (!unit) return gear || "장비";
  if (!gear || unit.startsWith(gear)) return unit;
  return `${gear} · ${unit}`;
}

const dayStamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
const timeStamp = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

/**
 * 예약 구간 한 줄. 같은 날이면 날짜를 한 번만 적는다.
 *
 * "8월 31일 오전 10:00 — 8월 31일 오후 12:00" 은 같은 날짜를 두 번 읽게 한다.
 * 자정을 넘기는 예약만 양쪽 날짜를 적는다.
 */
export function spanLabel(startsAt: string, endsAt: string): string {
  const from = new Date(startsAt);
  const to = new Date(endsAt);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "";
  const sameDay = dayStamp.format(from) === dayStamp.format(to);
  return sameDay
    ? `${dayStamp.format(from)} ${timeStamp.format(from)} – ${timeStamp.format(to)}`
    : `${dayStamp.format(from)} ${timeStamp.format(from)} – ${dayStamp.format(to)} ${timeStamp.format(to)}`;
}
