"use client";

import Link from "next/link";
import { Camera, X } from "lucide-react";
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ReservationItem } from "@/lib/types";

/** 사용 시작을 누를 수 있게 열리는 시점. 백엔드의 허용 시각과 같습니다. */
const START_GRACE_MINUTES = 10;
/**
 * 이 띠 하나 때문에 회원이 새로고침할 때마다 예약 목록을 다시 조회하면,
 * 무료 티어에서 가장 자주 불리는 데이터베이스 질의가 됩니다. 예약은 자주 바뀌는
 * 값이 아니므로 탭이 살아 있는 동안 잠시 재사용합니다.
 */
const CACHE_KEY = "shape:reservations";
const CACHE_MS = 3 * 60_000;
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

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
function due(rows: ReservationItem[]): ReservationItem | null {
  const now = Date.now();
  return (
    rows.find((row) => {
      if (row.status === "IN_USE") return true;
      if (row.status !== "APPROVED") return false;
      const starts = new Date(row.startsAt).getTime();
      return starts - START_GRACE_MINUTES * 60_000 <= now && now < new Date(row.endsAt).getTime();
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
      const saved = cached();
      if (saved) {
        setItem(due(saved));
        return;
      }
      const response = await fetch(`${API_URL}/reservations/me`, { credentials: "include", cache: "no-store", signal: controller.signal }).catch(() => null);
      if (!response?.ok) return;
      const rows = (await response.json()) as ReservationItem[];
      remember(rows);
      setItem(due(rows));
    })();
    return () => controller.abort();
  }, [session]);

  if (!item || closed) return null;
  const running = item.status === "IN_USE";
  // 호기 이름이 이미 "OMY 2호기" 처럼 장비명을 품고 있으면 두 번 쓰지 않습니다.
  const where = item.unitLabel?.startsWith(item.equipmentName)
    ? item.unitLabel
    : [item.equipmentName, item.unitLabel].filter(Boolean).join(" ");
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
