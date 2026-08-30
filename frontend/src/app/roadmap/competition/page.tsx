import { RoadmapView } from "@/components/roadmap-view";
export const metadata = {
  title: "대회 일정",
  description: "SHAPE가 참가하는 휴머노이드·로보틱스 대회의 예선 제출, 본선, 지원 마감 일정입니다.",
};
export default function CompetitionPage() { return <RoadmapView category="대회" />; }
