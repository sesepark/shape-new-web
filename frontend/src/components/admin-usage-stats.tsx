"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/admin-api";
import { localDay } from "@/lib/booking";
import { useNotice } from "@/components/use-notice";
import type { UsageCount, UsageStats } from "@/lib/types";

/**
 * 목적별 색. **차례가 고정**이라 항목이 빠져도 남은 것의 색이 바뀌지 않습니다.
 *
 * 네 색은 색각 이상에서도 서로 구별되는지 확인해 고른 값입니다(인접 쌍 최소
 * ΔE 10.3 protan / 22.3 tritan, 흰 바탕 대비 3:1 이상). 그래도 색만으로 읽게
 * 두지 않고 어느 화면에서든 이름과 숫자를 함께 적습니다.
 */
const PURPOSE_COLOR: Record<string, string> = {
  CONTEST: "#2855f3",
  SHAPE_UP: "#e0561f",
  EDUCATION: "#00916e",
  OTHER: "#a032c0",
};
/** 시급도는 순서가 있는 값이라 색도 무게 순입니다. 화면의 배지와 같은 색입니다. */
const URGENCY_COLOR: Record<string, string> = { HIGH: "#b62446", NORMAL: "#243e78", LOW: "#6b7383" };
/** '얼마나 많은가' 를 나타내는 자리는 한 가지 색의 농담으로. 무지개를 쓰지 않습니다. */
const RAMP = ["#eef2fb", "#cdd9fb", "#9db3f7", "#6b87f2", "#2855f3"];

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function shiftDays(from: string, days: number): string {
  const moment = new Date(`${from}T12:00:00`);
  moment.setDate(moment.getDate() + days);
  return localDay(moment);
}

/** 이번 학기의 처음과 끝. 3~8월이 1학기, 9~2월이 2학기입니다. */
function currentTerm(): [string, string] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 3 && month <= 8) return [`${year}-03-01`, `${year}-08-31`];
  return month >= 9 ? [`${year}-09-01`, `${year + 1}-02-28`] : [`${year - 1}-09-01`, `${year}-02-28`];
}

