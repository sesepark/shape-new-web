"use client";

import { useEffect, useRef } from "react";
import { ShapeWordmark } from "@/components/shape-wordmark";

export function HeroTitle({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    const hero = element?.closest(".page-hero");
    if (!element || !hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      hero.classList.add("hero-motion-visible");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) =>
        hero.classList.toggle("hero-motion-visible", entry.isIntersecting),
      { threshold: 0.22, rootMargin: "0px 0px -8%" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="page-title" ref={ref}>
      <ShapeWordmark text={eyebrow} />
      {/* 여기 적히는 것은 **묶음 이름**입니다 — 부원·조직도·연락이 모두
          "SHAPE" 를 답니다. 그래서 h1 이 아닙니다. 예전에는 h1 이어서 공개
          페이지 열여덟 쪽이 h1 을 네 종류만 썼고, 검색에 가장 걸리기를 바라는
          뉴스 기사 상세조차 h1 이 "소식" 이었습니다. 쪽마다 다른 진짜 이름은
          `PageShell` 의 `contentTitle` 이 h1 으로 답니다. 보이는 그림은
          그대로입니다. */}
      <div className="page-hero-name">{title}</div>
    </div>
  );
}
