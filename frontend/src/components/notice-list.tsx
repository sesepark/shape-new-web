"use client";

import Link from "next/link";
import { MessageSquare, PenLine, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { board } from "@/lib/board";
import { date } from "@/lib/format";
import type { NoticeCategory, NoticeItem } from "@/lib/types";

const categories = ["전체", "공지", "질문", "정보", "일반"] as const;

export function NoticeList() {
  const [items, setItems] = useState<NoticeItem[] | null>(null);
  const [category, setCategory] = useState<(typeof categories)[number]>("전체");

  useEffect(() => {
    const controller = new AbortController();
    void board("/notices", { signal: controller.signal })
      .then(async (response) => setItems(response.ok ? ((await response.json()) as NoticeItem[]) : []))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);

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
        <Link className="button small" href="/notices/write">
          <PenLine size={16} /> 글쓰기
        </Link>
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
    </div>
  );
}
