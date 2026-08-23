"use client";

import { Github, Instagram, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { date } from "@/lib/format";

export function PressDirectory({ items }: { items: NewsItem[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko");
    if (!keyword) return items;
    return items.filter((item) => `${item.title} ${item.summary}`.toLocaleLowerCase("ko").includes(keyword));
  }, [items, query]);

  return (
    <div className="press-directory">
      <div className="press-directory-tools">
        <label className="press-search">
          <span className="sr-only">언론보도 검색</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="검색어를 입력해주세요." />
          <Search aria-hidden="true" size={26} strokeWidth={2} />
        </label>
        <div className="press-socials" aria-label="SHAPE 소셜 채널">
          <a className="press-github" href="https://github.com/snu-shape" target="_blank" rel="noreferrer" aria-label="SHAPE GitHub"><Github size={26} /></a>
          <a href="https://www.instagram.com/snu_shape?igsh=NTJiMjJ3cjQ2Nzkx" target="_blank" rel="noreferrer" aria-label="SHAPE Instagram"><Instagram size={26} /></a>
        </div>
      </div>
      <section className="press-results" aria-live="polite">
        <p className="press-count">Total {filtered.length}건</p>
        <ol className="press-list">
          {filtered.map((item, index) => (
            <li key={item.id}>
              {/* 모든 항목이 SHAPE 상세 페이지로 들어가고, 원문 링크는 그 안에서 엽니다. */}
              <Link href={`/news/${item.id}`}>
                <span className="press-number">{filtered.length - index}</span>
                <span className="press-title">{item.title}</span>
                <time>{date(item.publishedAt)}</time>
              </Link>
            </li>
          ))}
        </ol>
        {filtered.length === 0 && <p className="press-empty">검색 결과가 없습니다.</p>}
      </section>
    </div>
  );
}
