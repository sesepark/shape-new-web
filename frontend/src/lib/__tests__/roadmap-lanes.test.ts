import { describe, expect, it } from "vitest";
import { buildLanes, isPoint, laneGroups, semesterWindow } from "@/lib/roadmap-lanes";
import type { RoadmapItem } from "@/lib/types";

const at = (month: number, day: number, hour = 9, year = 2026) =>
  new Date(year, month - 1, day, hour).toISOString();

function item(title: string, category: string, startsAt: string, endsAt?: string): RoadmapItem {
  return { id: title, title, category, description: "", startsAt, endsAt };
}

const { start, end, months } = semesterWindow(2026, 2);

describe("roadmap lanes", () => {
  it("covers August through January for the second semester", () => {
    expect(months.map((month) => month.getMonth() + 1)).toEqual([8, 9, 10, 11, 12, 1]);
    expect(start.getMonth()).toBe(7);
    expect(end.getFullYear()).toBe(2027);
  });

  it("treats a same-day schedule as a point event", () => {
    expect(isPoint(item("OT", "SHAPE-UP", at(9, 17, 19), at(9, 17, 22)))).toBe(true);
    expect(isPoint(item("Demo", "SHAPE-UP", at(9, 17)))).toBe(true);
    expect(isPoint(item("본선", "대회", at(11, 13), at(11, 14)))).toBe(false);
  });

  it("puts every point event in one lane on the left", () => {
    const lanes = buildLanes(
      [item("OT", "SHAPE-UP", at(9, 17)), item("미팅", "SHAPE-UP", at(9, 29)), item("Demo Day", "대회", at(1, 30, 9, 2027))],
      start,
      end,
    );
    expect(lanes[0].category).toBe("point");
    expect(lanes[0].placements).toHaveLength(3);
    expect(lanes).toHaveLength(1);
  });

  it("reuses one lane for schedules that do not overlap", () => {
    const lanes = buildLanes(
      [
        item("예선", "대회", at(10, 1), at(10, 31)),
        item("본선", "대회", at(11, 13), at(11, 14)),
        item("지원", "대회", at(11, 20), at(11, 30)),
      ],
      start,
      end,
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].label).toBe("대회");
    expect(lanes[0].placements.map((p) => p.item.title)).toEqual(["예선", "본선", "지원"]);
  });

  it("adds a second lane inside a category only when schedules overlap", () => {
    const lanes = buildLanes(
      [
        item("긴 프로젝트", "교육", at(9, 24), at(12, 10)),
        item("중간고사", "교육", at(10, 19), at(11, 1)),
      ],
      start,
      end,
    );
    expect(lanes.map((lane) => lane.label)).toEqual(["교육", "교육"]);
    expect(laneGroups(lanes)).toEqual([{ category: "교육", label: "교육", span: 2 }]);
  });

  it("measures a bar against the semester and marks what runs past it", () => {
    const lanes = buildLanes([item("SHAPE-UP", "SHAPE-UP", at(9, 22), at(3, 30, 9, 2027))], start, end);
    const bar = lanes[0].placements[0];
    // 8/1 기준 9/22 는 여섯 달 중 약 한 달 반 뒤.
    expect(bar.top).toBeGreaterThan(25);
    expect(bar.top).toBeLessThan(30);
    expect(bar.clippedBottom).toBe(true);
    expect(bar.top + bar.height).toBeCloseTo(100, 5);
  });

  it("keeps categories in a fixed order with unknown ones last", () => {
    const lanes = buildLanes(
      [
        item("기타 일정", "행사", at(9, 1), at(9, 20)),
        item("교육", "교육", at(9, 1), at(9, 20)),
        item("대회", "대회", at(9, 1), at(9, 20)),
      ],
      start,
      end,
    );
    expect(lanes.map((lane) => lane.category)).toEqual(["대회", "교육", "행사"]);
  });
});

describe("lane groups", () => {
  it("merges lanes that were only split for space", () => {
    const lanes = buildLanes(
      [
        item("OT", "SHAPE-UP", at(9, 17)),
        item("긴 프로젝트", "교육", at(9, 24), at(12, 10)),
        item("중간고사", "교육", at(10, 19), at(11, 1)),
        item("예선", "대회", at(10, 1), at(10, 31)),
      ],
      start,
      end,
    );
    expect(lanes.map((lane) => lane.label)).toEqual(["단일 일정", "대회", "교육", "교육"]);
    expect(laneGroups(lanes)).toEqual([
      { category: "point", label: "단일 일정", span: 1 },
      { category: "대회", label: "대회", span: 1 },
      { category: "교육", label: "교육", span: 2 },
    ]);
    // 머리글 칸 폭의 합은 레인 수와 같아야 자리가 어긋나지 않는다.
    expect(laneGroups(lanes).reduce((total, group) => total + group.span, 0)).toBe(lanes.length);
  });
});
