"use client";

import { Github, Instagram } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ShapeSymbol } from "@/components/shape-symbol";

export function SiteFooter() {
  const footerRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.08, rootMargin: "0px 0px -4%" },
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <footer ref={footerRef} className={`site-footer footer-reveal${isVisible ? " is-visible" : ""}`}>
      <div className="footer-compact">
        <div className="footer-identity">
          <div className="footer-brand" aria-label="SHAPE">
            <ShapeSymbol className="footer-symbol" />
          </div>
          <div>
            <strong>SHAPE</strong>
            <p>서울대학교 휴머노이드 & Physical AI 동아리</p>
          </div>
        </div>
        <div className="footer-contact">
          <a href="mailto:contact@example.com">contact@example.com</a>
          <span>서울대학교 301동 109호</span>
          <div className="footer-socials" aria-label="SHAPE 소셜 미디어">
            <a href="https://github.com/snu-shape" target="_blank" rel="noreferrer" aria-label="SHAPE GitHub"><Github size={17} /></a>
            <a href="https://www.instagram.com/snu_shape?igsh=NTJiMjJ3cjQ2Nzkx" target="_blank" rel="noreferrer" aria-label="SHAPE Instagram"><Instagram size={17} /></a>
          </div>
        </div>
      </div>
      {/* URDF에서 뽑은 선화를 CSS 마스크로 씁니다. 색을 테마 변수로 칠할 수
          있어서 어두운 푸터와 홈의 밝은 푸터 모두에서 또렷하게 보입니다. */}
      <div className="footer-ai-worker" aria-hidden="true" />
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} SHAPE</span>
        <span>Fostering Talent, Shaping Physical AI</span>
      </div>
    </footer>
  );
}
