import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Github, PlayCircle, Users } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ShapeUpOwnerActions } from "@/components/shape-up-owner-actions";
import { allShapeUp, api, itemOrNull } from "@/lib/api";
import { date } from "@/lib/format";
import { media, optimizable } from "@/lib/media";
import { youtubeEmbed } from "@/lib/youtube";
import type { ShapeUpBlock } from "@/lib/types";

/** 빌드 때 미리 그려 둔다. 이유는 `news/[id]/page.tsx` 의 같은 함수 주석에 있다. */
export async function generateStaticParams() {
  // 첫 60편만 보면 그 뒤 기수의 쪽이 미리 그려지지 않습니다. 전부 봅니다.
  const posts = await allShapeUp();
  return posts.map((item) => ({ id: String(item.id) }));
}

async function post(id: string) {
  return itemOrNull(api.shapeUpDetail(id));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await post(id);
  return item
    ? { title: item.title, description: item.summary, openGraph: { title: item.title, description: item.summary, type: "article" as const } }
    : { title: "SHAPE-UP" };
}

/**
 * 글 한 토막.
 *
 * 자유 편집기가 아니라 **정해진 칸**이라 태그가 들어올 자리가 없습니다. 줄바꿈만
 * 살리면 되므로 `white-space: pre-line` 을 쓰고, HTML 을 그대로 심지 않습니다.
 * 비어 있으면 제목까지 통째로 사라집니다 — 채우지 않은 칸이 빈 제목만 남기고
 * 서 있으면 미완성으로 보입니다.
 */
function Section({ id, title, body }: { id: string; title: string; body: string }) {
  if (!body.trim()) return null;
  return (
    <section className="paper-section" id={id}>
      <h2>{title}</h2>
      <p className="paper-prose">{body}</p>
    </section>
  );
}

/**
 * 방법·결과에 쌓이는 덩이 하나.
 *
 * 영상이 있으면 영상을, 없으면 그림을 그립니다. 둘 다 없으면 설명만 남습니다.
 * 영상은 유튜브에서 오므로 우리 대역폭을 쓰지 않습니다.
 */
function Block({ block, index }: { block: ShapeUpBlock; index: number }) {
  const embed = youtubeEmbed(block.video);
  return (
    <figure className="paper-block">
      {embed ? (
        <div className="paper-embed">
          <iframe
            src={embed}
            title={block.caption || `영상 ${index + 1}`}
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : block.image ? (
        <Image
          src={media(block.image, 1400, "high")}
          sizes="(max-width: 1100px) 100vw, 1040px"
          quality={90}
          alt={block.caption || ""}
          width={1400}
          height={860}
          unoptimized={!optimizable(block.image)}
          // 첫 덩이만 먼저 받습니다. 나머지는 스크롤이 닿을 때 받아, 결과가 많은
          // 팀의 쪽이 열자마자 열몇 장을 한꺼번에 받지 않게 합니다.
          loading={index === 0 ? "eager" : "lazy"}
        />
      ) : null}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

function Blocks({ id, title, blocks }: { id: string; title: string; blocks: ShapeUpBlock[] }) {
  if (!blocks.length) return null;
  return (
    <section className="paper-section" id={id}>
      <h2>{title}</h2>
      <div className="paper-blocks">
        {blocks.map((block, index) => (
          <Block key={`${id}-${index}`} block={block} index={index} />
        ))}
      </div>
    </section>
  );
}

/**
 * SHAPE-UP 결과물 한 편.
 *
 * 논문 프로젝트 페이지(openvla.github.io 류)와 같은 차례로 그립니다 — 제목 →
 * 팀·기수 → 링크 줄 → 대표 화면 → 초록 → 문제설정 → 방법 → 결과 → 한계.
 * **팀이 고를 수 있는 것은 내용뿐이고 차례와 서식은 여기서 정합니다.** 그래서
 * 여덟 팀이 올려도 여덟 쪽이 같은 모양으로 나옵니다.
 */
export default async function ShapeUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await post(id);
  if (!item) notFound();
  const hero = youtubeEmbed(item.videoUrl);
  return (
    <PageShell eyebrow="SHAPE-UP RESULTS" title="소식" contentTitle={item.title}>
      <Link className="detail-back" href="/shape-up"><ArrowLeft size={16} /> SHAPE-UP 결과물</Link>
      <article className="paper">
        <header className="paper-head">
          <p className="article-meta">
            {item.cohort || "SHAPE-UP"}
            {item.teamName && ` · ${item.teamName}`} · {date(item.createdAt)}
          </p>
          {item.teamMembers.length > 0 && (
            <p className="paper-authors"><Users size={15} aria-hidden="true" /> {item.teamMembers.join(" · ")}</p>
          )}
          {item.summary && <p className="paper-lead">{item.summary}</p>}
          {/* 논문 페이지의 링크 줄. 낸 것만 나옵니다. */}
          <div className="paper-links">
            {item.githubUrl && (
              <a className="button secondary small" href={item.githubUrl} target="_blank" rel="noreferrer">
                <Github size={15} aria-hidden="true" /> 코드
              </a>
            )}
            {item.videoUrl && (
              <a className="button secondary small" href={item.videoUrl} target="_blank" rel="noreferrer">
                <PlayCircle size={15} aria-hidden="true" /> 영상
              </a>
            )}
            {item.slidesUrl && (
              <a className="button secondary small" href={item.slidesUrl} target="_blank" rel="noreferrer">
                <FileText size={15} aria-hidden="true" /> 발표자료
              </a>
            )}
            <ShapeUpOwnerActions post={item} />
          </div>
        </header>

        {/* 대표 화면 — 영상을 냈으면 영상이 먼저입니다. */}
        {hero ? (
          <div className="paper-embed paper-hero">
            <iframe
              src={hero}
              title={`${item.title} 데모 영상`}
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : item.coverImage ? (
          <Image
            className="paper-hero"
            src={media(item.coverImage, 1400, "high")}
            sizes="(max-width: 1100px) 100vw, 1040px"
            quality={90}
            alt=""
            width={1400}
            height={800}
            unoptimized={!optimizable(item.coverImage)}
            priority
          />
        ) : null}

        <Section id="abstract" title="초록" body={item.abstract} />
        <Section id="problem" title="문제 설정" body={item.problem} />
        <Blocks id="method" title="방법" blocks={item.methodBlocks} />
        <Blocks id="results" title="결과" blocks={item.resultBlocks} />
        <Section id="limitations" title="한계와 다음 과제" body={item.limitations} />
      </article>
    </PageShell>
  );
}
