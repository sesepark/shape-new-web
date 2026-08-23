import type { RoadmapItem } from "@/lib/types";

export type LanePlacement = {
  item: RoadmapItem;
  /** 학기 창을 100 으로 봤을 때의 위치와 길이. */
  top: number;
  height: number;
  clippedTop: boolean;
  clippedBottom: boolean;
  point: boolean;
};

export type Lane = {
  key: string;
  label: string;
  category: string;
  placements: LanePlacement[];
};

export type LaneGroup = {
  category: string;
  label: string;
  /** 자리가 모자라 갈라진 레인 수. 머리글은 이만큼을 한 칸으로 덮습니다. */
  span: number;
};

/** 색과 순서를 고정하기 위한 분류 목록. 목록에 없는 분류는 뒤에 붙습니다. */
export const CATEGORY_ORDER = ["SHAPE-UP", "대회", "교육"];
const DAY = 24 * 60 * 60 * 1000;
/** 두 일정을 같은 레인에 이어 붙일 때 남기는 시각적 여유. */
const LANE_GAP = 2 * DAY;

export function semesterWindow(year: number, semester: 1 | 2) {
  const startMonth = semester === 1 ? 1 : 7;
  return {
    start: new Date(year, startMonth, 1),
    end: new Date(year, startMonth + 6, 1),
    months: Array.from({ length: 6 }, (_, offset) => new Date(year, startMonth + offset, 1)),
  };
}

function bounds(item: RoadmapItem) {
  const start = new Date(item.startsAt).getTime();
  const end = item.endsAt ? new Date(item.endsAt).getTime() : start;
  return { start, end: Math.max(end, start) };
}

/** 같은 날 안에서 끝나는 일정은 '시점'으로 보고 한 레인에 모읍니다. */
export function isPoint(item: RoadmapItem) {
  const { start, end } = bounds(item);
  const from = new Date(start);
  const to = new Date(end);
  return from.toDateString() === to.toDateString();
}

/** 겹치지 않는 일정끼리 같은 레인을 다시 쓰는 first-fit 배치. */
function pack(items: RoadmapItem[]): RoadmapItem[][] {
  const lanes: { items: RoadmapItem[]; until: number }[] = [];
  const ordered = [...items].sort((a, b) => {
    const left = bounds(a);
    const right = bounds(b);
    return left.start - right.start || right.end - right.start - (left.end - left.start);
  });
  for (const item of ordered) {
    const { start, end } = bounds(item);
    const lane = lanes.find((candidate) => candidate.until + LANE_GAP < start);
    if (lane) {
      lane.items.push(item);
      lane.until = Math.max(lane.until, end);
    } else {
      lanes.push({ items: [item], until: end });
    }
  }
  return lanes.map((lane) => lane.items);
}

function place(item: RoadmapItem, from: number, to: number): LanePlacement {
  const { start, end } = bounds(item);
  const span = to - from;
  const top = ((Math.max(start, from) - from) / span) * 100;
  const bottom = ((Math.min(end, to) - from) / span) * 100;
  return {
    item,
    top,
    height: Math.max(0, bottom - top),
    clippedTop: start < from,
    clippedBottom: end > to,
    point: isPoint(item),
  };
}

/**
 * 학기 창에 걸치는 일정을 세로 레인으로 나눕니다. 하루짜리는 맨 왼쪽 한 레인에
 * 모으고, 기간 일정은 분류별로 묶되 겹치면 같은 분류 안에서 레인을 늘립니다.
 */
export function buildLanes(items: RoadmapItem[], from: Date, to: Date): Lane[] {
  const start = from.getTime();
  const end = to.getTime();
  const visible = items.filter((item) => {
    const range = bounds(item);
    return range.start < end && range.end >= start;
  });

  const points = visible.filter(isPoint);
  const spans = visible.filter((item) => !isPoint(item));
  const lanes: Lane[] = [];

  if (points.length) {
    lanes.push({
      key: "point",
      label: "단일 일정",
      category: "point",
      placements: points
        .sort((a, b) => bounds(a).start - bounds(b).start)
        .map((item) => place(item, start, end)),
    });
  }

  const categories = [
    ...CATEGORY_ORDER.filter((name) => spans.some((item) => item.category === name)),
    ...[...new Set(spans.map((item) => item.category))].filter((name) => !CATEGORY_ORDER.includes(name)),
  ];
  for (const category of categories) {
    const packed = pack(spans.filter((item) => item.category === category));
    packed.forEach((laneItems, index) => {
      lanes.push({
        key: `${category}-${index}`,
        label: category,
        category,
        placements: laneItems.map((item) => place(item, start, end)),
      });
    });
  }
  return lanes;
}


/**
 * 같은 분류가 자리 때문에 여러 레인으로 갈라졌더라도 머리글에서는 한 칸으로
 * 묶습니다. "SHAPE-UP 1 / SHAPE-UP 2" 처럼 둘로 보이면 서로 다른 트랙이라고
 * 읽히기 때문입니다.
 */
export function laneGroups(lanes: Lane[]): LaneGroup[] {
  const groups: LaneGroup[] = [];
  for (const lane of lanes) {
    const last = groups.at(-1);
    if (last && last.category === lane.category) last.span += 1;
    else groups.push({ category: lane.category, label: lane.label, span: 1 });
  }
  return groups;
}
