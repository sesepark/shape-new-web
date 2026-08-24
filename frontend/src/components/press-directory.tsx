"use client";

import Image from "next/image";
import { Github, Instagram, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { date } from "@/lib/format";
import { media, optimizable } from "@/lib/media";

/**
 * 언론에 실린 기사 목록.
 *
 * 예전에는 번호와 제목, 날짜만 한 줄로 늘어놓았습니다. 어떤 기사인지 열어 보기
 * 전에는 알 수 없어서, 원문에서 읽어 둔 대표 이미지와 요약을 함께 보여 줍니다.
 * 그림은 신문사 서버에서 그대로 오므로 크기가 제각각입니다. 카드가 비율을
 * 고정하고 잘라 내어 어떤 그림이 와도 목록이 흐트러지지 않게 합니다.
 */
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
                <span className="press-thumb" aria-hidden="true">
                  {item.coverImage ? (
                    <Image
                      src={media(item.coverImage, 400, "eco")}
                      alt=""
                      width={400}
                      height={250}
                      sizes="(max-width:760px) 100vw, 200px"
                      unoptimized={!optimizable(item.coverImage)}
                    />
                  ) : (
                    <span className="press-thumb-blank">PRESS</span>
                  )}
                </span>
                <span className="press-copy">
                  <strong className="press-title">{item.title}</strong>
                  {item.summary && <span className="press-summary">{item.summary}</span>}
                </span>
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
