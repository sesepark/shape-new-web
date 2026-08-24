import Image from "next/image";
import Link from "next/link";
import { Github, PlayCircle, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { ShapeUpWriteLink } from "@/components/shape-up-write-link";
import { api, listOrEmpty } from "@/lib/api";
import { date } from "@/lib/format";
import { media, optimizable } from "@/lib/media";

export const metadata = {
  title: "SHAPE-UP",
  description: "SHAPE-UP 팀 프로젝트가 한 학기 동안 만든 결과물을 공개합니다.",
};

export default async function ShapeUpPage() {
  const posts = await listOrEmpty(api.shapeUp());
  return (
    <PageShell eyebrow="SHAPE-UP RESULTS" title="소식" contentTitle="SHAPE-UP 결과물">
      <div className="shape-up-head">
        <p className="lead">
          정회원 팀이 한 학기 동안 실물 로봇과 직접 모은 데이터로 만든 결과물입니다. 과정과 결과를 남겨 다음 기수의 자산으로 축적합니다.
        </p>
        <ShapeUpWriteLink />
      </div>
      {posts.length === 0 ? (
        <EmptyState
          title="아직 공개된 결과물이 없습니다"
          description="SHAPE-UP 팀이 프로젝트를 마치면 이곳에 결과물을 올립니다."
        />
      ) : (
        <div className="shape-up-grid">
          {posts.map((post) => (
            <article className="shape-up-card" key={post.id}>
              <Link href={`/shape-up/${post.id}`}>
                <div className="shape-up-cover">
                  {post.coverImage ? (
                    <Image src={media(post.coverImage, 900)} alt="" width={900} height={560} unoptimized={!optimizable(post.coverImage)} />
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
                  <span className="shape-up-members"><Users size={14} /> {post.teamMembers.join(", ")}</span>
                )}
                <span className="shape-up-links">
                  {post.githubUrl && <a href={post.githubUrl} target="_blank" rel="noreferrer" aria-label="GitHub 저장소"><Github size={16} /></a>}
                  {post.videoUrl && <a href={post.videoUrl} target="_blank" rel="noreferrer" aria-label="데모 영상"><PlayCircle size={16} /></a>}
                  <time>{date(post.createdAt)}</time>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  );
}
