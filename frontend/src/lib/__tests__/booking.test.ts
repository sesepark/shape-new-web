import { afterEach, describe, expect, it, vi } from "vitest";
import { pendingCounts, slotLabels, slotState, spanLabel, unitTitle, weekDays } from "@/lib/booking";

afterEach(() => vi.useRealTimers());

/** 14시 37분에 서 있는 상황. 화면이 잠그는 칸이 서버와 같아야 한다. */
const NOW = new Date("2026-09-01T14:37:00+09:00");
const DAY = "2026-09-01";
const none = new Set<string>();
const quiet = new Map<string, number>();

describe("예약 칸의 상태", () => {
  it("지금 돌고 있는 칸은 고를 수 있다", () => {
    vi.useFakeTimers().setSystemTime(NOW);
    const state = slotState(DAY, "14:00", "15:00", none, quiet);
    expect(state.kind).toBe("live");
    expect(state.selectable).toBe(true);
  });

  it("끝난 칸만 잠근다", () => {
    vi.useFakeTimers().setSystemTime(NOW);
    expect(slotState(DAY, "13:00", "14:00", none, quiet)).toMatchObject({ kind: "past", selectable: false });
    expect(slotState(DAY, "15:00", "16:00", none, quiet)).toMatchObject({ kind: "open", selectable: true });
  });

  it("끝 시각이 지금과 같으면 이미 끝난 것이다", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-09-01T15:00:00+09:00"));
    expect(slotState(DAY, "14:00", "15:00", none, quiet).kind).toBe("past");
  });

  it("확정된 칸은 아직 끝나지 않았어도 잠근다", () => {
    vi.useFakeTimers().setSystemTime(NOW);
    const reserved = new Set(["14:00", "16:00"]);
    expect(slotState(DAY, "14:00", "15:00", reserved, quiet).kind).toBe("taken");
    expect(slotState(DAY, "16:00", "17:00", reserved, quiet).kind).toBe("taken");
  });

  it("다투는 신청 수는 어떤 상태에서도 함께 알려 준다", () => {
    vi.useFakeTimers().setSystemTime(NOW);
    const pending = new Map([["14:00", 2], ["16:00", 1]]);
    // 지금 쓸 수 있으면서 동시에 남도 신청해 둔 칸이 있다.
    expect(slotState(DAY, "14:00", "15:00", none, pending)).toMatchObject({ kind: "live", pending: 2, selectable: true });
    expect(slotState(DAY, "16:00", "17:00", none, pending)).toMatchObject({ kind: "open", pending: 1, selectable: true });
  });

  it("읽을 수 없는 시각은 고를 수 없다", () => {
    vi.useFakeTimers().setSystemTime(NOW);
    expect(slotState("무슨날", "14:00", "15:00", none, quiet).selectable).toBe(false);
  });
});

describe("시간표 만들기", () => {
  it("예약 단위대로 하루를 나눈다", () => {
    expect(slotLabels(60)).toHaveLength(24);
    expect(slotLabels(30)).toHaveLength(48);
    expect(slotLabels(120).slice(0, 3)).toEqual(["00:00", "02:00", "04:00"]);
    expect(slotLabels(90).slice(0, 3)).toEqual(["00:00", "01:30", "03:00"]);
  });

  it("단위가 비어 있으면 한 시간으로 본다", () => {
    expect(slotLabels(0)).toHaveLength(24);
  });
});

describe("대기 신청 세기", () => {
  it("같은 시각이 여러 번 나오면 그만큼 겹친 것이다", () => {
    const counts = pendingCounts([
      "2026-09-01T14:00:00+09:00",
      "2026-09-01T14:00:00+09:00",
      "2026-09-01T14:30:00+09:00",
    ]);
    expect(counts.get("14:00")).toBe(2);
    expect(counts.get("14:30")).toBe(1);
  });

  it("값이 없어도 비어 있는 것으로 읽는다", () => {
    expect(pendingCounts(undefined).size).toBe(0);
  });
});

describe("날짜 띠", () => {
  it("고른 날부터 이어지는 이레를 준다", () => {
    const days = weekDays("2026-09-01", 7, "2026-09-01");
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ day: "2026-09-01", weekday: "화", dayOfMonth: 1, isToday: true });
    expect(days[6].day).toBe("2026-09-07");
    expect(days[6].isToday).toBe(false);
  });
});

describe("장비 · 호기 이름", () => {
  it("호기 이름이 이미 장비 이름을 품고 있으면 겹쳐 적지 않는다", () => {
    expect(unitTitle("OMY", "OMY 1호기")).toBe("OMY 1호기");
  });

  it("품고 있지 않으면 이어 붙인다", () => {
    expect(unitTitle("OMY", "1호기")).toBe("OMY · 1호기");
  });

  it("한쪽이 비어 있어도 읽을 수 있는 이름을 준다", () => {
    expect(unitTitle("OMY", "")).toBe("OMY");
    expect(unitTitle("", "1호기")).toBe("1호기");
    expect(unitTitle(undefined, undefined)).toBe("장비");
  });
});

describe("예약 구간 한 줄", () => {
  it("같은 날이면 날짜를 한 번만 적는다", () => {
    const line = spanLabel("2026-09-01T14:00:00+09:00", "2026-09-01T16:00:00+09:00");
    expect(line.match(/9월 1일/g)).toHaveLength(1);
  });

  it("자정을 넘기면 양쪽 날짜를 적는다", () => {
    const line = spanLabel("2026-09-01T23:00:00+09:00", "2026-09-02T01:00:00+09:00");
    expect(line).toContain("9월 1일");
    expect(line).toContain("9월 2일");
  });

  it("읽을 수 없는 시각은 빈 줄로 둔다", () => {
    expect(spanLabel("무슨날", "2026-09-01T16:00:00+09:00")).toBe("");
  });
});
