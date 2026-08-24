"use client";

import Link from "next/link";
import { Eye, MessageSquare, PenLine, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { board } from "@/lib/board";
import { useSession } from "@/lib/session";
import { date } from "@/lib/format";
import type { NoticeCategory, NoticeItem } from "@/lib/types";

const categories = ["전체", "공지", "질문", "정보", "일반"] as const;
/** 서버가 한 번에 보내 주는 글 수. 백엔드의 NOTICE_PAGE 와 같아야 합니다. */
const PAGE = 30;

export function NoticeList() {
  const { session } = useSession();
  // 보기 전용 회원은 글을 쓰지 않습니다. 서버도 같은 기준으로 막습니다.
  const readOnly = session?.status === "VIEWER";
  const [items, setItems] = useState<NoticeItem[] | null>(null);
  const [category, setCategory] = useState<(typeof categories)[number]>("전체");
  // 목록은 한 번에 30개만 받습니다. 글이 쌓여도 목록을 여는 비용이 함께
  // 자라지 않도록, 더 오래된 글은 눌러서 이어 받습니다.
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void board("/notices", { signal: controller.signal })
      .then(async (response) => {
        const rows = response.ok ? ((await response.json()) as NoticeItem[]) : [];
        setItems(rows);
        setMore(rows.length >= PAGE);
      })
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);

  async function loadOlder() {
    const oldest = items?.[items.length - 1]?.publishedAt;
    if (!oldest) return;
    setLoading(true);
    const response = await board(`/notices?before=${encodeURIComponent(oldest)}`).catch(() => null);
    setLoading(false);
    if (!response?.ok) return;
    const rows = (await response.json()) as NoticeItem[];
    setMore(rows.length >= PAGE);
    // 상단 고정 글은 날짜와 상관없이 맨 앞에 오므로 다시 딸려 올 수 있습니다.
    setItems((current) => {
      const seen = new Set((current ?? []).map((item) => item.id));
      return [...(current ?? []), ...rows.filter((item) => !seen.has(item.id))];
    });
  }

  const visible = (items ?? []).filter((item) => category === "전체" || item.category === category);

  return (
    <div className="board">
      <div className="board-head">
        <div className="board-filter" aria-label="게시글 유형 필터">
          {categories.map((type) => (
            <button type="button" key={type} className={category === type ? "active" : ""} onClick={() => setCategory(type)}>
              {type}
            </button>
          ))}
        </div>
        {/* 보기 전용 회원은 읽기만 합니다. 눌러 봐야 서버가 막으므로 아예 안 보입니다. */}
        {readOnly ? (
          <span className="read-only-note"><Eye size={15} /> 보기 전용 계정입니다</span>
        ) : (
          <Link className="button small" href="/notices/write">
            <PenLine size={16} /> 글쓰기
          </Link>
        )}
      </div>
      {items === null ? (
        <p className="form-note">게시글을 불러오고 있습니다.</p>
      ) : visible.length ? (
        <ol className="board-list">
          {visible.map((item) => (
            <li key={item.id}>
              <Link href={`/notices/${item.id}`}>
                <span className={`board-category ${item.category}`}>
                  {item.isPinned && <Pin size={11} />}
                  {item.category}
                </span>
                <span className="board-title">
                  <span>{item.title}</span>
                  {item.commentCount > 0 && (
                    <b><MessageSquare size={12} /> {item.commentCount}</b>
                  )}
                </span>
                <span className="board-meta">
                  {item.authorName}
                  <time>{date(item.publishedAt)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <h2>{category === "전체" ? "등록된 게시글이 없습니다" : `${category} 게시글이 없습니다`}</h2>
          <p>첫 글을 남겨 보세요. 새 공지는 이 화면과 구독한 알림으로 함께 전달됩니다.</p>
        </div>
      )}
      {more && visible.length > 0 && (
        <button type="button" className="button secondary board-more" disabled={loading} onClick={() => void loadOlder()}>
          {loading ? "불러오는 중…" : "이전 글 더 보기"}
        </button>
      )}
    </div>
  );
}
