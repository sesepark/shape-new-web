import { purposeLabel, unitTitle, urgencyLabel } from "@/lib/booking";
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

const stamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

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
