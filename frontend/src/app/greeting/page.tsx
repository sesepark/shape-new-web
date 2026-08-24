import { PageShell } from "@/components/page-shell";
import { api } from "@/lib/api";
import { MathContent } from "@/components/math-content";

export const metadata = {
  title: "인사말",
  description: "서울대학교 SHAPE 운영진의 인사말입니다.",
};

export default async function GreetingPage() {
  const page = await api.page("greeting").catch(() => null);
  return (
    <PageShell eyebrow="" title="인사말" contentTitle={page?.title || "SHAPE에 오신 것을 환영합니다"}>
      {page?.contentHtml ? (
        <>
          <article className="greeting-content is-managed rich-content" dangerouslySetInnerHTML={{ __html: page.contentHtml }} />
          <MathContent html={page.contentHtml} />
        </>
      ) : (
        <article className="greeting-content">
          <div className="greeting-column">
            <p className="greeting-intro">현실을 움직이는 AI를<br /><em>함께 만들어 갑니다.</em></p>
            <p>SHAPE는 호기심을 실제 움직임으로 연결하는 서울대학교의 휴머노이드 및 Physical AI 커뮤니티입니다. 서로 다른 전공과 경험을 가진 구성원이 배우고, 만들고, 나누며 함께 성장합니다.</p>
          </div>
          <div className="greeting-column greeting-message">
            <p>우리는 로봇이 현실을 더 깊이 이해하고 안전하게 행동하도록 만드는 과정을 탐구합니다. 기초 스터디부터 팀 프로젝트와 장비 실습까지, 아이디어가 작동하는 결과물이 되도록 서로를 돕습니다.</p>
            <p>SHAPE에서 새로운 질문을 발견하고, 동료들과 답을 만들어 가시길 바랍니다.</p>
            <p className="greeting-signoff">서울대학교 SHAPE<br /><span>운영진 일동</span></p>
          </div>
        </article>
      )}
    </PageShell>
  );
}
