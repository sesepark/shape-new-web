import Image from "next/image";
import { notFound } from "next/navigation";
import { ExternalLinkBlock } from "@/components/external-link-block";
import { PageShell } from "@/components/page-shell";
import { api, itemOrNull } from "@/lib/api";
import { date } from "@/lib/format";
import { media } from "@/lib/media";
import { mockNews } from "@/lib/mock-data";

async function newsItem(id: string) {
  return itemOrNull(api.newsDetail(id), () => mockNews.find((news) => news.id === id) ?? null);
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
      {item.coverImage && <Image className="news-detail-cover" src={media(item.coverImage, 1400)} alt="" width={1400} height={800} unoptimized />}
      <article className="rich-content news-detail-content" dangerouslySetInnerHTML={{ __html: item.contentHtml }} />
      {showLink && item.externalUrl && <ExternalLinkBlock url={item.externalUrl} preview={item.contentJson?.preview} />}
    </PageShell>
  );
}
