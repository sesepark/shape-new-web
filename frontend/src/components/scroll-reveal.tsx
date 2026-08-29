"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 화면에 들어오는 순서대로 자식을 하나씩 드러냅니다.
 *
 * ## Suspense 경계를 직속 자식으로 두지 마세요
 *
 * 이 컴포넌트는 **자식의 `className` 과 인라인 스타일을 직접 고칩니다.** 그런데
 * `<Suspense>` 안쪽은 바깥 트리보다 **늦게 하이드레이션**됩니다. 그래서 Suspense
 * 가 직속 자식이면, 아직 React 가 넘겨받지 않은 노드를 여기서 먼저 건드리게 되고
 * 곧이어 하이드레이션이 서버가 보낸 `className` 과 어긋난 것을 발견합니다.
 * `/equipment/reserve` 에서 실제로 그랬습니다.
 *
 * 고치는 방법은 간단합니다 — **Suspense 를 평범한 상자로 한 번 감싸세요.** 그
 * 상자는 바깥 트리에 속해 먼저 하이드레이션되므로 여기서 건드려도 안전하고,
 * 안쪽은 아예 대상에 들어오지 않습니다.
 */
export function ScrollReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const targets = Array.from(
      new Set([
        ...element.querySelectorAll<HTMLElement>(":scope > *"),
        ...element.querySelectorAll<HTMLElement>(
          ".equipment-catalog-card, .calendar-month, .member-card, .partner-card, .organization-row, .contact-card, .contact-form",
        ),
      ]),
    );
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((target) => target.classList.add("scroll-item-visible"));
      return;
    }
    targets.forEach((target, index) => {
      target.classList.add("scroll-reveal-item");
      target.style.setProperty("--scroll-order", String(index % 4));
    });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("scroll-item-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -8%" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
  return (
    <div className="scroll-reveal" ref={ref}>
      {children}
    </div>
  );
}
