import { describe, expect, it } from "vitest";
import { byDay, conflictGroups, rejectionDraft, sortReservations, withoutConflicts } from "@/lib/reservation-triage";
import type { AdminReservationItem } from "@/lib/types";

const row = (
  id: string,
  unit: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<AdminReservationItem> = {},
): AdminReservationItem => ({
  id, equipmentUnitId: unit, userId: `user-${id}`, startsAt, endsAt,
  status: "PENDING", equipmentName: "OMY", unitLabel: "1호기",
  userName: id, userEmail: `${id}@example.com`, createdAt: "2026-09-01T00:00:00+09:00",
  ...extra,
});

describe("겹친 신청 묶기", () => {
  it("같은 호기의 겹치는 대기 신청을 한 묶음으로 모은다", () => {
    const groups = conflictGroups([
      row("A", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00"),
      row("B", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T17:00:00+09:00"),
      row("C", "unit-2", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.id).sort()).toEqual(["A", "B"]);
  });

  it("이어져 겹치면 셋이 한 묶음이 된다", () => {
    // A∩B, B∩C 는 겹치지만 A∩C 는 겹치지 않는다. 그래도 한자리에서 정해야 한다.
    const groups = conflictGroups([
      row("A", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00"),
      row("B", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T17:00:00+09:00"),
      row("C", "unit-1", "2026-09-02T16:30:00+09:00", "2026-09-02T18:00:00+09:00"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("맞닿기만 한 예약은 겹친 것이 아니다", () => {
    expect(conflictGroups([
      row("A", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T15:00:00+09:00"),
      row("B", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T16:00:00+09:00"),
    ])).toEqual([]);
  });

  it("이미 확정된 예약은 다투지 않는다", () => {
    expect(conflictGroups([
      row("A", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00", { status: "APPROVED" }),
      row("B", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T17:00:00+09:00"),
    ])).toEqual([]);
  });

  it("묶음 안은 추천 점수가 높은 쪽이 먼저다", () => {
    const groups = conflictGroups([
      row("A", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00", { priority: 20 }),
      row("B", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T17:00:00+09:00", { priority: 70 }),
    ]);
    expect(groups[0].map((item) => item.id)).toEqual(["B", "A"]);
  });

  it("겹치지 않은 신청은 따로 남는다", () => {
    const rows = [
      row("A", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00"),
      row("B", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T17:00:00+09:00"),
      row("C", "unit-2", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00"),
    ];
    expect(withoutConflicts(rows).map((item) => item.id)).toEqual(["C"]);
  });
});

describe("목록 정렬", () => {
  const rows = [
    row("낮음", "unit-1", "2026-09-04T14:00:00+09:00", "2026-09-04T15:00:00+09:00",
      { urgency: "LOW", priority: 0, createdAt: "2026-09-01T09:00:00+09:00" }),
    row("시급", "unit-2", "2026-09-02T14:00:00+09:00", "2026-09-02T15:00:00+09:00",
      { urgency: "HIGH", priority: 70, createdAt: "2026-09-01T11:00:00+09:00" }),
    row("보통", "unit-3", "2026-09-03T14:00:00+09:00", "2026-09-03T15:00:00+09:00",
      { urgency: "NORMAL", priority: 20, createdAt: "2026-09-01T10:00:00+09:00" }),
  ];

  it("시급도는 매우 시급·보통·낮음 순이다", () => {
    // 알파벳 순으로 두면 HIGH, LOW, NORMAL 이 되어 '낮음' 이 '보통' 위로 올라온다.
    expect(sortReservations(rows, "urgency").map((item) => item.id)).toEqual(["시급", "보통", "낮음"]);
  });

  it("신청순은 늦게 낸 것이 위다", () => {
    expect(sortReservations(rows, "created").map((item) => item.id)).toEqual(["시급", "보통", "낮음"]);
  });

  it("시작 시각순은 늦은 일정이 위다", () => {
    expect(sortReservations(rows, "start").map((item) => item.id)).toEqual(["낮음", "보통", "시급"]);
  });

  it("추천순은 점수가 높은 것이 위다", () => {
    expect(sortReservations(rows, "priority").map((item) => item.id)).toEqual(["시급", "보통", "낮음"]);
  });
});

describe("반려 사유 초안", () => {
  it("언제 무엇과 겹쳤는지와 다음에 할 일을 함께 적는다", () => {
    const winner = row("이긴 쪽", "unit-1", "2026-09-02T14:00:00+09:00", "2026-09-02T16:00:00+09:00",
      { urgency: "HIGH", purposeCategory: "CONTEST" });
    const loser = row("진 쪽", "unit-1", "2026-09-02T15:00:00+09:00", "2026-09-02T17:00:00+09:00");
    const draft = rejectionDraft(winner, loser);
    // 장비 이름을 겹쳐 적지 않는다 — "OMY OMY 1호기" 가 되면 두 번 읽게 된다.
    expect(draft).toContain("1호기");
    expect(draft).not.toContain("OMY OMY");
    expect(draft).toContain("대회");
    expect(draft).toContain("매우 시급");
    expect(draft).toContain("다시 신청해 주세요");
  });
});

describe("byDay", () => {
  const at = (iso: string, id: string): AdminReservationItem =>
    ({ id, startsAt: iso, endsAt: iso, status: "PENDING" }) as AdminReservationItem;

  it("서울 벽시계 날짜로 끊는다", () => {
    // 09-02 23:00 KST 는 UTC 로 09-02 14:00 이다. UTC 로 끊으면 같은 날이지만
    // 09-03 01:00 KST(= UTC 09-02 16:00)는 **다른 날**이어야 한다.
    const groups = byDay([
      at("2026-09-02T16:00:00Z", "a"), // 9월 3일 01:00 KST
      at("2026-09-02T14:00:00Z", "b"), // 9월 2일 23:00 KST
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["a"]);
    expect(groups[1].rows.map((row) => row.id)).toEqual(["b"]);
    expect(groups[0].label).toContain("9월 3일");
  });

  it("이미 정해진 차례를 다시 정렬하지 않는다", () => {
    // 화면이 고른 차례(시급도순 따위)를 여기서 덮으면 안 된다.
    const groups = byDay([
      at("2026-09-02T01:00:00Z", "늦게"),
      at("2026-09-02T00:00:00Z", "먼저"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["늦게", "먼저"]);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("읽을 수 없는 시각은 건너뛰고 나머지를 살린다", () => {
    const groups = byDay([at("이건 시각이 아님", "깨진"), at("2026-09-02T00:00:00Z", "멀쩡")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["멀쩡"]);
  });
});
