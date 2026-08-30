import Image from "next/image";
import Link from "next/link";
import { FileText, Github, PlayCircle, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { ShapeUpWriteLink } from "@/components/shape-up-write-link";
import { allShapeUp } from "@/lib/api";
import { date } from "@/lib/format";
import { media, optimizable } from "@/lib/media";
import { youtubeThumbnail } from "@/lib/youtube";
import type { ShapeUpItem } from "@/lib/types";

export const metadata = {
  title: "SHAPE-UP",
  description: "SHAPE-UP 팀 프로젝트가 한 학기 동안 만든 결과물을 공개합니다.",
};

/**
 * 기수별로 묶습니다. 이미 최신순으로 온 목록의 차례를 그대로 씁니다.
 *
 * 여기서 다시 정렬하지 않는 이유는 기수 이름이 자유 입력이기 때문입니다
 * ("2026-2", "2026 가을", "1기" 가 섞일 수 있습니다). 글자로 정렬하면 사람이
 * 기대하는 차례와 어긋나므로, **올린 시각 차례를 믿습니다.**
 */
function byCohort(posts: ShapeUpItem[]) {
  const groups: { cohort: string; posts: ShapeUpItem[] }[] = [];
  for (const post of posts) {
    const cohort = post.cohort.trim() || "기수 미정";
    const last = groups[groups.length - 1];
    if (last && last.cohort === cohort) last.posts.push(post);
    else groups.push({ cohort, posts: [post] });
  }
  return groups;
}

function Card({ post }: { post: ShapeUpItem }) {
  // 표지를 안 올렸어도 유튜브 미리보기가 있으면 그것을 씁니다. **유튜브가 보내
  // 주므로 우리 대역폭을 쓰지 않습니다.**
  const thumbnail = post.coverImage ? media(post.coverImage, 900, "high") : youtubeThumbnail(post.videoUrl);
  return (
    <article className="shape-up-card">
      <Link href={`/shape-up/${post.id}`}>
        <div className="shape-up-cover">
          {thumbnail ? (
            <Image
              src={thumbnail}
              sizes="(max-width: 900px) 100vw, 420px"
              quality={88}
              alt=""
              width={900}
              height={560}
              unoptimized={!optimizable(post.coverImage ?? "")}
            />
          ) : (
            <span aria-hidden="true">SHAPE-UP</span>
          )}
        </div>
        <div className="shape-up-copy">
          <span className="meta">
            {post.cohort || "SHAPE-UP"}
            {post.teamName && <i>· {post.teamName}</i>}
          </span>
          <h3>{post.title}</h3>
          <p>{post.summary}</p>
        </div>
      </Link>
      <div className="shape-up-foot">
        {post.teamMembers.length > 0 && (
          <span className="shape-up-members"><Users size={14} aria-hidden="true" /> {post.teamMembers.join(", ")}</span>
        )}
        <span className="shape-up-links">
          {post.githubUrl && <a href={post.githubUrl} target="_blank" rel="noreferrer" aria-label="코드 저장소"><Github size={16} /></a>}
          {post.videoUrl && <a href={post.videoUrl} target="_blank" rel="noreferrer" aria-label="데모 영상"><PlayCircle size={16} /></a>}
          <time>{date(post.createdAt)}</time>
        </span>
      </div>
    </article>
  );
}

/**
 * SHAPE-UP 결과물 목록.
 *
 * **기수별로 묶고 지난 기수는 접어 둡니다.** 학기당 열 편이 쌓이면 몇 해 뒤에는
 * 한 화면에 백 편이 늘어서는데, 그중 지금 기수를 찾는 사람이 대부분입니다.
 * 접힌 칸의 그림은 브라우저가 받아 오지 않으므로(`loading="lazy"` 가 숨은
 * 요소에 걸립니다) 목록이 무거워지지도 않습니다. 접혀 있어도 글은 HTML 안에
 * 그대로 있어 검색 엔진은 전부 읽어 갑니다.
 */
export default async function ShapeUpPage() {
  const posts = await allShapeUp();
  const groups = byCohort(posts);
  return (
    <PageShell eyebrow="SHAPE-UP RESULTS" title="소식" contentTitle="SHAPE-UP 결과물">
      <div className="shape-up-head">
        <p className="lead">
          정회원 팀이 한 학기 동안 실물 로봇과 직접 모은 데이터로 만든 결과물입니다. 과정과 결과를 남겨 다음 기수의 자산으로 축적합니다.
        </p>
        <ShapeUpWriteLink />
      </div>
      {groups.length === 0 ? (
        <EmptyState
          title="아직 공개된 결과물이 없습니다"
          description="SHAPE-UP 팀이 프로젝트를 마치면 이곳에 결과물을 올립니다."
        />
      ) : (
        groups.map((group, index) => (
          <section className="shape-up-cohort" key={`${group.cohort}-${index}`}>
            {/* 첫 기수는 펼쳐 두고 나머지는 접습니다. `open` 을 조건으로 주는
                것이지 CSS 로 감추는 것이 아니라, 접힌 칸의 그림은 아예
                받아 오지 않습니다. */}
            <details open={index === 0}>
              <summary>
                <span className="shape-up-cohort-name">{group.cohort}</span>
                <span className="shape-up-cohort-count">{group.posts.length}편</span>
              </summary>
              <div className="shape-up-grid">
                {group.posts.map((post) => <Card key={post.id} post={post} />)}
              </div>
            </details>
          </section>
        ))
      )}
    </PageShell>
  );
}
