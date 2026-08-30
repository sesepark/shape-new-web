"use client";

import Link from "next/link";
import { Eye, MessageSquare, PenLine, Pin, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { board } from "@/lib/board";
import { useSession } from "@/lib/session";
import { date } from "@/lib/format";
import type { NoticeItem } from "@/lib/types";

const categories = ["전체", "공지", "질문", "정보", "일반"] as const;
/** 서버가 한 번에 보내 주는 글 수. 백엔드의 NOTICE_PAGE 와 같아야 합니다. */
const PAGE = 30;
/** 검색어를 치는 동안 매 글자마다 부르지 않도록 기다리는 시간. */
const TYPING_PAUSE = 300;

export function NoticeList() {
  const { session } = useSession();
  // 보기 전용 회원은 글을 쓰지 않습니다. 서버도 같은 기준으로 막습니다.
  const readOnly = session?.status === "VIEWER";
  /**
   * 받아 둔 목록과 **그것을 만든 질의**를 함께 들고 있습니다.
   *
   * 질의가 바뀌면 아직 안 온 것이므로 `items` 는 저절로 `null` 이 됩니다. 이
   * 값을 상태로 따로 두고 효과에서 `setItems(null)` 을 부르면, 효과 안에서
   * 동기적으로 상태가 바뀌어 그리기를 한 번 더 하게 됩니다(린트가 막습니다).
   * 계산해서 얻으면 상태가 하나 줄고 어긋날 자리도 없습니다.
   */
  const [loaded, setLoaded] = useState<{ query: string; rows: NoticeItem[]; more: boolean } | null>(null);
  const [category, setCategory] = useState<(typeof categories)[number]>("전체");
  // 화면에 친 것과 실제로 서버에 물은 것을 나눠 둡니다. 글자마다 부르면
  // 회원 한 명이 검색 한 번에 열 번 넘게 요청을 보냅니다.
  const [typed, setTyped] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(typed.trim()), TYPING_PAUSE);
    return () => window.clearTimeout(timer);
  }, [typed]);

  /**
   * 분류와 검색어를 **서버에** 넘깁니다.
   *
   * 예전에는 받아 온 30건 위에서 화면이 걸렀습니다. 그래서 최근 30건에 '질문'
   * 글이 없으면 "질문 게시글이 없습니다" 라고 말했습니다 — 실제로는 있는데도.
   * 게다가 그때 '이전 글 더 보기' 단추가 `visible.length > 0` 조건에 걸려
   * 사라져서, 더 받아 찾아볼 길까지 막혔습니다.
   */
  const query = useCallback((before?: string) => {
    const params = new URLSearchParams();
    if (category !== "전체") params.set("category", category);
    if (keyword) params.set("q", keyword);
    if (before) params.set("before", before);
    const text = params.toString();
    return `/notices${text ? `?${text}` : ""}`;
  }, [category, keyword]);

  const path = query();

  useEffect(() => {
    const controller = new AbortController();
    void board(path, { signal: controller.signal })
      .then(async (response) => {
        const rows = response.ok ? ((await response.json()) as NoticeItem[]) : [];
        setLoaded({ query: path, rows, more: rows.length >= PAGE });
      })
      .catch(() => setLoaded({ query: path, rows: [], more: false }));
    return () => controller.abort();
  }, [path]);

  // 질의가 바뀌면 아직 안 온 것입니다.
  const items = loaded?.query === path ? loaded.rows : null;
  const more = loaded?.query === path ? loaded.more : false;

  async function loadOlder() {
    const oldest = items?.[items.length - 1]?.publishedAt;
    if (!oldest) return;
    setLoading(true);
    const response = await board(query(oldest)).catch(() => null);
    setLoading(false);
    if (!response?.ok) return;
    const rows = (await response.json()) as NoticeItem[];
    // 상단 고정 글은 날짜와 상관없이 맨 앞에 오므로 다시 딸려 올 수 있습니다.
    setLoaded((current) => {
      if (!current || current.query !== path) return current;
      const seen = new Set(current.rows.map((item) => item.id));
      return { query: path, rows: [...current.rows, ...rows.filter((item) => !seen.has(item.id))], more: rows.length >= PAGE };
    });
  }

  const visible = items ?? [];
  const filtered = category !== "전체" || Boolean(keyword);

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
      <div className="board-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={search}
          type="search"
          value={typed}
          placeholder="제목으로 찾기"
          aria-label="게시글 제목으로 찾기"
          maxLength={60}
          onChange={(event) => setTyped(event.target.value)}
        />
        {typed && (
          <button type="button" aria-label="검색어 지우기" onClick={() => { setTyped(""); search.current?.focus(); }}>
            <X size={15} />
          </button>
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
                  <span className="board-author">{item.authorName}</span>
                  <time>{date(item.publishedAt)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <h2>
            {keyword
              ? `‘${keyword}’ 에 맞는 글이 없습니다`
              : category === "전체"
                ? "등록된 게시글이 없습니다"
                : `${category} 게시글이 없습니다`}
          </h2>
          <p>
            {filtered
              ? "찾는 말을 줄이거나 분류를 ‘전체’ 로 바꿔 보세요."
              : "첫 글을 남겨 보세요. 새 공지는 이 화면과 구독한 알림으로 함께 전달됩니다."}
          </p>
        </div>
      )}
      {/* 목록이 비어 있어도 이어받기를 막지 않습니다. 예전에는 `visible.length > 0`
          조건이 붙어 있어서, 거른 결과가 비면 더 받아 찾아볼 길이 사라졌습니다.
          지금은 서버가 걸러 주므로 비어 있으면 정말로 없는 것이지만, 이어받기를
          화면 상태에 매어 두지 않는 편이 다음에 또 같은 함정을 만들지 않습니다. */}
      {more && (
        <button type="button" className="button secondary board-more" disabled={loading} onClick={() => void loadOlder()}>
          {loading ? "불러오는 중…" : "이전 글 더 보기"}
        </button>
      )}
    </div>
  );
}
