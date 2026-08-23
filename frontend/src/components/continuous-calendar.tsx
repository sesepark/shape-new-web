"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildLanes, laneGroups, semesterWindow } from "@/lib/roadmap-lanes";
import type { RoadmapItem } from "@/lib/types";

const categoryClass = (category: string) =>
  category === "대회" ? "competition" : category === "교육" ? "education" : category === "point" ? "point" : "shape-up";
const monthLabel = new Intl.DateTimeFormat("ko-KR", { month: "long" });
const dayLabel = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" });
const fullDate = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * 막대 안에 들어갈 제목 줄 수. 데스크톱 트랙 높이(1180px)를 기준으로 재서,
 * 짧은 막대에서 글이 막대 밖으로 넘치지 않게 합니다.
 */
const TRACK_HEIGHT = 1180;
const LINE_HEIGHT = 17;
/** 제목을 여러 줄로 쌓으려면 이만큼은 되어야 날짜 줄까지 들어갑니다. */
const STACK_MINIMUM = 54;
function barPixels(heightPercent: number) {
  return (heightPercent / 100) * TRACK_HEIGHT;
}
function labelLines(heightPercent: number) {
  return Math.max(1, Math.min(8, Math.floor((barPixels(heightPercent) - 36) / LINE_HEIGHT)));
}

function period(item: RoadmapItem) {
  const starts = dayLabel.format(new Date(item.startsAt));
  if (!item.endsAt) return starts;
  const ends = dayLabel.format(new Date(item.endsAt));
  return starts === ends ? starts : `${starts} — ${ends}`;
}

export function ContinuousCalendar({ items, category }: { items: RoadmapItem[]; category?: string }) {
  const [active, setActive] = useState<RoadmapItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const semesterOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const latestYear = Math.max(currentYear + 2, ...items.map((item) => new Date(item.startsAt).getFullYear() + 1));
    return Array.from({ length: latestYear - 2026 + 1 }, (_, index) => 2026 + index)
      .flatMap((year) => [1, 2].map((semester) => ({ year, semester: semester as 1 | 2 })));
  }, [items]);
  const [semesterIndex, setSemesterIndex] = useState(() => {
    const now = new Date();
    const index = semesterOptions.findIndex((option) => option.year === now.getFullYear() && option.semester === (now.getMonth() < 6 ? 1 : 2));
    return index >= 0 ? index : 0;
  });
  const semester = semesterOptions[semesterIndex] ?? { year: 2026, semester: 2 as const };
  const { start, end, months } = useMemo(() => semesterWindow(semester.year, semester.semester), [semester.year, semester.semester]);
  const lanes = useMemo(() => buildLanes(items, start, end), [items, start, end]);
  const groups = useMemo(() => laneGroups(lanes), [lanes]);

  // 오늘 위치는 서버에서 계산하면 하이드레이션이 어긋나므로 화면에서만 잰다.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const mark = () => setNow(Date.now());
    mark();
    const timer = window.setInterval(mark, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const todayPercent = now !== null && now >= start.getTime() && now < end.getTime()
    ? ((now - start.getTime()) / (end.getTime() - start.getTime())) * 100
    : null;

  useEffect(() => {
    if (active && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [active]);

  function close() {
    dialog.current?.close();
    setActive(null);
  }

  return (
    <>
      <div className="roadmap-timeline">
        <header className="calendar-year">
          <span>ANNUAL ROADMAP</span>
          <strong>{String(semester.year).slice(2)}-{semester.semester}</strong>
          <p>{monthLabel.format(months[0])} — {months[5].getFullYear()}년 {monthLabel.format(months[5])}</p>
        </header>
        {lanes.length === 0 ? (
          <p className="calendar-empty-semester">이 학기에는 등록된 일정이 없습니다.</p>
        ) : (
          <div className="roadmap-track" style={{ "--lanes": lanes.length } as React.CSSProperties}>
            <div className="roadmap-track-head">
              <span aria-hidden="true" />
              {groups.map((group) => (
                <span
                  className={`lane-name ${categoryClass(group.category)}`}
                  style={{ gridColumn: `span ${group.span}` }}
                  key={group.category}
                >
                  {group.label}
                </span>
              ))}
            </div>
            <div className="roadmap-track-body">
              <div className="roadmap-months" aria-hidden="true">
                {months.map((month) => (
                  <div key={`${month.getFullYear()}-${month.getMonth()}`}>
                    <small>{String(month.getMonth() + 1).padStart(2, "0")}</small>
                    <strong>{monthLabel.format(month)}</strong>
                  </div>
                ))}
              </div>
              <div className="roadmap-lanes">
                {lanes.map((lane) => (
                  <div className="roadmap-lane" key={lane.key}>
                    {lane.placements.map(({ item, top, height, clippedTop, clippedBottom, point }) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`roadmap-bar ${categoryClass(lane.category === "point" ? item.category : lane.category)}${point ? " is-point" : ""}${point || barPixels(height) < STACK_MINIMUM ? " is-compact" : ""}`}
                        style={{ top: `${top}%`, height: `${height}%`, "--lines": labelLines(height) } as React.CSSProperties}
                        onClick={() => setActive(item)}
                        aria-label={`${item.title}, ${period(item)}, ${item.category}`}
                      >
                        {clippedTop && <ChevronUp className="bar-clip" size={13} aria-hidden="true" />}
                        <span className="bar-label">
                          <b title={item.title}>{item.title}</b>
                          <i>{period(item)}</i>
                        </span>
                        {clippedBottom && <ChevronDown className="bar-clip" size={13} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                ))}
                {todayPercent !== null && (
                  <div className="roadmap-today" style={{ top: `${todayPercent}%` }} aria-hidden="true">
                    <span>오늘</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="semester-pagination calendar-semester-bottom" aria-label="학기별 로드맵 이동">
          <button type="button" onClick={() => setSemesterIndex((index) => index - 1)} disabled={semesterIndex === 0} aria-label="이전 학기"><ChevronLeft size={18} /></button>
          <select value={semesterIndex} onChange={(event) => setSemesterIndex(Number(event.target.value))} aria-label="학기 선택">
            {semesterOptions.map((option, index) => (
              <option key={`${option.year}-${option.semester}`} value={index}>{String(option.year).slice(2)}-{option.semester}학기</option>
            ))}
          </select>
          <button type="button" onClick={() => setSemesterIndex((index) => index + 1)} disabled={semesterIndex === semesterOptions.length - 1} aria-label="다음 학기"><ChevronRight size={18} /></button>
        </div>
      </div>

      <dialog ref={dialog} className="roadmap-dialog" onClose={() => setActive(null)} onClick={(event) => { if (event.target === dialog.current) close(); }}>
        {active && (
          <article>
            <button className="dialog-close" type="button" onClick={close} aria-label="일정 상세 닫기"><X /></button>
            <p className={`roadmap-dialog-category ${categoryClass(active.category)}`}>{active.category}</p>
            <h3>{active.title}</h3>
            <dl>
              <div><dt><CalendarDays size={17} /> 시작</dt><dd>{fullDate.format(new Date(active.startsAt))}</dd></div>
              {active.endsAt && <div><dt><Clock3 size={17} /> 종료</dt><dd>{fullDate.format(new Date(active.endsAt))}</dd></div>}
            </dl>
            <p>{active.description || "등록된 설명이 없습니다."}</p>
          </article>
        )}
      </dialog>
      {category && <span className="sr-only">{category} 일정만 표시하고 있습니다.</span>}
    </>
  );
}
