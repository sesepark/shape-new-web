"use client";

import Link from "next/link";
import { Camera, X } from "lucide-react";
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ReservationItem } from "@/lib/types";

/** 사용 시작을 누를 수 있게 열리는 시점. 백엔드의 허용 시각과 같습니다. */
const START_GRACE_MINUTES = 10;
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

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
    void fetch(`${API_URL}/reservations/me`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const rows = (await response.json()) as ReservationItem[];
        const now = Date.now();
        const due = rows.find((row) => {
          if (row.status === "IN_USE") return true;
          if (row.status !== "APPROVED") return false;
          const starts = new Date(row.startsAt).getTime();
          return starts - START_GRACE_MINUTES * 60_000 <= now && now < new Date(row.endsAt).getTime();
        });
        setItem(due ?? null);
      })
      .catch(() => undefined);
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
