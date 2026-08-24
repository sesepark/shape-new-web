import Image from "next/image";
import { notFound } from "next/navigation";
import { ExternalLinkBlock } from "@/components/external-link-block";
import { PageShell } from "@/components/page-shell";
import { api, itemOrNull, listOrEmpty } from "@/lib/api";
import { date } from "@/lib/format";
import { media, optimizable } from "@/lib/media";

async function newsItem(id: string) {
  return itemOrNull(api.newsDetail(id));
}

/**
 * 빌드 때 지금 올라와 있는 글을 미리 그려 둔다. 이렇게 하지 않으면 상세 페이지가
 * 방문할 때마다 Vercel 함수를 깨우는데, 무료 요금제에서 가장 먼저 차는 것이
 * 요청 수와 함수 호출이다. 미리 그려 두면 같은 페이지가 CDN 에서 바로 나간다.
 *
 * 목록을 못 받아 오면 빈 배열을 돌려준다. 배포 중에 API 가 잠깐 자고 있어도
 * 빌드가 깨지지 않아야 하고, 여기 없는 주소는 예전처럼 그때그때 그려진다.
 * 새 글은 저장 직후 백엔드가 `/api/revalidate` 로 알려 주므로 바로 반영된다.
 */
export async function generateStaticParams() {
  const news = await listOrEmpty(api.news());
  return news.map((item) => ({ id: item.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await newsItem(id);
  return item
    ? { title: item.title, description: item.summary, openGraph: { title: item.title, description: item.summary, type: "article" as const } }
    : { title: "뉴스" };
}

export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await newsItem(id);
  if (!item) notFound();
  const showLink = item.externalUrl && item.contentJson?.linkPreview !== false;
  return (
    <PageShell
      eyebrow="SHAPE NEWS"
      title="소식"
      contentTitle={item.title}
      activeNav={item.category === "언론보도" ? "/news/press" : "/news"}
    >
      <p className="article-meta">{item.category} · {date(item.publishedAt)}</p>
      {item.coverImage && <Image className="news-detail-cover" src={media(item.coverImage, 1400)} alt="" width={1400} height={800} unoptimized={!optimizable(item.coverImage)} />}
      <article className="rich-content news-detail-content" dangerouslySetInnerHTML={{ __html: item.contentHtml }} />
      {showLink && item.externalUrl && <ExternalLinkBlock url={item.externalUrl} preview={item.contentJson?.preview} />}
    </PageShell>
  );
}
