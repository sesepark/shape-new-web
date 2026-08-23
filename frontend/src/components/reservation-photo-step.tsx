"use client";

import { Camera } from "lucide-react";
import { useState } from "react";
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
  reservation: Pick<ReservationItem, "id" | "status">;
  onDone: (next: ReservationItem) => void;
  compact?: boolean;
}) {
  const [photo, setPhoto] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const step = reservation.status === "APPROVED" ? "before" : "after";
  const before = step === "before";
  async function submit() {
    if (!photo) { setMessage("사진을 먼저 올려 주세요."); return; }
    setBusy(true);
    const response = await fetch(`${API_URL}/reservations/${reservation.id}/${step}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: photo }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const detail = response ? ((await response.json().catch(() => ({}))) as { detail?: string }).detail : null;
      setMessage(detail ?? "기록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    onDone((await response.json()) as ReservationItem);
    setPhoto("");
    setMessage("");
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
      <button className="button small" type="button" disabled={busy || !photo} onClick={submit}>
        <Camera size={15} />
        {busy ? "기록 중" : before ? "사용 시작하기" : "사용 완료하기"}
      </button>
      {message && <p className="form-note">{message}</p>}
    </div>
  );
}
