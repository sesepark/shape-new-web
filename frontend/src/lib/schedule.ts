import type { RoadmapItem } from "@/lib/types";

/**
 * 아직 끝나지 않은 일정을 가까운 순서로 추립니다.
 *
 * "지금"을 읽는 일은 화면을 그리는 함수 밖에 둡니다. 서버 컴포넌트 본문에서
 * 시계를 읽으면 같은 입력에 같은 결과가 나오지 않아 React 컴파일러가 막습니다.
 * 홈은 5분마다 다시 그려지므로 그때의 시각을 기준으로 삼으면 충분합니다.
 */
export function upcoming(items: RoadmapItem[], limit: number): RoadmapItem[] {
  const now = Date.now();
  return items
    .filter((item) => Date.parse(item.endsAt ?? item.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, limit);
}
