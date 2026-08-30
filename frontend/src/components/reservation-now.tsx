"use client";

import Link from "next/link";
import { Camera, X } from "lucide-react";
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { CLOCK_OPTIONS, unitTitle } from "@/lib/booking";
import { loadPolicy } from "@/lib/policy";
import { useSession } from "@/lib/session";
import type { ReservationItem } from "@/lib/types";

/**
 * 사용 시작을 누를 수 있게 열리는 시점의 **기본값**입니다.
 *
 * 예전에는 이 10분이 여기 박혀 있었습니다. 그런데 백엔드는 같은 값을 관리자
 * 화면의 예약 정책에서 읽습니다. 그래서 '사용 시작 여유' 를 30분으로 바꾸면
 * 서버는 30분 전부터 받아 주는데 이 띠는 10분 전에야 떴고, 장비 앞에 선
 * 부원에게 20분 동안 아무 안내가 없었습니다.
 *
 * 이제 공개 창구에서 실제 값을 읽고, 못 받아 왔을 때만 이 값을 씁니다.
 */
const FALLBACK_GRACE_MINUTES = 10;
/**
 * 이 띠 하나 때문에 회원이 새로고침할 때마다 예약 목록을 다시 조회하면,
 * 무료 티어에서 가장 자주 불리는 데이터베이스 질의가 됩니다. 예약은 자주 바뀌는
 * 값이 아니므로 탭이 살아 있는 동안 잠시 재사용합니다.
 */
const CACHE_KEY = "shape:reservations";
const CACHE_MS = 3 * 60_000;
// 예약 시각은 어디서나 24시간제입니다(`lib/booking.ts` 의 `CLOCK_OPTIONS`).
const clock = new Intl.DateTimeFormat("ko-KR", CLOCK_OPTIONS);

function cached(): ReservationItem[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: number; rows: ReservationItem[] };
    return Date.now() - saved.at < CACHE_MS ? saved.rows : null;
  } catch {
    return null;
  }
}

function remember(rows: ReservationItem[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    // 시크릿 창처럼 저장이 막힌 곳에서는 그냥 매번 물어봅니다.
  }
}

/** 지금 손을 써야 하는 예약. 사용 중이거나 곧 시작하는 것 하나. */
function due(rows: ReservationItem[], graceMinutes: number): ReservationItem | null {
  const now = Date.now();
  return (
    rows.find((row) => {
      if (row.status === "IN_USE") return true;
      if (row.status !== "APPROVED") return false;
      const starts = new Date(row.startsAt).getTime();
      return starts - graceMinutes * 60_000 <= now && now < new Date(row.endsAt).getTime();
    }) ?? null
  );
}

/**
 * 지금 써야 하는 예약이 있으면 어느 화면에서든 알려 주는 띠.
 *
 * 사용 전·후 사진은 마이페이지 안쪽에만 있어서, 장비 앞에 선 부원이 거기까지
 * 찾아 들어가야 했습니다. 지금 차례인 예약이 있을 때만 나타나므로 평소에는
 * 화면에 아무것도 더하지 않습니다.
 */
export function ReservationNow() {
  const { session } = useSession();
  const [item, setItem] = useState<ReservationItem | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    // 로그인하지 않은 방문자에게는 요청조차 보내지 않습니다.
    if (!session || session.status !== "APPROVED") return;
    const controller = new AbortController();
    void (async () => {
      // 서버가 실제로 쓰는 '사용 시작 여유' 를 읽습니다. 여기 숫자를 박아 두면
      // 관리자가 정책을 바꿨을 때 이 띠만 옛 값으로 남습니다.
      const grace = (await loadPolicy()).startGraceMinutes ?? FALLBACK_GRACE_MINUTES;
      const saved = cached();
      if (saved) {
        setItem(due(saved, grace));
        return;
      }
      const response = await fetch(`${API_URL}/reservations/me`, { credentials: "include", cache: "no-store", signal: controller.signal }).catch(() => null);
      if (!response?.ok) return;
      const rows = (await response.json()) as ReservationItem[];
      remember(rows);
      setItem(due(rows, grace));
    })();
    return () => controller.abort();
  }, [session]);

  if (!item || closed) return null;
  const running = item.status === "IN_USE";
  // 호기 이름이 이미 "OMY 2호기" 처럼 장비명을 품고 있으면 두 번 쓰지 않습니다.
  // 같은 규칙을 마이페이지·관리자 화면도 쓰므로 `booking` 에 한 곳으로 두었습니다.
  const where = unitTitle(item.equipmentName, item.unitLabel);
  return (
    <aside className="reservation-now" role="status">
      <Camera size={19} />
      <div>
        <b>{running ? "사용 중" : "사용 시작 전"} · {where}</b>
        <small>
          {clock.format(new Date(item.startsAt))}–{clock.format(new Date(item.endsAt))} ·{" "}
          {running ? "정리 후 사용 후 사진을 올려 주세요." : "사용 전 사진을 올리면 시작됩니다."}
        </small>
      </div>
      <Link href="/mypage">사진 올리기</Link>
      <button type="button" onClick={() => setClosed(true)} aria-label="알림 닫기"><X size={15} /></button>
    </aside>
  );
}
