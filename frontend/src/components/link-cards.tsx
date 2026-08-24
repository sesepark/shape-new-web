"use client";

import { ExternalLink, Lock, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { board } from "@/lib/board";
import { loadSession } from "@/lib/session";
import type { LinkVisibility, RelatedLink } from "@/lib/types";

/**
 * 바로가기 카드 목록.
 *
 * 서버가 그려 준 **전체 공개** 목록을 그대로 받아 먼저 보여 줍니다. 그 목록은
 * 쿠키 없이 부른 것이라 Vercel 과 백엔드 양쪽 캐시에 담기고, 검색 엔진도 그대로
 * 읽습니다.
 *
 * 로그인한 사람에게는 부원 전용·운영진 전용 링크가 더 있을 수 있으므로, 세션이
 * 확인되면 그때 한 번 쿠키를 실어 다시 불러 목록을 갈아 끼웁니다. 로그인하지
 * 않은 방문자는 이 두 번째 요청을 아예 보내지 않습니다. 세션 확인
 * (`loadSession`)은 머리글이 어차피 하는 호출을 함께 쓰므로 여기서 새로
 * 드는 값이 없습니다.
 */
const badges: Record<Exclude<LinkVisibility, "PUBLIC">, { label: string; icon: typeof Lock }> = {
  MEMBER: { label: "부원 전용", icon: Users },
  STAFF: { label: "운영진 전용", icon: Lock },
};

export function LinkCards({ initial }: { initial: RelatedLink[] }) {
  const [links, setLinks] = useState(initial);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!(await loadSession())) return;
      const response = await board("/links");
      if (!response.ok || !active) return;
      const mine = (await response.json()) as RelatedLink[];
      if (active) setLinks(mine);
    })();
    return () => { active = false; };
  }, []);

  if (links.length === 0) {
    return (
      <EmptyState
        title="등록된 링크가 없습니다"
        description="운영진이 Drive, Notion, GitHub 등의 링크를 등록할 수 있습니다."
      />
    );
  }
  return (
    <div className="grid three">
      {links.map((item) => {
        const badge = item.visibility && item.visibility !== "PUBLIC" ? badges[item.visibility] : null;
        const Icon = badge?.icon;
        return (
          <a className="card" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
            <span className="meta link-card-meta">
              SHAPE LINK
              {badge && Icon && (
                <b className={`link-scope ${item.visibility?.toLowerCase()}`}>
                  <Icon size={11} aria-hidden="true" /> {badge.label}
                </b>
              )}
            </span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <span className="card-action">
              새 창에서 열기 <ExternalLink size={14} />
            </span>
          </a>
        );
      })}
    </div>
  );
}
