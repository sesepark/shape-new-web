"use client";

import { Camera } from "lucide-react";
import { useEffect, useState } from "react";
import { ImageUploadField } from "@/components/image-upload-field";
import { API_URL } from "@/lib/api";
import type { ReservationItem } from "@/lib/types";

/**
 * 사용 전·후 사진을 올리고 예약 상태를 넘기는 한 단계.
 * 마이페이지와 장비 예약 현황 두 곳에서 같은 화면을 씁니다. 장비 앞에 선
 * 부원이 어느 쪽을 열든 그 자리에서 바로 올릴 수 있어야 하기 때문입니다.
 */
export function ReservationPhotoStep({
  reservation,
  onDone,
  compact = false,
}: {
  reservation: Pick<ReservationItem, "id" | "status" | "endsAt">;
  onDone: (next: ReservationItem) => void;
  compact?: boolean;
}) {
  const [photo, setPhoto] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // 일찍 마쳤을 때 남은 시간을 돌려줄지. 기본은 돌려주는 쪽입니다 — 안 쓰는
  // 시간을 붙잡아 두는 것이 이득인 사람은 없고, 붙잡아 두면 그 시간에 오려던
  // 다른 부원이 헛걸음합니다.
  const [giveBack, setGiveBack] = useState(true);
  const step = reservation.status === "APPROVED" ? "before" : "after";
  const before = step === "before";
  // 남은 시간은 화면을 켜 둔 채로도 줄어듭니다. 그릴 때마다 시계를 읽으면 값이
  // 렌더마다 달라지므로, 분마다 한 번만 새로 읽어 상태에 담아 둡니다.
  // 0 으로 시작해 화면이 붙은 뒤에 채웁니다. 서버에서 그릴 때의 시계와 브라우저의
  // 시계가 다르면 첫 그림이 어긋나므로, 시계는 브라우저에서만 읽습니다.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // 30분 미만이 남았으면 되돌려 줄 것이 없습니다(칸이 30분 단위라 그렇습니다).
  const leftMinutes = now === 0 ? 0 : Math.floor((new Date(reservation.endsAt).getTime() - now) / 60_000);
  const canGiveBack = !before && leftMinutes >= 30;
  const leftLabel = leftMinutes >= 60
    ? `${Math.floor(leftMinutes / 60)}시간${leftMinutes % 60 ? ` ${leftMinutes % 60}분` : ""}`
    : `${leftMinutes}분`;

  async function submit() {
    if (!photo) { setMessage("사진을 먼저 올려 주세요."); return; }
    setBusy(true);
    const response = await fetch(`${API_URL}/reservations/${reservation.id}/${step}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: photo, releaseRemaining: canGiveBack && giveBack }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const detail = response ? ((await response.json().catch(() => ({}))) as { detail?: string }).detail : null;
      setMessage(detail ?? "기록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const next = (await response.json()) as ReservationItem;
    const returned = canGiveBack && giveBack && new Date(next.endsAt).getTime() < new Date(reservation.endsAt).getTime();
    onDone(next);
    setPhoto("");
    setMessage(returned ? "사용을 마쳤습니다. 남은 시간을 반납해 다른 부원이 바로 예약할 수 있습니다." : "");
  }
  return (
    <div className={`reservation-photo-step${before ? "" : " after"}${compact ? " compact" : ""}`}>
      <header>
        <span className="step-badge">{before ? "STEP 1" : "STEP 2"}</span>
        <div>
          <strong>{before ? "사용 전 사진을 올리고 시작하기" : "사용 후 사진을 올리고 완료하기"}</strong>
          {!compact && (
            <p>
              {before
                ? "장비를 만지기 전 상태를 한 장 찍어 올려 주세요. 다음 사용자가 이전 상태를 확인할 수 있고, 이상이 있을 때 원인을 빠르게 좁힐 수 있습니다."
                : "정리를 마친 상태를 찍어 올리면 사용이 완료 처리됩니다. 파손이나 이상 동작을 발견했다면 정리 전에 사진과 함께 운영진에게 알려 주세요."}
            </p>
          )}
        </div>
      </header>
      <ImageUploadField purpose="reservation" label={before ? "사용 전 상태 사진" : "사용 후 상태 사진"} value={photo} onChange={setPhoto} />
      {canGiveBack && (
        <label className="reservation-giveback">
          <input type="checkbox" checked={giveBack} onChange={(event) => setGiveBack(event.target.checked)} />
          <span>남은 시간 <b>{leftLabel}</b>을(를) 반납합니다 — 다른 부원이 그 시간을 바로 예약할 수 있습니다.</span>
        </label>
      )}
      <button className="button small" type="button" disabled={busy || !photo} onClick={submit}>
        <Camera size={15} />
        {busy ? "기록 중" : before ? "사용 시작하기" : "사용 완료하기"}
      </button>
      {message && <p className="form-note">{message}</p>}
    </div>
  );
}
