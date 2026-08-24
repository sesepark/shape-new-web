"use client";

import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "hero", label: "인트로" },
  { id: "shape-intro", label: "소개" },
  { id: "shape-pillars", label: "단계" },
  { id: "shape-numbers", label: "현황" },
  { id: "shape-next", label: "일정" },
];
// Children that should fly in when their section arrives. The robot stage is
// deliberately excluded so the 3D canvas is never transformed mid-render.
const REVEAL = [
  ".home-intro > *",
  ".home-introduction > div > *",
  ".home-pillars article",
  ".home-section-head > *",
  ".home-fact-grid > div",
  ".home-week li",
  ".home-platforms",
  ".home-timeline li",
].join(", ");

export function HomeScrollSnap() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const sections = SECTIONS.map(({ id }) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    sections.forEach((section) => {
      section.querySelectorAll<HTMLElement>(REVEAL).forEach((item, index) => {
        item.classList.add("home-reveal");
        item.style.setProperty("--reveal-index", String(index));
      });
    });

    if (reduced) {
      sections.forEach((section) => section.classList.add("in-view"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("in-view", entry.isIntersecting);
          if (entry.isIntersecting) {
            const index = sections.indexOf(entry.target as HTMLElement);
            if (index >= 0) setCurrent(index);
          }
        });
      },
      { threshold: 0.4 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="home-progress" aria-label="홈 섹션 이동">
      {SECTIONS.map((section, index) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={index === current ? "active" : ""}
          aria-current={index === current ? "true" : undefined}
        >
          <span>{section.label}</span>
          <i aria-hidden="true" />
        </a>
      ))}
    </nav>
  );
}
