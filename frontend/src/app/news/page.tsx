import Link from "next/link";
import Image from "next/image";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";
import { media } from "@/lib/media";
import { date } from "@/lib/format";
import { mockNews } from "@/lib/mock-data";

export const metadata = {
  title: "뉴스",
  description: "SHAPE의 활동 소식과 프로젝트 기록입니다.",
};

export default async function NewsPage() {
  const news = [...(await listOrEmpty(api.news(), mockNews))]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return (
    <PageShell eyebrow="SHAPE NEWS" title="소식" contentTitle="SHAPE의 기록">
      {news.length === 0 ? (
        <EmptyState
          title="등록된 뉴스가 없습니다"
          description="운영진은 관리자 페이지에서 뉴스와 외부 링크를 등록할 수 있습니다."
        />
      ) : (
        <div className="news-featured-list">
          {news.map((item) => (
            <article className="news-featured-card" key={item.id}>
              {item.coverImage ? <Image src={media(item.coverImage, 1200)} alt="" width={1200} height={760} unoptimized /> : <div className="news-featured-placeholder" aria-hidden="true">SHAPE NEWS</div>}
              <div className="news-featured-copy"><span className="meta">{item.category} · {date(item.publishedAt)}</span><h3>{item.title}</h3><p>{item.summary}</p><Link className="card-action" href={`/news/${item.id}`}>자세히 보기</Link></div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  );
}
