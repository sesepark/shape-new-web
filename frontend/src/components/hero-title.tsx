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
      <h1>{title}</h1>
    </div>
  );
}
