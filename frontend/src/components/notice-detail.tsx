"use client";

import Link from "next/link";
import { ArrowLeft, Pencil, Pin, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAsk } from "@/components/ask-dialog";
import { NoticeComments } from "@/components/notice-comments";
import { board } from "@/lib/board";
import { date } from "@/lib/format";
import type { NoticeDetail } from "@/lib/types";
import { MathContent } from "@/components/math-content";

export function NoticeDetailView({ noticeId }: { noticeId: string }) {
  const router = useRouter();
  const { ask, dialogNode } = useAsk();
  const [item, setItem] = useState<NoticeDetail | null | undefined>(undefined);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void board(`/notices/${noticeId}`, { signal: controller.signal })
      .then(async (response) => setItem(response.ok ? ((await response.json()) as NoticeDetail) : null))
      .catch(() => setItem(null));
    return () => controller.abort();
  }, [noticeId]);

  async function remove() {
    const confirmed = await ask({
      title: "이 글을 삭제할까요?",
      description: "달린 댓글도 함께 사라지며 되돌릴 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (confirmed === null) return;
    if ((await board(`/notices/${noticeId}`, { method: "DELETE" })).ok) {
      router.push("/notices");
      router.refresh();
      return;
    }
    setMessage("글을 삭제하지 못했습니다.");
  }

  if (item === undefined) return <p className="form-note">글을 불러오고 있습니다.</p>;
  if (item === null)
    return (
      <div className="empty-state">
        <h2>글을 찾을 수 없습니다</h2>
        <p>삭제되었거나 주소가 잘못되었습니다.</p>
        <Link className="button" href="/notices">게시판으로 돌아가기</Link>
      </div>
    );

  return (
    <div className="board-detail">
      <Link className="detail-back" href="/notices"><ArrowLeft size={16} /> 게시판</Link>
      <header className="board-detail-head">
        <span className={`board-category ${item.category}`}>
          {item.isPinned && <Pin size={11} />}
          {item.category}
        </span>
        <h2>{item.title}</h2>
        {/* 글쓴이·날짜는 왼쪽, 수정·삭제는 오른쪽에 둡니다. 넷을 모두 왼쪽에
            쌓으면 한쪽만 빽빽하고 오른쪽이 비어 보입니다. */}
        <div className="board-detail-meta">
          <p>
            {item.authorName}
            <time>{date(item.publishedAt)}</time>
          </p>
          {item.canEdit && (
            <div className="inline-actions">
              <Link className="button secondary small" href={`/notices/write?id=${item.id}`}>
                <Pencil size={14} /> 수정
              </Link>
              <button type="button" className="text-button danger" onClick={remove}>
                <Trash2 size={14} /> 삭제
              </button>
            </div>
          )}
        </div>
      </header>
      {message && <p className="save-notice">{message}</p>}
      <article className="rich-content board-body" dangerouslySetInnerHTML={{ __html: item.contentHtml }} />
      <MathContent html={item.contentHtml} />
      <NoticeComments noticeId={item.id} />
      {dialogNode}
    </div>
  );
}
