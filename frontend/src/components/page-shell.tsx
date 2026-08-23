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
  children,
}: {
  eyebrow: string;
  title: string;
  contentTitle?: string;
  activeNav?: string;
  children: ReactNode;
}) {
  return (
    <main>
      <section className="page-hero">
        <HeroTitle eyebrow="SNU Humanoid And Physical Embodied AI" title={title} />
        <SiteSubnav activeHref={activeNav} />
        <ScrollOrbit href="#content" />
      </section>
      <section className="page-content" id="content">
        <ScrollReveal>
          <h2 className="content-title">{contentTitle}</h2>
          {children}
        </ScrollReveal>
      </section>
    </main>
  );
}
