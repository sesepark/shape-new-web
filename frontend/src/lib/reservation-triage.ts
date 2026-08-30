import { CLOCK_OPTIONS, purposeLabel, unitTitle, urgencyLabel } from "@/lib/booking";
import type { AdminReservationItem, ReservationUrgency } from "@/lib/types";

const URGENCY_RANK: Record<ReservationUrgency, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };

const started = (row: AdminReservationItem) => new Date(row.startsAt).getTime();
const ended = (row: AdminReservationItem) => new Date(row.endsAt).getTime();
const asked = (row: AdminReservationItem) => (row.createdAt ? new Date(row.createdAt).getTime() : 0);

/**
 * 같은 호기의 같은 시간대를 두고 다투는 **대기** 신청 묶음.
 *
 * 서버도 `conflictsWith` 로 짝을 알려 주지만, 그것은 '누구와 겹치는가' 일 뿐
 * 묶음이 아니다. A-B 가 겹치고 B-C 가 겹치는데 A-C 는 안 겹치는 경우, 셋을 한
 * 자리에서 보여 주어야 운영진이 한 번에 정할 수 있다. 그래서 이어진 것끼리
 * 합친다(union-find).
 */
export function conflictGroups(rows: AdminReservationItem[]): AdminReservationItem[][] {
  const waiting = rows.filter((row) => row.status === "PENDING");
  const parent = new Map<string, string>(waiting.map((row) => [row.id, row.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    return root;
  };
  const union = (left: string, right: string) => {
    const [a, b] = [find(left), find(right)];
    if (a !== b) parent.set(a, b);
  };

  const byUnit = new Map<string, AdminReservationItem[]>();
  for (const row of waiting) {
    const bucket = byUnit.get(row.equipmentUnitId) ?? [];
    bucket.push(row);
    byUnit.set(row.equipmentUnitId, bucket);
  }
  for (const bucket of byUnit.values()) {
    bucket.sort((left, right) => started(left) - started(right));
    for (let index = 0; index < bucket.length; index += 1) {
      for (let other = index + 1; other < bucket.length; other += 1) {
        // 시작순으로 세워 두었으므로, 겹치지 않는 것을 만나면 뒤쪽은 더 볼 것이 없다.
        if (started(bucket[other]) >= ended(bucket[index])) break;
        union(bucket[index].id, bucket[other].id);
      }
    }
  }

  const groups = new Map<string, AdminReservationItem[]>();
  for (const row of waiting) {
    const root = find(row.id);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || asked(left) - asked(right)))
    .sort((left, right) => started(left[0]) - started(right[0]));
}

/** 겹침 묶음에 속하지 않는 신청. 목록 아래쪽에 평소처럼 나열합니다. */
export function withoutConflicts(rows: AdminReservationItem[]): AdminReservationItem[] {
  const grouped = new Set(conflictGroups(rows).flat().map((row) => row.id));
  return rows.filter((row) => !grouped.has(row.id));
}

export function sortReservations(
  rows: AdminReservationItem[],
  by: "start" | "created" | "urgency" | "priority",
): AdminReservationItem[] {
  const sorted = [...rows];
  if (by === "created") sorted.sort((left, right) => asked(right) - asked(left));
  else if (by === "urgency") {
    sorted.sort((left, right) =>
      URGENCY_RANK[left.urgency ?? "NORMAL"] - URGENCY_RANK[right.urgency ?? "NORMAL"] || asked(left) - asked(right));
  } else if (by === "priority") {
    sorted.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || asked(left) - asked(right));
  } else sorted.sort((left, right) => started(right) - started(left));
  return sorted;
}

// 예약 시각은 어디서나 24시간제입니다(`lib/booking.ts` 의 `CLOCK_OPTIONS`).
const stamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", ...CLOCK_OPTIONS });

/**
 * 겹친 신청 중 한쪽을 확정할 때, 나머지에게 보낼 반려 사유의 초안.
 *
 * 운영진이 빈 칸을 마주하면 "다른 신청이 있어서" 한 줄로 끝나기 쉽다. 언제
 * 무엇과 겹쳤는지, 다음에 어떻게 하면 되는지를 미리 적어 두면 받는 사람이
 * 납득할 수 있다. 그대로 보내도 되고 고쳐 보내도 된다.
 */
export function rejectionDraft(winner: AdminReservationItem, loser: AdminReservationItem): string {
  const when = `${stamp.format(new Date(loser.startsAt))} – ${stamp.format(new Date(loser.endsAt))}`;
  return [
    `같은 시간(${when})에 ${unitTitle(winner.equipmentName, winner.unitLabel)} 신청이 함께 있어,`,
    `이번에는 ${purposeLabel(winner.purposeCategory)}·${urgencyLabel(winner.urgency)} 신청을 먼저 확정했습니다.`,
    "다른 시간대로 다시 신청해 주세요. 비어 있는 시간은 장비 예약 화면에서 바로 확인할 수 있습니다.",
  ].join(" ");
}


/**
 * 목록을 **서울 벽시계 날짜**로 묶습니다.
 *
 * 예전에는 카드가 9월 3일에서 9월 2일로 넘어가는데 사이에 아무 표시가 없었고,
 * 카드마다 "9월 3일 00:34 – 02:34" 처럼 날짜가 되풀이됐습니다. 날짜별로
 * 처리하는 일이라 어디서 날이 바뀌는지가 먼저 보여야 합니다.
 *
 * 날짜를 UTC 로 끊으면 저녁 예약이 하루 밀립니다. 서버의 기간 거르개도 서울
 * 벽시계로 끊으므로 같은 잣대를 씁니다.
 */
const SEOUL_DAY = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
const SEOUL_LABEL = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
});

export function byDay(rows: AdminReservationItem[]): { key: string; label: string; rows: AdminReservationItem[] }[] {
  const out: { key: string; label: string; rows: AdminReservationItem[] }[] = [];
  for (const row of rows) {
    const when = new Date(row.startsAt);
    // 시각을 못 읽는 행이 들어와도 목록 전체가 무너지면 안 됩니다.
    if (Number.isNaN(when.getTime())) continue;
    const key = SEOUL_DAY.format(when);
    const last = out[out.length - 1];
    // 이미 정렬된 목록을 그대로 훑습니다. 여기서 다시 정렬하면 화면이 고른
    // 차례(시급도순·추천순 …)를 덮어써 버립니다.
    if (last && last.key === key) last.rows.push(row);
    else out.push({ key, label: SEOUL_LABEL.format(when), rows: [row] });
  }
  return out;
}
