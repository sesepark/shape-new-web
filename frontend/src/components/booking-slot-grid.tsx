"use client";

import type { SlotState } from "@/lib/booking";

/**
 * 하루의 시간표. 칸마다 지금 어떤 상태인지를 글자로도 함께 적는다.
 *
 * 색만으로 구분하면 색을 구별하기 어려운 사람에게는 빈 칸과 남이 신청해 둔 칸이
 * 같아 보인다. 그래서 상태를 짧은 글자(`지금`·`신청 2`·`확정`)로도 적는다.
 */
export function BookingSlotGrid({
  times,
  endOf,
  stateOf,
  startHour,
  endHour,
  onPick,
}: {
  times: string[];
  endOf: (index: number) => string;
  stateOf: (time: string, index: number) => SlotState;
  startHour: string;
  endHour: string;
  onPick: (time: string, index: number) => void;
}) {
  // 칸이 하나도 없으면(장비를 아직 못 불러왔거나 시간표가 비었을 때) 범례와
  // 사용법만 남는다. 설명할 대상이 없는 설명은 보여 주지 않는다.
  if (times.length === 0) return null;
  return (
    <>
      <ul className="slot-legend" aria-hidden="true">
        <li><i className="swatch open" />빈 시간</li>
        <li><i className="swatch live" />지금 사용 가능</li>
        <li><i className="swatch contested" />신청 있음</li>
        <li><i className="swatch taken" />확정됨</li>
        <li><i className="swatch gone" />지난 시간</li>
      </ul>
      <p className="slot-picked" role="status">
        {startHour && endHour
          ? <>고른 시간 <b>{startHour} – {endHour}</b></>
          : "한 칸을 누르면 그 시간이 잡히고, 뒤쪽 칸을 다시 누르면 거기까지 늘어납니다."}
      </p>
      <div className="booking-slots">
        {times.map((time, index) => {
          const state = stateOf(time, index);
          const inRange = Boolean(startHour && endHour && time >= startHour && time < endHour);
          const flags = [
            state.kind === "live" ? "지금" : "",
            state.kind === "taken" ? "확정" : "",
            state.pending > 0 && state.kind !== "taken" ? `신청 ${state.pending}` : "",
          ].filter(Boolean);
          const className = [
            startHour === time ? "start" : "",
            inRange ? "range" : "",
            state.kind === "past" ? "gone" : "",
            state.kind === "taken" ? "taken" : "",
            state.kind === "live" ? "live" : "",
            state.pending > 0 && state.selectable ? "contested" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={time}
              type="button"
              disabled={!state.selectable}
              title={state.kind === "past" ? "이미 끝난 시간입니다" : state.kind === "taken" ? "이미 확정된 예약이 있습니다" : undefined}
              className={className}
              onClick={() => onPick(time, index)}
            >
              <span>{time} - {endOf(index)}</span>
              {flags.length > 0 && <i className="slot-flag">{flags.join(" · ")}</i>}
            </button>
          );
        })}
      </div>
    </>
  );
}
