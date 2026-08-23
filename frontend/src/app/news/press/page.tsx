import { PageShell } from "@/components/page-shell";
import { PressDirectory } from "@/components/press-directory";
import { api, listOrEmpty } from "@/lib/api";
import { mockNews } from "@/lib/mock-data";

export const metadata = {
  title: "언론보도",
  description: "SHAPE가 언론과 외부 채널에 소개된 기사, 영상, 소셜 콘텐츠입니다.",
};

export default async function PressPage() {
  const news = await listOrEmpty(api.news("언론보도"), mockNews.filter((item) => item.category === "언론보도"));
  const press = [...news].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return (
    <PageShell eyebrow="SHAPE PRESS" title="소식" contentTitle="언론보도">
      <PressDirectory items={press} />
    </PageShell>
  );
}
