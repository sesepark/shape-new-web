"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ScrollReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const targets = Array.from(
      new Set([
        ...element.querySelectorAll<HTMLElement>(":scope > *"),
        ...element.querySelectorAll<HTMLElement>(
          ".equipment-catalog-card, .calendar-month, .member-card, .organization-row, .contact-card, .contact-form",
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
