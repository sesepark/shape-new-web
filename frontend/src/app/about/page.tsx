import { PageShell } from "@/components/page-shell";
import { api } from "@/lib/api";

const fallback = `<h2>SHAPE는 무엇을 하나요?</h2><p>SHAPE는 서울대학교에서 Physical AI를 탐구하고 실제 로봇 플랫폼으로 구현하는 학술동아리입니다. 인공지능이 화면 속을 넘어 물리 세계를 이해하고 행동하도록 만드는 일을 함께 연구합니다.</p><p>기초 교육과 스터디에서 출발해 팀별 프로젝트, 장비 실습, 데모 제작까지 이어지는 열린 제작 환경을 운영합니다.</p>`;

export const metadata = {
  title: "동아리 소개",
  description: "서울대학교 SHAPE의 활동 분야, 구성원, 운영 방식을 소개합니다.",
};

export default async function AboutPage() {
  const page = await api.page("club-introduction").catch(() => null);
  const contentHtml = page?.contentHtml || fallback;
  const facts = (page?.contentJson?.facts as
    Array<{ value?: string; label?: string }> | undefined) ?? [
    { value: "2026", label: "창설 연도" },
    { value: "35+", label: "현 부원" },
    { value: "3", label: "핵심 연구 분야" },
  ];
  return (
    <PageShell eyebrow="SNU SHAPE" title="SHAPE" contentTitle="동아리 소개">
      <article
        className="club-introduction rich-content"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
      <dl className="club-facts">
        {facts.slice(0, 4).map((fact, index) => (
          <div key={`${fact.label}-${index}`}>
            <dt>{fact.value || "—"}</dt>
            <dd>{fact.label || "소개 항목"}</dd>
          </div>
        ))}
      </dl>
    </PageShell>
  );
}
