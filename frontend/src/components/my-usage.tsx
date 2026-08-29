"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Camera, Clock3 } from "lucide-react";
import { API_URL } from "@/lib/api";
import { momentLabel } from "@/lib/booking";
import type { MyUsage, MyUsageEntry } from "@/lib/types";

/**
 * 부원 본인의 사용 기록.
 *
 * 지금까지 "내가 이 장비를 얼마나 썼는지" 를 볼 곳이 없었습니다. 지난 예약 기록이
 * 목록으로 쌓여 있을 뿐이라, 스무 건이 넘어가면 세어 볼 수도 없습니다.
 *
 * 사용 후 사진을 올리지 않은 채 끝난 예약을 함께 셉니다. 지금은 알림이 한 번
 * 지나가면 다시 볼 곳이 없어서, 놓친 사람은 놓친 줄도 모릅니다.
 */

/** 목적별 색. 관리자 사용 통계와 같은 값입니다 — 두 화면이 다른 색을 쓰면 헷갈립니다. */
const PURPOSE_COLOR: Record<string, string> = {
  "대회": "#2855f3",
  "SHAPE-UP": "#e0561f",
  "교육": "#00916e",
  "기타": "#a032c0",
};
/** '얼마나 많은가' 는 한 가지 색으로. 장비 이름은 순서가 있는 값이 아닙니다. */
const MAGNITUDE = "#2855f3";

function Bars({ rows, unit, colorOf }: { rows: MyUsageEntry[]; unit: "시간" | "건"; colorOf?: (row: MyUsageEntry) => string }) {
  const top = Math.max(1, ...rows.map((row) => (unit === "시간" ? row.hours : row.count)));
  return (
    <ul className="usage-bars">
      {rows.map((row) => {
        const value = unit === "시간" ? row.hours : row.count;
        return (
          <li key={row.label}>
            <span className="usage-name">{row.label}</span>
            <span className="usage-track">
              <i style={{ width: `${Math.max(2, (value / top) * 100)}%`, background: colorOf?.(row) ?? MAGNITUDE }} />
            </span>
            {/* 색만으로 읽게 두지 않습니다. 값을 언제나 숫자로 함께 적습니다. */}
            <b className="usage-value">{value}{unit}</b>
          </li>
        );
      })}
    </ul>
  );
}

export function MyUsagePanel() {
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/reservations/summary`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setUsage((await response.json()) as MyUsage);
      })
      .catch((error: Error) => { if (error.name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, []);

  if (failed) return null;
  if (!usage) return <p className="form-note">사용 기록을 불러오는 중입니다.</p>;
  if (usage.totalCount === 0) {
    return <p className="empty-inline">아직 사용 기록이 없습니다. 장비를 한 번 쓰고 나면 여기에 쌓입니다.</p>;
  }

  return (
    <div className="my-usage">
      <div className="usage-tiles">
        <article>
          <Clock3 aria-hidden="true" />
          <strong>{usage.totalHours}</strong>
          <span>쓴 시간(시간)</span>
        </article>
        <article>
          <CalendarClock aria-hidden="true" />
          <strong>{usage.completedCount}</strong>
          <span>사용 완료</span>
        </article>
        <article className={usage.missingPhotoCount > 0 ? "warn" : ""}>
          <Camera aria-hidden="true" />
          <strong>{usage.missingPhotoCount}</strong>
          <span>사진 미제출</span>
        </article>
      </div>

      {usage.missingPhotoCount > 0 && (
        <p className="usage-warn" role="status">
          사용 시간이 끝났는데 <b>사용 후 사진을 올리지 않은 예약이 {usage.missingPhotoCount}건</b> 있습니다.
          위 ‘지난 예약 기록’ 에서 해당 예약을 펼쳐 사진을 올려 주세요.
        </p>
      )}

      {usage.equipment.length > 0 && (
        <section className="usage-block">
          <h4>장비별 사용 시간</h4>
          <Bars rows={usage.equipment} unit="시간" />
        </section>
      )}

      {usage.purposes.length > 0 && (
        <section className="usage-block">
          <h4>무엇을 위해 썼나</h4>
          <Bars rows={usage.purposes} unit="건" colorOf={(row) => PURPOSE_COLOR[row.label] ?? MAGNITUDE} />
        </section>
      )}

      <p className="form-note">
        사용을 마친 예약만 셉니다. 앞으로 잡아 둔 {usage.upcomingCount}건은 들어 있지 않습니다.
        {usage.firstUsedAt && ` 처음 사용 ${momentLabel(usage.firstUsedAt)}`}
        {usage.lastUsedAt && ` · 마지막 사용 ${momentLabel(usage.lastUsedAt)}`}
      </p>
    </div>
  );
}
