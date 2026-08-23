"use client";

import { ArrowLeft, ArrowRight, Cpu, GraduationCap, Trophy } from "lucide-react";
import { useRef } from "react";

const programs = [
  { icon: GraduationCap, tag: "EDUCATION", title: "Physical AI 교육", description: "로봇 기초부터 제어, 학습, 실물 적용까지 단계적으로 익힙니다." },
  { icon: Cpu, tag: "RESEARCH", title: "자율 연구 프로젝트", description: "팀이 직접 문제를 정의하고 데이터와 실물 로봇으로 해결합니다." },
  { icon: Trophy, tag: "CHALLENGE", title: "대회·데모 검증", description: "외부 대회와 공개 데모를 통해 결과를 객관적으로 검증합니다." },
] as const;

export function ProgramCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const move = (direction: number) => track.current?.scrollBy({ left: direction * 420, behavior: "smooth" });
  return <div className="program-carousel">
    <div className="program-track" ref={track}>{programs.map(({ icon: Icon, tag, title, description }, index) => <article className="program-card" key={tag}>
      <span className="program-number">0{index + 1}</span><Icon size={30} /><small>{tag}</small><h3>{title}</h3><p>{description}</p>
    </article>)}</div>
    <div className="carousel-actions"><button onClick={() => move(-1)} aria-label="이전 프로그램"><ArrowLeft /></button><button onClick={() => move(1)} aria-label="다음 프로그램"><ArrowRight /></button></div>
  </div>;
}
