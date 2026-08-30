import type { ReactNode } from "react";
import { HeroTitle } from "@/components/hero-title";
import { ScrollOrbit } from "@/components/scroll-orbit";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteSubnav } from "@/components/site-subnav";

export function PageShell({
  eyebrow,
  title,
  contentTitle = title,
  activeNav,
  compact = false,
  children,
}: {
  eyebrow: string;
  title: string;
  contentTitle?: string;
  activeNav?: string;
  /**
   * 매일 여는 도구용으로 머리 부분을 줄입니다.
   *
   * 히어로는 처음 온 방문자에게 브랜드를 보여 주는 장치인데, `/admin` 은
   * 방문자가 오는 곳이 아닙니다. 그런데도 같은 히어로를 써서 본문이
   * **데스크톱 1440×900 에서 643px, 모바일 390×844 에서 726px** 아래에서
   * 시작했습니다. 모바일에서는 관리 화면이 첫 화면 밖에 있었다는 뜻입니다.
   */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={compact ? "shell-compact" : undefined}>
      <section className="page-hero">
        <HeroTitle eyebrow="SNU Humanoid And Physical Embodied AI" title={title} />
        <SiteSubnav activeHref={activeNav} />
        <ScrollOrbit href="#content" />
      </section>
      <section className="page-content" id="content">
        <ScrollReveal>
          {/* 이 쪽의 진짜 이름입니다. 히어로의 묶음 이름이 아니라 이것이 h1 입니다.
              까닭은 `hero-title.tsx` 에 적어 두었습니다. */}
          <h1 className="content-title">{contentTitle}</h1>
          {children}
        </ScrollReveal>
      </section>
    </main>
  );
}
