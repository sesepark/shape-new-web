"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, SlidersHorizontal } from "lucide-react";
import { useNotice } from "@/components/use-notice";
import { adminFetch, adminSend } from "@/lib/admin-api";
import { momentLabel } from "@/lib/booking";
import type { ReservationPolicy } from "@/lib/types";

/**
 * 예약이 굴러가는 시각과 상한.
 *
 * 예전에는 전부 파이썬 상수였습니다. 자동 확정을 한 시간에서 두 시간으로 바꾸는
 * 일에도 코드 수정과 배포가 필요했고, 정작 운영을 맡은 사람이 스스로 조절할 수
 * 없었습니다.
 *
 * 값마다 **무엇이 달라지는지**를 함께 적습니다. 숫자만 늘어놓으면 "사용 시작
 * 여유 10분" 이 무엇을 뜻하는지 알 수 없어, 결국 아무도 건드리지 못합니다.
 */

type Field = {
  key: keyof ReservationPolicy;
  label: string;
  unit: string;
  min: number;
  max: number;
  hint: string;
};

const FIELDS: Field[] = [
  {
    key: "autoApproveMinutes", label: "자동 확정 시점", unit: "분", min: 0, max: 60 * 24 * 30,
    hint: "시작까지 이만큼 남았고 같은 시간에 다른 신청이 없으면 운영진을 기다리지 않고 확정됩니다. 신청하는 순간 이미 그 안이면 곧바로 확정됩니다.",
  },
  {
    key: "staffReminderMinutes", label: "운영진 독촉 시점", unit: "분", min: 0, max: 60 * 24 * 30,
    hint: "시작이 이만큼 앞인데 아직 대기 중이면 운영진에게 한 번 더 알립니다. 자동 확정보다 앞에 두어야 직접 볼 틈이 생깁니다.",
  },
  {
    key: "startGraceMinutes", label: "사용 시작 여유", unit: "분", min: 0, max: 60 * 12,
    hint: "예약 시각 이만큼 전부터 ‘사용 시작’ 을 누를 수 있습니다. 너무 길게 두면 예약 현황이 실제 장비 상태와 어긋납니다.",
  },
  {
    key: "beforePhotoGraceMinutes", label: "사용 전 사진 독촉", unit: "분", min: 1, max: 60 * 24,
    hint: "사용 시간이 시작된 뒤 이만큼 지나도 사용 전 사진이 없으면 한 번 더 재촉합니다.",
  },
  {
    key: "maxHours", label: "한 번에 최대 예약", unit: "시간", min: 1, max: 24,
    hint: "예약 한 건의 최대 길이입니다. 길게 두면 한 사람이 하루를 통째로 잡을 수 있습니다.",
  },
  {
    key: "bookingWindowDays", label: "예약 가능 기간", unit: "일", min: 1, max: 365,
    hint: "오늘부터 며칠 앞까지 신청할 수 있는지. 짧게 두면 학기 초 선점을 막을 수 있고, 대기 목록도 그만큼 짧아집니다.",
  },
  {
    key: "recurringMax", label: "정기 예약 최대 건수", unit: "건", min: 1, max: 100,
    hint: "정기 예약을 한 번에 몇 건까지 만들 수 있는지. 한 번의 실수가 되돌리기 어려운 양이 되지 않게 하는 장치입니다.",
  },
];

const DEFAULTS: ReservationPolicy = {
  autoApproveMinutes: 60,
  staffReminderMinutes: 120,
  startGraceMinutes: 10,
  beforePhotoGraceMinutes: 30,
  maxHours: 12,
  bookingWindowDays: 180,
  recurringMax: 30,
};

export function AdminReservationPolicy() {
  const { say, node: notice } = useNotice();
  const [form, setForm] = useState<ReservationPolicy>(DEFAULTS);
  const [saved, setSaved] = useState<ReservationPolicy | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const response = await adminFetch("/admin/reservation-policy").catch(() => null);
    if (!response?.ok) { say("예약 정책을 보려면 예약 관리 권한이 필요합니다.", false); return; }
    const row = (await response.json()) as ReservationPolicy;
    setForm(row);
    setSaved(row);
  }, [say]);

  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);

  const dirty = saved !== null && FIELDS.some((field) => form[field.key] !== saved[field.key]);
  // 독촉이 자동 확정보다 늦으면 울릴 일이 없습니다. 막지는 않고 알려만 줍니다 —
  // 자동 확정을 아주 길게 두는 설정에서는 일부러 그럴 수도 있습니다.
  const reminderTooLate = form.staffReminderMinutes <= form.autoApproveMinutes;

  /** 지금 설정이면 실제로 언제 확정되는지. 숫자만 보고는 감이 오지 않습니다. */
  const example = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);
    return `내일 ${momentLabel(tomorrow)} 예약이라면 ${momentLabel(tomorrow.getTime() - form.autoApproveMinutes * 60_000)}에 저절로 확정됩니다.`;
  };

  async function submit() {
    setBusy(true);
    const response = await adminSend("/admin/reservation-policy", "PUT", form);
    setBusy(false);
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "저장하지 못했습니다.", false);
      return;
    }
    setSaved((await response.json()) as ReservationPolicy);
    say("예약 정책을 저장했습니다. 다음 신청부터 적용됩니다.");
  }

  return (
    <section className="admin-policy">
      <h3><SlidersHorizontal size={17} aria-hidden="true" /> 예약 정책</h3>
      <p className="form-note">
        예약이 굴러가는 시각과 상한입니다. 저장하면 <b>다음 신청부터</b> 적용되고, 부원 화면의 안내 문구도
        여기 값을 그대로 읽어 갑니다. 바꾼 내용은 수정 내역에 남습니다.
      </p>

      <div className="policy-grid">
        {FIELDS.map((field) => (
          <label key={field.key}>
            <span>{field.label} <i>({field.unit})</i></span>
            <input
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              value={form[field.key]}
              onChange={(event) => {
                const next = Number(event.target.value);
                setForm((current) => ({ ...current, [field.key]: Number.isFinite(next) ? next : current[field.key] }));
              }}
            />
            <small>{field.hint}</small>
          </label>
        ))}
      </div>

      <p className="policy-example" role="status">{example()}</p>
      {reminderTooLate && (
        <p className="policy-warn" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          독촉 시점이 자동 확정 시점보다 늦거나 같습니다. 독촉이 가기 전에 이미 확정되므로 알림이 울리지 않습니다.
        </p>
      )}

      <div className="admin-actions">
        <button className="button" type="button" disabled={busy || !dirty} onClick={submit}>
          {busy ? "저장 중" : dirty ? "예약 정책 저장" : "바뀐 값 없음"}
        </button>
        {dirty && (
          <button className="button secondary" type="button" onClick={() => saved && setForm(saved)}>
            되돌리기
          </button>
        )}
      </div>
      {notice}
    </section>
  );
}
