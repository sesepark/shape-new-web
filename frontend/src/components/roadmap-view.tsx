import { ContinuousCalendar } from "@/components/continuous-calendar";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";
import type { RoadmapItem } from "@/lib/types";

export async function RoadmapView({
  category,
}: {
  category?: "SHAPE-UP" | "대회" | "교육" | "기타";
}) {
  const items = await listOrEmpty(api.roadmap());
  const visible = category
    ? items.filter(
        (item) => item.category.trim().toUpperCase() === category.toUpperCase(),
      )
    : items;
  return (
    <PageShell
      eyebrow="SHAPE ROADMAP"
      title="로드맵"
      contentTitle={category ?? "전체 로드맵"}
    >
      <p className="lead roadmap-lead">
        1월부터 12월까지 끊김 없이 이어지는 연간 흐름 위에서 일정을 확인합니다.
        일정 막대를 누르면 상세 내용을 볼 수 있습니다.
      </p>
      <ContinuousCalendar items={visible} category={category} />
    </PageShell>
  );
}
