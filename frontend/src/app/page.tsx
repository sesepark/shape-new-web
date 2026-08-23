import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { HomeRobotStage } from "@/components/home-robot-stage";
import { HomeScrollSnap } from "@/components/home-scroll-snap";

export const metadata = { title: "SNU Physical AI Club", description: "서울대학교에서 Physical AI를 탐구하고 만드는 학생 커뮤니티, SHAPE입니다." };

export default function HomePage() {
  return (
    <main className="shape-home">
      <HomeScrollSnap />
      <section className="home-hero" id="hero">
        <div className="home-intro"><p>SNU Humanoid And Physical Embodied AI</p><h1>SHAPE<br /><em>the real world.</em></h1><span>AI가 현실을 이해하고 움직이는 순간을<br />함께 연구하고 만들어 갑니다.</span><Link href="/about">SHAPE 알아보기 <ArrowUpRight size={17} /></Link></div>
        <HomeRobotStage />
        <a className="home-scroll" href="#shape-intro">SCROLL TO EXPLORE <ArrowDownRight size={18} /></a>
      </section>
      <section id="shape-intro" className="home-introduction">
        <div><p>WHAT WE SHAPE</p><h2>우리는 화면 밖의<br />AI를 만듭니다.</h2></div>
        <div className="home-intro-body"><p>SHAPE는 서울대학교에서 휴머노이드와 Physical AI를 연구하고 제작하는 학생 커뮤니티입니다. 서로 다른 전공의 구성원이 하나의 시스템을 완성하며, 이론을 실제 움직임으로 연결합니다.</p><Link href="/about">동아리 소개 보기 <ArrowUpRight size={17} /></Link></div>
      </section>
      <section className="home-pillars" id="shape-pillars" aria-label="SHAPE 활동 영역">
        {[['01','LEARN','기초부터 함께','로봇과 학습의 기본기를 스터디와 실습으로 함께 쌓습니다.'],['02','BUILD','직접 구현하며','팀을 이뤄 실제 로봇 위에서 아이디어를 움직이는 결과물로 만듭니다.'],['03','SHARE','성과를 나누며','데모와 기록으로 배운 것을 안팎에 나눕니다.']].map(([number, label, title, body]) => <article key={number}><span>{number}</span><small>{label}</small><h3>{title}</h3><p>{body}</p></article>)}
      </section>
    </main>
  );
}
