import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { HomeRobotStage } from "@/components/home-robot-stage";
import { HomeScrollSnap } from "@/components/home-scroll-snap";
import { ShapeWordmark } from "@/components/shape-wordmark";
import { api, listOrEmpty } from "@/lib/api";
import { upcoming } from "@/lib/schedule";

export const metadata = {
  title: "SNU Physical AI Club",
  description:
    "서울대학교 Physical AI 동아리 SHAPE입니다. 교육·연구·검증 세 단계로 학부생이 실물 로봇을 다루는 인재로 성장합니다.",
};

/**
 * 인재 양성의 세 단계. 2기 운영 계획서 1-2 절의 정의를 그대로 옮겼습니다.
 * 예전에 있던 LEARN·BUILD·SHARE 는 어느 동아리에나 붙는 말이었습니다.
 */
const STAGES = [
  {
    number: "01",
    label: "EDUCATION",
    title: "교육",
    body: "초심자가 로봇 학습의 전 과정을 다룰 수 있는 기초 역량을 확보합니다. 준회원은 한 학기 교육 트랙을 이수하면 정회원이 됩니다.",
    href: "/roadmap/education",
  },
  {
    number: "02",
    label: "RESEARCH",
    title: "연구",
    body: "직접 정한 문제를 실물 로봇과 자체 취득 데이터로 해결하는 경험을 쌓습니다. 정회원 전원이 SHAPE-UP 팀 프로젝트에 참여합니다.",
    href: "/roadmap/shape-up",
  },
  {
    number: "03",
    label: "VERIFICATION",
    title: "검증",
    body: "대회 출전과 결과물 공개를 통해 외부 기준에서 역량을 확인합니다. 마트 챌린지와 RoboCup@Home을 하나의 프로젝트로 준비합니다.",
    href: "/roadmap/competition",
  },
];

/** 2기 운영 계획서와 모집 안내에서 확인된 숫자입니다. */
const FACTS = [
  { value: "2026", unit: "년 4월", label: "창립", note: "서울대학교 기계공학부 소속" },
  { value: "70", unit: "명", label: "2기 부원", note: "정회원 30 · 준회원 40" },
  { value: "3", unit: "트랙", label: "정기 활동", note: "SHAPE-UP · 대회 · 교육" },
  { value: "5", unit: "종", label: "운용 플랫폼", note: "휴머노이드부터 매니퓰레이터까지" },
];

/** 정기 활동 요일. 활동 캘린더의 값입니다. */
const WEEK = [
  { day: "화", track: "SHAPE-UP", who: "정회원", when: "격주 19:00~22:00" },
  { day: "수", track: "대회", who: "대회팀", when: "매주 19:00~" },
  { day: "목", track: "교육", who: "준회원", when: "매주 19:00~22:00" },
];

/** 지난 학기에 실제로 운용한 플랫폼. 2기 모집 안내의 목록입니다. */
const PLATFORMS = ["Unitree G1", "AI Worker", "AI Sapiens", "OMY", "SO-ARM 101"];

const 다가오는일정 = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" });

export default async function HomePage() {
  // 로드맵은 /roadmap 과 같은 응답을 씁니다. Next.js Data Cache 가 5분 동안
  // 들고 있으므로 이 섹션 때문에 백엔드 호출이 늘지 않습니다. 목록을 못 받아
  // 오면 이 섹션만 조용히 빠집니다.
  const schedule = upcoming(await listOrEmpty(api.roadmap()), 3);

  return (
    <main className="shape-home">
      <HomeScrollSnap />
      <section className="home-hero" id="hero">
        <div className="home-intro"><ShapeWordmark text="SNU Humanoid And Physical Embodied AI" /><h1>SHAPE<br /><em>the real world.</em></h1><span>AI가 현실을 이해하고 움직이는 순간을<br />함께 연구하고 만들어 갑니다.</span><Link href="/about">SHAPE 알아보기 <ArrowUpRight size={17} /></Link></div>
        <HomeRobotStage />
        <a className="home-scroll" href="#shape-intro">SCROLL TO EXPLORE <ArrowDownRight size={18} /></a>
      </section>

      <section id="shape-intro" className="home-introduction">
        <div><p>WHAT WE SHAPE</p><h2>우리는 화면 밖의<br />AI를 만듭니다.</h2></div>
        <div className="home-intro-body">
          <p>SHAPE는 Physical AI 인재 양성을 목적으로 하는 서울대학교 동아리입니다. 오랫동안 대학원과 기업의 영역이었던 휴머노이드 연구를 학부 단계에서 진행하기 위해 2026년 4월 기계공학부에서 시작했습니다. 지금 아는 것이 적어도 상관없습니다.</p>
          <Link href="/about">동아리 소개 보기 <ArrowUpRight size={17} /></Link>
        </div>
      </section>

      <section className="home-pillars" id="shape-pillars" aria-label="인재 양성의 세 단계">
        {STAGES.map((stage) => (
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
          <p>BY THE NUMBERS</p>
          <h2 id="home-numbers-title">한 학기를 이렇게<br />굴리고 있습니다.</h2>
        </div>
        <dl className="home-fact-grid">
          {FACTS.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd><strong>{fact.value}</strong><i>{fact.unit}</i></dd>
              <p>{fact.note}</p>
            </div>
          ))}
        </dl>
        <ul className="home-week" aria-label="정기 활동 요일">
          {WEEK.map((slot) => (
            <li key={slot.day}>
              <b>{slot.day}</b>
              <span><strong>{slot.track}</strong><small>{slot.who} · {slot.when}</small></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-next" id="shape-next" aria-labelledby="home-next-title">
        <div className="home-section-head">
          <p>WHAT&rsquo;S NEXT</p>
          <h2 id="home-next-title">지금 만들고 있는 것.</h2>
        </div>
        <div className="home-next-body">
          <div className="home-platforms">
            <h3>지난 학기 운용한 플랫폼</h3>
            <ul>{PLATFORMS.map((name) => <li key={name}>{name}</li>)}</ul>
            <p>휴머노이드부터 매니퓰레이터까지 실물 위에서 직접 다뤘습니다.</p>
            <Link href="/equipment">보유 장비 보기 <ArrowUpRight size={15} /></Link>
          </div>
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
                <Link href="/roadmap">전체 로드맵 보기 <ArrowUpRight size={15} /></Link>
              </li>
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}
