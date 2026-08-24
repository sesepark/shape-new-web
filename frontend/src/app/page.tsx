import { Fragment } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { HomeRobotStage } from "@/components/home-robot-stage";
import { HomeScrollSnap } from "@/components/home-scroll-snap";
import { ShapeWordmark } from "@/components/shape-wordmark";
import { api, itemOrNull, listOrEmpty } from "@/lib/api";
import { lines, mergeHome } from "@/lib/home-content";
import { upcoming } from "@/lib/schedule";

export const metadata = {
  title: "SNU Physical AI Club",
  description:
    "서울대학교 Physical AI 동아리 SHAPE입니다. 교육·연구·검증 세 단계로 학부생이 실물 로봇을 다루는 인재로 성장합니다.",
};

/**
 * 줄바꿈이 들어간 글귀를 그대로 화면의 줄바꿈으로 옮깁니다. 관리자 화면에서
 * Enter 로 나눈 줄이 여기서 <br> 이 됩니다.
 */
function Multiline({ text }: { text: string }) {
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

export default async function HomePage() {
  // 로드맵은 /roadmap 과 같은 응답을 씁니다. Next.js Data Cache 가 5분 동안
  // 들고 있으므로 이 섹션 때문에 백엔드 호출이 늘지 않습니다. 목록을 못 받아
  // 오면 이 섹션만 조용히 빠집니다.
  const [page, roadmap] = await Promise.all([itemOrNull(api.page("home")), listOrEmpty(api.roadmap())]);
  const schedule = upcoming(roadmap, 3);
  // 저장된 값이 없거나 일부만 있어도 기본값으로 채워 그립니다. 홈은 서버에서
  // 그려지므로 여기서 비면 화면 전체가 빕니다.
  const home = mergeHome(page?.contentJson);

  return (
    <main className="shape-home">
      <HomeScrollSnap />
      <section className="home-hero" id="hero">
        <div className="home-intro">
          <ShapeWordmark text={home.hero.wordmark} />
          <h1>{home.hero.titleTop}<br /><em>{home.hero.titleAccent}</em></h1>
          <span><Multiline text={home.hero.tagline} /></span>
          <Link href={home.hero.ctaHref}>{home.hero.ctaLabel} <ArrowUpRight size={17} /></Link>
        </div>
        <HomeRobotStage />
        <a className="home-scroll" href="#shape-intro">{home.hero.scrollLabel} <ArrowDownRight size={18} /></a>
      </section>

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
    </main>
  );
}
