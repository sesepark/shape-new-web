import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Github, PlayCircle, Users } from "lucide-react";
import { ExternalLinkBlock } from "@/components/external-link-block";
import { PageShell } from "@/components/page-shell";
import { ShapeUpOwnerActions } from "@/components/shape-up-owner-actions";
import { api, itemOrNull } from "@/lib/api";
import { date } from "@/lib/format";
import { media, optimizable } from "@/lib/media";

async function post(id: string) {
  return itemOrNull(api.shapeUpDetail(id), () => null);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await post(id);
  return item
    ? { title: item.title, description: item.summary, openGraph: { title: item.title, description: item.summary, type: "article" as const } }
    : { title: "SHAPE-UP" };
}

export default async function ShapeUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await post(id);
  if (!item) notFound();
  return (
    <PageShell eyebrow="SHAPE-UP RESULTS" title="소식" contentTitle={item.title}>
      <Link className="detail-back" href="/shape-up"><ArrowLeft size={16} /> SHAPE-UP 결과물</Link>
      <header className="shape-up-detail-head">
        <p className="article-meta">
          {item.cohort || "SHAPE-UP"}
          {item.teamName && ` · ${item.teamName}`} · {date(item.createdAt)}
        </p>
        {item.summary && <p className="shape-up-summary">{item.summary}</p>}
        {item.teamMembers.length > 0 && (
          <p className="shape-up-members"><Users size={15} /> {item.teamMembers.join(" · ")}</p>
        )}
        <div className="shape-up-actions">
          {item.githubUrl && (
            <a className="button secondary small" href={item.githubUrl} target="_blank" rel="noreferrer">
              <Github size={15} /> GitHub Project Page
            </a>
          )}
          {item.videoUrl && (
            <a className="button secondary small" href={item.videoUrl} target="_blank" rel="noreferrer">
              <PlayCircle size={15} /> 데모 영상
            </a>
          )}
          <ShapeUpOwnerActions post={item} />
        </div>
      </header>
      {item.coverImage && (
        <Image className="news-detail-cover" src={media(item.coverImage, 1400)} alt="" width={1400} height={800} unoptimized={!optimizable(item.coverImage)} />
      )}
      <article className="rich-content news-detail-content" dangerouslySetInnerHTML={{ __html: item.contentHtml }} />
      {item.videoUrl && <ExternalLinkBlock url={item.videoUrl} />}
    </PageShell>
  );
}
