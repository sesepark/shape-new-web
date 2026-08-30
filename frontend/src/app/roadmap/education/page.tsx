import { RoadmapView } from "@/components/roadmap-view";
export const metadata = {
  title: "교육 일정",
  description: "신입 부원 교육 트랙 일정 — 로봇팔 실습, 텔레오퍼레이션, 데이터 수집까지 회차별로 안내합니다.",
};
export default function EducationPage() { return <RoadmapView category="교육" />; }