function Bars({ rows, colorOf, unit }: { rows: UsageCount[]; colorOf: (row: UsageCount) => string; unit: "시간" | "건" }) {
  const top = Math.max(1, ...rows.map((row) => (unit === "시간" ? row.hours : row.count)));
  if (rows.length === 0) return <p className="form-note">이 기간에는 기록이 없습니다.</p>;
  return (
    <ul className="usage-bars">
      {rows.map((row) => {
        const value = unit === "시간" ? row.hours : row.count;
        return (
          <li key={row.key}>
            <span className="usage-name">{row.label}</span>
            <span className="usage-track">
              <i style={{ width: `${Math.max(2, (value / top) * 100)}%`, background: colorOf(row) }} />
            </span>
            <b className="usage-value">
              {value}{unit}
              {row.utilisation !== null && row.utilisation !== undefined && <i> · 가동률 {row.utilisation}%</i>}
            </b>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 장비가 실제로 언제·얼마나 쓰였는지.
 *
 * 차트 라이브러리를 쓰지 않습니다. 막대는 폭 비율이고 히트맵은 표 한 장이면
 * 되는데, 라이브러리를 넣으면 이 화면 하나 때문에 모든 방문자의 내려받기가
 * 늘어납니다. 히트맵을 진짜 `<table>` 로 그리는 것도 같은 이유입니다 — 색과
 * 숫자가 한 자리에 있어 읽는 방법이 하나로 끝납니다.
 */
export function AdminUsageStats() {
  const { say, node: notice } = useNotice();
  const [term, setTerm] = useState<[string, string]>(() => [shiftDays(localDay(), -29), localDay()]);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, untilDate] = term;

  const reload = useCallback(async () => {
    setLoading(true);
    const response = await adminFetch(`/admin/reservations/stats?from=${fromDate}&to=${untilDate}`);
    setLoading(false);
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "통계를 보려면 예약 관리 권한이 필요합니다.", false);
      setStats(null);
      return;
    }
    say("");
    setStats((await response.json()) as UsageStats);
  }, [fromDate, untilDate, say]);

  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);

  const busiest = useMemo(() => Math.max(1, ...(stats?.heatmap.flat() ?? [0])), [stats]);
  const shadeOf = useCallback((value: number) => {
    if (value <= 0) return RAMP[0];
    return RAMP[Math.min(RAMP.length - 1, Math.ceil((value / busiest) * (RAMP.length - 1)))];
  }, [busiest]);

  const ranges: [string, () => [string, string]][] = [
    ["최근 30일", () => [shiftDays(localDay(), -29), localDay()]],
    ["최근 90일", () => [shiftDays(localDay(), -89), localDay()]],
    ["이번 학기", currentTerm],
  ];
  const autoShare = () => {
    const auto = stats?.decisions.find((row) => row.key === "auto")?.count ?? 0;
    const staff = stats?.decisions.find((row) => row.key === "staff")?.count ?? 0;
    return auto + staff === 0 ? "—" : `${Math.round((auto / (auto + staff)) * 100)}%`;
  };

  return (
    <div className="admin-form usage-stats">
      <p className="form-note">
        확정·사용 중·사용 완료 예약만 셉니다. 가동률은 <b>하루 24시간을 기준</b>으로 한 값이라
        새벽이 포함되어 낮게 나옵니다. 장비끼리 견주는 데 쓰세요.
      </p>
      <div className="board-filter" aria-label="기간">
        {ranges.map(([label, make]) => {
          const [start, end] = make();
          return (
            <button
              type="button"
              key={label}
              className={start === fromDate && end === untilDate ? "active" : ""}
              onClick={() => setTerm(make())}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="usage-range">
        <label>
          시작
          <input type="date" value={fromDate} onChange={(event) => setTerm([event.target.value, untilDate])} />
        </label>
        <label>
          끝
          <input type="date" value={untilDate} min={fromDate} onChange={(event) => setTerm([fromDate, event.target.value])} />
        </label>
      </div>
      {notice}

      {loading ? (
        <p className="form-note">통계를 불러오는 중입니다.</p>
      ) : !stats ? null : (
        <>
          <div className="usage-tiles">
            <div><span>예약 건수</span><strong>{stats.totalCount}</strong><i>{stats.days}일 동안</i></div>
            <div><span>총 사용 시간</span><strong>{stats.totalHours}</strong><i>시간</i></div>
            <div><span>자동 확정 비율</span><strong>{autoShare()}</strong><i>사람이 누르지 않고 확정된 몫</i></div>
          </div>

          <section className="usage-block">
            <h3>장비별 사용</h3>
            <Bars rows={stats.equipment} colorOf={() => RAMP[4]} unit="시간" />
          </section>

          <section className="usage-block">
            <h3>사용 목적</h3>
            <Bars rows={stats.purposes} colorOf={(row) => PURPOSE_COLOR[row.key] ?? RAMP[4]} unit="건" />
          </section>

          <section className="usage-block">
            <h3>사용 시급도</h3>
            <Bars rows={stats.urgencies} colorOf={(row) => URGENCY_COLOR[row.key] ?? RAMP[4]} unit="건" />
          </section>

          <section className="usage-block">
            <h3>처리 방식</h3>
            <Bars rows={stats.decisions} colorOf={() => RAMP[3]} unit="건" />
          </section>

          <section className="usage-block">
            <h3>붐비는 시간</h3>
            <p className="form-note">그 시간대에 걸쳐 있던 예약 수입니다. 색이 진할수록 많고, 숫자를 함께 적어 색만으로 읽지 않아도 됩니다.</p>
            <div className="usage-heatmap-wrap">
              <table className="usage-heatmap">
                <caption>요일과 시간대별 예약 수</caption>
                <thead>
                  <tr>
                    <th scope="col">요일</th>
                    {HOURS.map((hour) => <th scope="col" key={hour}>{hour}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {stats.heatmap.map((row, weekday) => (
                    <tr key={WEEKDAYS[weekday]}>
                      <th scope="row">{WEEKDAYS[weekday]}</th>
                      {row.map((value, hour) => (
                        <td
                          key={hour}
                          style={{ background: shadeOf(value) }}
                          className={value > 0 && value / busiest > 0.6 ? "strong" : ""}
                          title={`${WEEKDAYS[weekday]}요일 ${hour}시 · ${value}건`}
                        >
                          {value || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="usage-block">
            <h3>많이 쓴 부원</h3>
            <Bars rows={stats.people} colorOf={() => RAMP[2]} unit="시간" />
          </section>
        </>
      )}
    </div>
  );
}
