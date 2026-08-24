import { describe, expect, it, vi, afterEach } from "vitest";
import { upcoming } from "@/lib/schedule";
import type { RoadmapItem } from "@/lib/types";

const item = (id: string, startsAt: string, endsAt?: string): RoadmapItem => ({
  id, title: id, category: "SHAPE-UP", description: "", startsAt, endsAt,
});

afterEach(() => vi.useRealTimers());

describe("다가오는 일정 추리기", () => {
  it("아직 끝나지 않은 일정만 가까운 순서로 돌려준다", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00+09:00"));
    const rows = upcoming([
      item("지난 일정", "2026-08-24T09:00:00+09:00", "2026-09-06T23:00:00+09:00"),
      item("나중 일정", "2026-11-13T09:00:00+09:00", "2026-11-14T18:00:00+09:00"),
      item("가까운 일정", "2026-10-13T19:00:00+09:00", "2026-10-13T21:00:00+09:00"),
    ], 3);
    expect(rows.map((row) => row.id)).toEqual(["가까운 일정", "나중 일정"]);
  });

  it("진행 중인 일정은 시작이 지났어도 남긴다", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00+09:00"));
    const rows = upcoming([item("진행 중", "2026-09-22T19:00:00+09:00", "2027-01-30T18:00:00+09:00")], 3);
    expect(rows.map((row) => row.id)).toEqual(["진행 중"]);
  });

  it("끝나는 날이 없는 일정은 시작 시각으로 판단한다", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00+09:00"));
    expect(upcoming([item("지난 발표", "2026-09-12T09:00:00+09:00")], 3)).toEqual([]);
    expect(upcoming([item("올 발표", "2026-12-26T09:00:00+09:00")], 3)).toHaveLength(1);
  });

  it("개수를 넘겨 받은 만큼만 돌려준다", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00+09:00"));
    const many = Array.from({ length: 8 }, (_, index) => item(`${index}`, `2026-11-0${index + 1}T09:00:00+09:00`));
    expect(upcoming(many, 3)).toHaveLength(3);
  });
});
