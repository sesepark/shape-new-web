import { RoadmapView } from "@/components/roadmap-view";

// 관리자 로드맵에는 '기타' 탭이 있고 전체 로드맵 화면에도 '기타' 칸이 그려지는데,
// 그 분류만 따로 보는 쪽이 없어 메뉴에서 빠져 있었습니다.
export const metadata = {
  title: "기타 일정",
  description: "부원 모집, 소개 부스, 시험 기간 휴식 등 SHAPE의 그 밖의 연간 일정입니다.",
};
export default function EtcRoadmapPage() { return <RoadmapView category="기타" />; }
