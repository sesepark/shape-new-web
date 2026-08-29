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

export type SlotKind = "past" | "blocked" | "taken" | "live" | "open";

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
 *
 * `blocked` 는 운영진이 막아 둔 칸이다(정비·교육 실습·대회 준비). 서버도 같은
 * 규칙으로 신청을 거절하므로 두 쪽이 어긋나지 않는다.
 */
export function slotState(
  day: string,
  start: string,
  end: string,
  reserved: Set<string>,
  pending: Map<string, number>,
  blocked: Set<string> = new Set(),
  now: number = Date.now(),
): SlotState {
  const count = pending.get(start) ?? 0;
  const startsAt = at(day, start);
  const endsAt = at(day, end);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= now) {
    return { kind: "past", pending: count, selectable: false };
  }
  // 운영진이 막아 둔 칸은 확정 예약보다 먼저 본다. 막을 때 걸리는 예약을 함께
  // 취소하므로 둘이 겹칠 일은 거의 없지만, 겹친다면 "왜 못 누르는가" 의 답은
  // 남의 예약이 아니라 사용 제한이다.
  if (blocked.has(start)) return { kind: "blocked", pending: count, selectable: false };
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
/**
 * 시각은 **24시간제**로 적는다.
 *
 * 예약 화면의 시간표·정기 예약·사용 제한이 모두 `19:00` 같은 24시간 눈금을 쓴다.
 * 여기만 `오후 7:00` 으로 적으면 같은 시각이 화면마다 다른 모양으로 보이고,
 * 특히 "언제 확정되는가" 를 알려 주는 자리에서는 그 차이가 곧 오해가 된다.
 */
const timeStamp = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

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


/** ISO 시각 한 줄. "8월 30일 13:00" 처럼 적습니다. */
export function momentLabel(value: string | number | Date): string {
  const moment = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(moment.getTime())) return "";
  return `${dayStamp.format(moment)} ${timeStamp.format(moment)}`;
}

/**
 * 이 신청이 어떻게 확정되는가.
 *
 * 화면이 규칙을 설명하는 것만으로는 부족하다. "같은 시간에 다른 신청이 없으면
 * 시작 한 시간 전에 저절로 확정됩니다" 는 규칙이지, **내 신청**이 어느 쪽인지는
 * 말해 주지 않는다. 그러면 부원은 결국 운영진에게 직접 물어보게 된다.
 *
 * 신청하기 **전**(예약 화면에서 시간을 고른 순간)과 신청한 **뒤**(마이페이지)
 * 양쪽에서 같은 판정을 쓴다. 두 화면이 다른 말을 하면 어느 쪽도 믿을 수 없다.
 */
export type ConfirmOutlook =
  | { kind: "immediate" }
  | { kind: "scheduled"; at: number }
  | { kind: "contested"; count: number };

export function confirmOutlook(
  startsAt: number,
  contested: number,
  autoApproveMinutes: number,
  now: number = Date.now(),
): ConfirmOutlook {
  if (contested > 0) return { kind: "contested", count: contested };
  const due = startsAt - autoApproveMinutes * 60_000;
  return due <= now ? { kind: "immediate" } : { kind: "scheduled", at: due };
}

/** 위 판정을 사람이 읽는 한 줄로. 신청 화면에서 쓰는 '앞으로 어떻게 될지' 입니다. */
export function confirmLabel(outlook: ConfirmOutlook): string {
  if (outlook.kind === "immediate") return "지금 신청하면 곧바로 확정됩니다.";
  if (outlook.kind === "contested") {
    return `같은 시간에 신청이 ${outlook.count}건 있습니다. 저절로 확정되지 않고 운영진이 한 건을 고릅니다.`;
  }
  return `${momentLabel(outlook.at)}에 저절로 확정됩니다. 그 전에 운영진이 먼저 확정할 수도 있습니다.`;
}

/**
 * 이미 신청한 예약에 붙이는 한 줄. 서버가 계산한 시각을 그대로 씁니다.
 *
 * 서버가 판정하는 이유는 화면이 **남의 신청**을 볼 수 없기 때문입니다. 겹쳤는지
 * 여부는 내 예약 목록만으로는 알 수 없습니다.
 */
export function confirmNotice(
  autoConfirmAt: string | null | undefined,
  contested: boolean | undefined,
  now: number = Date.now(),
): string {
  if (contested) return "같은 시간에 다른 신청이 있어 운영진이 직접 한 건을 고릅니다.";
  if (!autoConfirmAt) return "운영진 승인을 기다리는 중입니다.";
  const due = new Date(autoConfirmAt).getTime();
  if (Number.isNaN(due)) return "운영진 승인을 기다리는 중입니다.";
  // 이미 그 시각을 지났으면 다음 훑기에서 확정됩니다(길어야 몇 분).
  return due <= now
    ? "곧 저절로 확정됩니다. 잠시 뒤 새로 고치면 확정으로 바뀝니다."
    : `${momentLabel(due)}에 저절로 확정됩니다.`;
}
