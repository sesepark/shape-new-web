"use client";

import { History, X } from "lucide-react";
import { draftAge } from "@/lib/draft";

/**
 * "쓰다 만 글이 있습니다" 줄.
 *
 * 글쓰기 화면을 열었을 때 임시 저장이 남아 있으면 맨 위에 뜹니다. **자동으로
 * 되살리지 않습니다** — 새 글을 쓰려고 들어온 사람의 빈 화면에 지난 글이 저절로
 * 채워지면, 지우고 시작해야 하는 짐이 됩니다. 되살릴지는 본인이 고릅니다.
 */
export function DraftNotice({
  at,
  onRestore,
  onDiscard,
}: {
  at: number;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="draft-notice" role="status">
      <History size={16} aria-hidden="true" />
      {/* 시각을 문장 안에 넣지 않습니다. `draftAge` 가 "방금"·"3분 전"·"14:20"·
          "8월 29일 14:20" 을 돌려주는데, 어떤 조사를 붙여도 넷 중 하나는
          어긋납니다("방금에 쓰다 만 글이"). 따로 떼어 적으면 넷 다 자연스럽습니다. */}
      <p>
        쓰다 만 글이 남아 있습니다. 이어서 쓰시겠어요?
        <span className="draft-when">마지막 저장 {draftAge(at)}</span>
      </p>
      <div className="inline-actions">
        <button type="button" className="button small" onClick={onRestore}>이어서 쓰기</button>
        <button type="button" className="text-button" onClick={onDiscard}>
          <X size={14} aria-hidden="true" /> 버리고 새로 쓰기
        </button>
      </div>
    </div>
  );
}

/**
 * "방금 임시 저장됨" 표시.
 *
 * 저장 단추 옆에 조용히 붙습니다. 이것이 없으면 사람은 임시 저장이 되고 있는지
 * 알 수 없고, 알 수 없으면 있으나 마나입니다.
 */
export function DraftSaved({ at }: { at: number | null }) {
  if (!at) return null;
  return (
    <span className="draft-saved" role="status">
      임시 저장됨 · {draftAge(at)} · 이 브라우저에만 남습니다
    </span>
  );
}
