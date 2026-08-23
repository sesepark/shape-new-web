"use client";

import Image from "next/image";
import Link from "next/link";
import { CalendarDays, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { givenName, type ShapeMember } from "@/lib/members";
import { media, optimizable } from "@/lib/media";
import type { MemberProfile } from "@/lib/types";

const filters = ["전체", "준회원", "정회원", "알럼", "멤버"] as const;
const span = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" });

function period(project: MemberProfile["projects"][number]) {
  const starts = span.format(new Date(project.startsAt));
  return project.endsAt ? `${starts} — ${span.format(new Date(project.endsAt))}` : starts;
}

export function MemberDirectory({
  members,
  profiles = [],
}: {
  members: ShapeMember[];
  profiles?: MemberProfile[];
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("전체");
  const [openId, setOpenId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const byUser = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const visible = useMemo(
    () => (filter === "전체" ? members : members.filter((member) => (member.membership ?? "정회원") === filter)),
    [members, filter],
  );
  const active = visible.find((member) => member.id === openId) ?? null;
  const profile = active?.userId ? byUser.get(active.userId) : undefined;

  useEffect(() => {
    if (active && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [active]);

  function close() {
    dialog.current?.close();
    setOpenId(null);
  }

  return (
    <div className="member-directory">
      <div className="member-filter" role="tablist" aria-label="부원 구분 필터">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={filter === item}
            className={filter === item ? "active" : ""}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="member-grid">
        {visible.map((member, index) => (
          <article className="member-card" key={member.id} id={`member-${member.id}`} style={{ "--member-index": index } as CSSProperties}>
            <button type="button" className="member-open" onClick={() => setOpenId(member.id)}>
              <span className="sr-only">{member.name} 부원 자세히 보기</span>
            </button>
            <div className="member-photo">
              {member.imageUrl ? (
                <Image src={media(member.imageUrl, 560)} alt={`${member.name} 부원`} width={560} height={700} sizes="(max-width:680px) 45vw, 280px" unoptimized={!optimizable(member.imageUrl)} />
              ) : (
                <span aria-hidden="true">{givenName(member.name)}</span>
              )}
            </div>
            <div className="member-card-copy">
              <small>{member.membership ?? "정회원"} · {member.team}</small>
              <h3>{member.name}</h3>
              <p>{member.role} · {member.affiliation}</p>
            </div>
            <div className="member-hint" aria-hidden="true">자세히 보기</div>
          </article>
        ))}
      </div>

      <dialog
        ref={dialog}
        className="member-dialog"
        onClose={() => setOpenId(null)}
        onClick={(event) => { if (event.target === dialog.current) close(); }}
      >
        {active && (
          <article>
            <button className="dialog-close" type="button" onClick={close} aria-label="부원 정보 닫기">
              <X />
            </button>
            <header>
              <div className="member-dialog-photo">
                {(profile?.imageUrl ?? active.imageUrl) ? (
                  <Image src={media(profile?.imageUrl ?? active.imageUrl ?? "", 480)} alt="" width={480} height={600} unoptimized={!optimizable(profile?.imageUrl ?? active.imageUrl)} />
                ) : (
                  <span aria-hidden="true">{givenName(active.name)}</span>
                )}
              </div>
              <div>
                <small>{active.membership ?? "정회원"} · {active.team}</small>
                <h3>{active.name}</h3>
                <p>{active.role} · {active.affiliation}</p>
              </div>
            </header>
            {profile?.introduction ? (
              <blockquote className="member-dialog-intro">{profile.introduction}</blockquote>
            ) : (
              <p className="member-dialog-empty">아직 소개말을 등록하지 않았습니다.</p>
            )}
            <section className="member-dialog-projects">
              <h4><CalendarDays size={16} /> 참여 중인 프로젝트</h4>
              {profile?.projects.length ? (
                <ul>
                  {profile.projects.map((project) => (
                    <li key={project.id}>
                      <Link href="/roadmap" onClick={close}>
                        <span className="project-category">{project.category}</span>
                        <strong>{project.title}</strong>
                        <time>{period(project)}</time>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="member-dialog-empty">참여 중인 프로젝트가 없습니다.</p>
              )}
            </section>
          </article>
        )}
      </dialog>
    </div>
  );
}
