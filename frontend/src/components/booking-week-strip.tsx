"use client";

import { weekDays } from "@/lib/booking";

/**
 * 다음 이레를 한 줄로 보여 주는 띠.
 *
 * 날짜 입력창만 있을 때는 "모레가 무슨 요일인지" 를 알려면 달력을 열어야 했다.
 * 대부분의 예약은 오늘 아니면 이번 주 안이라, 자주 쓰는 며칠을 한 번에 누를 수
 * 있게 둔다. 그보다 먼 날짜는 옆의 날짜 입력창으로 간다.
 *
 * 줄바꿈(`flex-wrap`) 이 아니라 가로 스크롤인 이유는 글꼴 폭 때문이다. 글꼴이
 * 달라지면 일곱 칸이 4+3 으로 접히면서 들쭉날쭉해진다. 굴리면 어느 폭에서도
 * 한 줄이다.
 */
export function BookingWeekStrip({
  day,
  today,
  maxDay,
  onPick,
}: {
  day: string;
  today: string;
  /** 신청할 수 있는 마지막 날. 예약 가능 기간을 짧게 잡아 두면 뒤쪽이 잠긴다. */
  maxDay?: string;
  onPick: (day: string) => void;
}) {
  const days = weekDays(today, 7, today);
  if (days.length === 0) return null;
  return (
    <div className="booking-week" role="group" aria-label="가까운 날짜">
      {days.map((entry) => (
        <button
          key={entry.day}
          type="button"
          aria-pressed={entry.day === day}
          disabled={Boolean(maxDay) && entry.day > maxDay!}
          title={Boolean(maxDay) && entry.day > maxDay! ? "예약 가능 기간을 넘은 날짜입니다" : undefined}
          className={`${entry.day === day ? "active" : ""}${entry.isToday ? " today" : ""}`}
          onClick={() => onPick(entry.day)}
        >
          <i>{entry.weekday}</i>
          <b>{entry.dayOfMonth}</b>
        </button>
      ))}
    </div>
  );
}
