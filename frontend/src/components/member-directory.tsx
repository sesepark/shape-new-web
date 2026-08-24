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
/**
 * 처음부터 사진을 붙여 둘 카드 수. 어떤 화면 폭에서도 첫 화면을 채울 만큼입니다.
 * 나머지는 카드가 가까워졌을 때 붙입니다.
 */
const FIRST_SCREEN = 8;
/** 카드가 화면에 닿기 전에 미리 받아 둘 거리. 스크롤해도 빈 칸이 보이지 않습니다. */
const PHOTO_MARGIN = "400px 0px";
const span = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" });

function period(project: MemberProfile["projects"][number]) {
  const starts = span.format(new Date(project.startsAt));
  return project.endsAt ? `${starts} — ${span.format(new Date(project.endsAt))}` : starts;
}

/**
 * 부원 카드의 사진 한 장.
 *
 * `next/image` 는 기본으로 lazy 지만 브라우저가 잡는 여유 범위가 넓어, 서른 장이
 * 넘는 격자에서는 스크롤하지 않아도 대부분이 내려받아집니다. 무료 요금제에서는
 * 요청 수가 먼저 차므로, 첫 화면 몫만 처음부터 그리고 나머지는 카드가 가까워질
 * 때 붙입니다. 사진이 없는 부원은 지금까지처럼 이름을 크게 씁니다.
 */
function MemberPhoto({ member, photo, index }: { member: ShapeMember; photo?: string | null; index: number }) {
  const [near, setNear] = useState(index < FIRST_SCREEN);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { rootMargin: PHOTO_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  if (!photo) {
    return (
      <div className="member-photo">
        <span aria-hidden="true">{givenName(member.name)}</span>
      </div>
    );
  }
  return (
    <div className="member-photo" ref={box}>
      {near && (
        <Image
          src={media(photo, 560)}
          alt={`${member.name} 부원`}
          width={560}
          height={700}
          sizes="(max-width:680px) 45vw, 280px"
          unoptimized={!optimizable(photo)}
        />
      )}
    </div>
  );
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

  /**
   * 카드에 쓸 사진.
   *
   * 구글 계정과 SHAPE 부원 카드에 사진이 따로 있어서, 계정을 연결해 두고도
   * 격자에는 옛 사진이 남아 두 개가 갈렸습니다. 연결된 계정이 있으면 그쪽을
   * 먼저 쓰고, 아직 가입하지 않은 1기 부원은 카드에 저장된 사진을 씁니다.
   */
  const photoOf = (member: ShapeMember) =>
    (member.userId ? byUser.get(member.userId)?.imageUrl : null) ?? member.imageUrl ?? null;

  useEffect(() => {
    if (active && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [active]);

  /**
   * 주소에 `#member-…` 가 붙어 오면 그 부원 카드를 바로 엽니다.
   *
   * 조직도의 '○○○ 프로필' 이 이 주소로 보냅니다. 예전에는 그 자리로 내려가기만
   * 하고 아무 일도 일어나지 않아, 눌러도 프로필을 볼 수 없었습니다. 회원 구분을
   * 걸러 둔 상태에서도 열리도록 거르기를 함께 풉니다.
   */
  useEffect(() => {
    const openFromHash = () => {
      const wanted = decodeURIComponent(window.location.hash.replace(/^#member-/, ""));
      if (!wanted || !members.some((member) => member.id === wanted)) return;
      setFilter("전체");
      setOpenId(wanted);
    };
    // 첫 그림이 끝난 뒤에 엽니다. 그리는 도중에 열면 자리 계산이 어긋납니다.
    const timer = window.setTimeout(openFromHash, 0);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [members]);

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
            <MemberPhoto member={member} photo={photoOf(member)} index={index} />
            <div className="member-card-copy">
              <small>{member.membership ?? "정회원"}</small>
              <h3>{member.name}</h3>
              <p>{[member.role, member.affiliation].filter(Boolean).join(" · ")}</p>
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
                <small>{active.membership ?? "정회원"}</small>
                <h3>{active.name}</h3>
                <p>{[active.role, active.affiliation].filter(Boolean).join(" · ")}</p>
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
