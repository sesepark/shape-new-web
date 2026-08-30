import { RoadmapView } from "@/components/roadmap-view";
export const metadata = {
  title: "SHAPE-UP 일정",
  description: "SHAPE-UP 팀 프로젝트의 학기 일정 — 팀 구성, 정기 미팅, 중간 발표, 최종 데모 데이까지 한눈에 봅니다.",
};
export default function ShapeUpPage() { return <RoadmapView category="SHAPE-UP" />; }
