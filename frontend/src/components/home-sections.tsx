"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { HomeRobotStage } from "@/components/home-robot-stage";
import { ShapeWordmark } from "@/components/shape-wordmark";
import { lines, type HomeContent } from "@/lib/home-content";
import type { RoadmapItem } from "@/lib/types";

/**
 * 홈의 각 장.
 *
 * 공개 홈과 관리자 미리보기가 **같은 조각**을 씁니다. 예전에는 홈의 화면 구성이
 * page.tsx 안에만 있어서, 관리자 화면에서 글을 고쳐도 어떻게 보일지는 저장하고
 * 공개 화면을 열어 봐야 알 수 있었습니다.
 *
 * 여기 있는 것은 화면 구성뿐이고, 글과 목록은 모두 `HomeContent` 로 받습니다.
 */

/** 줄바꿈이 들어간 글귀를 그대로 화면의 줄바꿈으로 옮깁니다. */
export function Multiline({ text }: { text: string }) {
  return (
    <>
      {lines(text).map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

const 다가오는일정 = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" });

/** 첫 화면. `stage` 를 끄면 3D 로봇 무대 없이 글만 그립니다(관리자 미리보기). */
export function HomeHero({ home, stage = true }: { home: HomeContent; stage?: boolean }) {
  return (
        <section className="home-hero" id="hero">
          <div className="home-intro">
            <ShapeWordmark text={home.hero.wordmark} />
            <h1>{home.hero.titleTop}<br /><em>{home.hero.titleAccent}</em></h1>
            <span><Multiline text={home.hero.tagline} /></span>
            <Link href={home.hero.ctaHref}>{home.hero.ctaLabel} <ArrowUpRight size={17} /></Link>
          </div>
          {stage && <HomeRobotStage />}
          <a className="home-scroll" href="#shape-intro">{home.hero.scrollLabel} <ArrowDownRight size={18} /></a>
        </section>
  );
}

export function HomeIntro({ home }: { home: HomeContent }) {
  return (
        <section id="shape-intro" className="home-introduction">
          <div>
            <p>{home.intro.eyebrow}</p>
            <h2><Multiline text={home.intro.heading} /></h2>
            <blockquote className="home-slogan"><Multiline text={home.intro.slogan} /></blockquote>
          </div>
          <div className="home-intro-body">
            <p>{home.intro.body}</p>
            <ul className="home-fields" aria-label="SHAPE가 다루는 분야">
              {home.intro.fields.map((field, index) => (
                <li key={field.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{field.title}</strong>
                  <small>{field.topics}</small>
                </li>
              ))}
            </ul>
            <Link href={home.intro.ctaHref}>{home.intro.ctaLabel} <ArrowUpRight size={17} /></Link>
          </div>
        </section>
  );
}

export function HomePillars({ home }: { home: HomeContent }) {
  return (
        <section className="home-pillars" id="shape-pillars" aria-label="인재 양성의 세 단계">
          {home.stages.map((stage) => (
            <article key={stage.number}>
              <span>{stage.number}</span>
              <small>{stage.label}</small>
              <h3>{stage.title}</h3>
              <p>{stage.body}</p>
              <Link className="home-pillar-link" href={stage.href}>일정 보기 <ArrowUpRight size={15} /></Link>
            </article>
          ))}
        </section>
  );
}

export function HomeNumbers({ home }: { home: HomeContent }) {
  return (
        <section className="home-numbers" id="shape-numbers" aria-labelledby="home-numbers-title">
          <div className="home-section-head">
            <p>{home.numbers.eyebrow}</p>
            <h2 id="home-numbers-title"><Multiline text={home.numbers.heading} /></h2>
          </div>
          <dl className="home-fact-grid">
            {home.numbers.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd><strong>{fact.value}</strong><i>{fact.unit}</i></dd>
                <p>{fact.note}</p>
              </div>
            ))}
          </dl>
          <ul className="home-week" aria-label="정기 활동 요일">
            {home.numbers.week.map((slot) => (
              <li key={slot.day}>
                <b>{slot.day}</b>
                <span><strong>{slot.track}</strong><small>{slot.who} · {slot.when}</small></span>
              </li>
            ))}
          </ul>
          <p className="home-footnote">{home.numbers.footnote}</p>
        </section>
  );
}

export function HomeNext({ home, schedule }: { home: HomeContent; schedule: RoadmapItem[] }) {
  return (
        <section className="home-next" id="shape-next" aria-labelledby="home-next-title">
          <div className="home-section-head">
            <p>{home.next.eyebrow}</p>
            <h2 id="home-next-title"><Multiline text={home.next.heading} /></h2>
          </div>
          <div className="home-next-body">
            <div className="home-platforms">
              <h3>{home.next.platformsHeading}</h3>
              <ul>{home.next.platforms.map((name) => <li key={name}>{name}</li>)}</ul>
              <p>{home.next.platformsNote}</p>
              <Link href={home.next.platformsCtaHref}>{home.next.platformsCtaLabel} <ArrowUpRight size={15} /></Link>
            </div>
            <ul className="home-contests" aria-label="준비 중인 대회">
              {home.next.contests.map((contest) => (
                <li key={contest.name}>
                  <strong>{contest.name}</strong>
                  <small>{contest.when} · {contest.where}</small>
                </li>
              ))}
            </ul>
            {schedule.length > 0 && (
              <ol className="home-timeline">
                {schedule.map((item) => (
                  <li key={item.id}>
                    <time dateTime={item.startsAt}>{다가오는일정.format(new Date(item.startsAt))}</time>
                    <strong>{item.title}</strong>
                    <small>{item.category}</small>
                  </li>
                ))}
                <li className="home-timeline-more">
                  <Link href="/roadmap">{home.next.timelineCtaLabel} <ArrowUpRight size={15} /></Link>
                </li>
              </ol>
            )}
          </div>
        </section>
  );
}
