import { HomeScrollSnap } from "@/components/home-scroll-snap";
import { HomeHero, HomeIntro, HomeNext, HomeNumbers, HomePillars } from "@/components/home-sections";
import { api, itemOrNull, listOrEmpty } from "@/lib/api";
import { mergeHome } from "@/lib/home-content";
import { upcoming } from "@/lib/schedule";

export const metadata = {
  title: "SNU Physical AI Club",
  description:
    "서울대학교 Physical AI 동아리 SHAPE입니다. 교육·연구·검증 세 단계로 학부생이 실물 로봇을 다루는 인재로 성장합니다.",
};

export default async function HomePage() {
  // 로드맵은 /roadmap 과 같은 응답을 씁니다. Next.js Data Cache 가 5분 동안
  // 들고 있으므로 이 섹션 때문에 백엔드 호출이 늘지 않습니다. 목록을 못 받아
  // 오면 이 섹션만 조용히 빠집니다. 홈의 글귀는 관리자 › HOME 에서 고칩니다.
  const [page, roadmap] = await Promise.all([itemOrNull(api.page("home")), listOrEmpty(api.roadmap())]);
  const schedule = upcoming(roadmap, 3);
  // 저장된 값이 없거나 일부만 있어도 기본값으로 채워 그립니다. 홈은 서버에서
  // 그려지므로 여기서 비면 화면 전체가 빕니다.
  const home = mergeHome(page?.contentJson);

  return (
    <main className="shape-home">
      <HomeScrollSnap />
      <HomeHero home={home} />
      <HomeIntro home={home} />
      <HomePillars home={home} />
      <HomeNumbers home={home} />
      <HomeNext home={home} schedule={schedule} />
    </main>
  );
}
