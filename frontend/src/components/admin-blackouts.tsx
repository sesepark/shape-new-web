"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, ShieldAlert } from "lucide-react";
import { useAsk } from "@/components/ask-dialog";
import { useNotice } from "@/components/use-notice";
import { adminFetch, adminSend } from "@/lib/admin-api";
import { localDay, slotLabels, spanLabel, unitTitle } from "@/lib/booking";
import type { AdminEquipmentItem, BlackoutItem, BlackoutPreview } from "@/lib/types";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HALF_HOURS = slotLabels(30);
/** 장비 전체를 고른 상태. `select` 는 빈 값으로 '고르지 않음' 을 나타내야 해서 따로 둡니다. */
const ALL_UNITS = "all";

/**
 * 사용 제한 — 운영진이 특정 시간대만 막아 두는 곳.
 *
 * 지금까지 시간을 막는 수단은 장비 **전체**를 점검 중으로 돌리는 것뿐이었습니다.
 * 목요일 저녁 교육 실습 때문에 SO-ARM 을 막으려면 나머지 엿새까지 함께 닫혔고,
 * 그래서 실제로는 아무도 그 방법을 쓰지 못했습니다. "그 시간대 개인 예약은 피해
 * 주세요" 라는 문장이 장비 설명에 글로만 남아 있던 이유입니다.
 *
 * 입력 모양을 바로 위의 정기 예약과 **똑같이** 맞췄습니다(요일 + 시각 + 기간).
 * 한 번만 막는 것은 시작 날짜와 끝 날짜를 같은 날로 두면 되고, 사흘 내리 막는
 * 것은 요일을 모두 고르고 시각을 0~24시로 두면 됩니다.
 *
 * 등록하기 **전에** 취소될 예약을 이름과 함께 보여 주는 것이 핵심입니다. 남이
 * 잡아 둔 시간을 물리는 일이므로, 몇 건이 사라지는지 모른 채 단추를 누르게 하면
 * 안 됩니다. 서버도 `cancelConflicts` 없이는 거절합니다.
 */
export function AdminBlackouts({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { ask, dialogNode } = useAsk();
  const { say, node: notice } = useNotice();
  const [equipment, setEquipment] = useState<AdminEquipmentItem[]>([]);
  const [rules, setRules] = useState<BlackoutItem[]>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [unitId, setUnitId] = useState(ALL_UNITS);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("22:00");
  const [fromDate, setFromDate] = useState(localDay);
  const [untilDate, setUntilDate] = useState(localDay);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [gear, list] = await Promise.all([adminFetch("/admin/equipment"), adminFetch("/admin/blackouts")]);
    if (gear.ok) setEquipment((await gear.json()) as AdminEquipmentItem[]);
    if (list.ok) setRules((await list.json()) as BlackoutItem[]);
    else say("사용 제한을 보려면 예약 관리 권한이 필요합니다.", false);
  }, [say]);

  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);

  const chosen = equipment.find((item) => item.id === equipmentId);
  const units = useMemo(() => chosen?.units ?? [], [chosen]);

  /** 서버에 보낼 모양. 미리보기와 등록이 같은 값을 쓰게 한 곳에서 만듭니다. */
  const body = useMemo(() => ({
    equipmentId,
    equipmentUnitId: unitId === ALL_UNITS ? null : unitId,
    reason: reason.trim(),
    weekdays,
    startTime,
    endTime,
    fromDate,
    untilDate,
  }), [equipmentId, unitId, reason, weekdays, startTime, endTime, fromDate, untilDate]);

  function invalid(): string {
    if (!equipmentId) return "장비를 골라 주세요.";
    if (weekdays.length === 0) return "요일을 하나 이상 골라 주세요.";
    if (endTime <= startTime) return "끝나는 시각이 시작 시각보다 뒤여야 합니다.";
    if (untilDate < fromDate) return "끝나는 날짜가 시작 날짜보다 앞설 수 없습니다.";
    return "";
  }

  async function submit() {
    const problem = invalid();
    if (problem) { say(problem, false); return; }
    setBusy(true);
    const looked = await adminSend("/admin/blackouts/preview", "POST", body);
    if (!looked.ok) {
      setBusy(false);
      const detail = (await looked.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "미리 확인하지 못했습니다.", false);
      return;
    }
    const preview = (await looked.json()) as BlackoutPreview;
    setBusy(false);
    if (preview.days === 0) {
      say("고른 요일이 그 기간에 하나도 들어 있지 않습니다. 기간이나 요일을 바꿔 주세요.", false);
      return;
    }
    const where = unitId === ALL_UNITS ? `${chosen?.name ?? "장비"} 전체 호기` : unitTitle(chosen?.name, units.find((unit) => unit.id === unitId)?.label);
    const confirmed = await ask({
      title: preview.clashes.length ? `예약 ${preview.clashes.length}건을 취소하고 막을까요?` : `${preview.days}일을 막을까요?`,
      description: (
        <>
          <p><b>{where}</b> · {startTime}–{endTime} · {preview.days}일이 막힙니다.</p>
          {preview.clashes.length > 0 ? (
            <>
              <p className="ask-lead">아래 예약이 <b>취소되고</b> 신청한 부원에게 사유와 함께 알림이 갑니다.</p>
              <ul>
                {preview.clashes.map((row) => (
                  <li key={row.id}>
                    {row.userName} · {unitTitle(row.equipmentName, row.unitLabel)} · {spanLabel(row.startsAt, row.endsAt)}
                  </li>
                ))}
              </ul>
              <p>이미 사용을 시작한 예약은 건드리지 않습니다. 취소된 예약은 제한을 풀어도 되돌아오지 않습니다.</p>
            </>
          ) : (
            <p>그 시간에 잡혀 있는 예약은 없습니다.</p>
          )}
        </>
      ),
      confirmLabel: preview.clashes.length ? "취소하고 막기" : "막기",
      tone: preview.clashes.length ? "danger" : "default",
    });
    if (confirmed === null) return;

    setBusy(true);
    const response = await adminSend("/admin/blackouts", "POST", { ...body, cancelConflicts: true });
    setBusy(false);
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "막지 못했습니다.", false);
      return;
    }
    // 미리보기와 등록 사이에 새 신청이 들어올 수 있으므로, 미리 센 수가 아니라
    // 서버가 실제로 취소한 수를 말합니다.
    const created = (await response.json()) as BlackoutItem;
    const cancelled = created.cancelledCount ?? preview.clashes.length;
    say(cancelled
      ? `${created.upcomingDays || preview.days}일을 막고 예약 ${cancelled}건을 취소했습니다.`
      : `${created.upcomingDays || preview.days}일을 막았습니다.`);
    setWeekdays([]);
    setReason("");
    await reload();
    await onChanged?.();
  }

  async function remove(rule: BlackoutItem) {
    const confirmed = await ask({
      title: "사용 제한을 풀까요?",
      description: `${unitTitle(rule.equipmentName, rule.unitLabel)} · ${rule.startTime}–${rule.endTime}. 풀면 그 시간이 곧바로 다시 열립니다. 이미 취소된 예약은 되돌아오지 않습니다.`,
      confirmLabel: "해제",
      tone: "danger",
    });
    if (confirmed === null) return;
    const response = await adminFetch(`/admin/blackouts/${rule.id}`, { method: "DELETE" });
    if (!response.ok) { say("해제하지 못했습니다.", false); return; }
    say("사용 제한을 풀었습니다.");
    await reload();
    await onChanged?.();
  }

  return (
    <section className="admin-blackouts">
      <h3><ShieldAlert size={17} aria-hidden="true" /> 사용 제한</h3>
      <p className="form-note">
        정비·교육 실습·대회 준비처럼 <b>특정 시간대만</b> 막습니다. 장비 전체를 점검 중으로 돌리지 않아도 됩니다.
        막힌 칸은 예약 화면에 ‘사용 제한’ 으로 보이고 사유도 함께 표시됩니다.
        <b> 하루만 막으려면</b> 시작 날짜와 끝 날짜를 같은 날로 두세요.
      </p>

      <label>
        장비
        <select value={equipmentId} onChange={(event) => { setEquipmentId(event.target.value); setUnitId(ALL_UNITS); }}>
          <option value="">고르기</option>
          {equipment.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>

      <label>
        호기
        <select value={unitId} onChange={(event) => setUnitId(event.target.value)} disabled={!equipmentId}>
          <option value={ALL_UNITS}>전체 호기</option>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
        </select>
      </label>

      <div className="recurring-weekdays">
        <span className="booking-field-label">요일</span>
        <div className="weekday-grid" role="group" aria-label="막을 요일">
          {WEEKDAYS.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={weekdays.includes(index)}
              className={weekdays.includes(index) ? "active" : ""}
              onClick={() => setWeekdays((current) =>
                current.includes(index) ? current.filter((row) => row !== index) : [...current, index].sort())}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="recurring-times">
        <label>
          시작 시각
          <select value={startTime} onChange={(event) => setStartTime(event.target.value)}>
            {HALF_HOURS.map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </label>
        <label>
          끝나는 시각
          <select value={endTime} onChange={(event) => setEndTime(event.target.value)}>
            {[...HALF_HOURS.slice(1), "24:00"].map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </label>
        <label>
          시작 날짜
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>
          끝나는 날짜
          <input type="date" value={untilDate} min={fromDate} onChange={(event) => setUntilDate(event.target.value)} />
        </label>
      </div>

      <label>
        사유
        <input
          type="text"
          value={reason}
          maxLength={200}
          placeholder="예: 목요일 교육 트랙 정규 실습"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <small className="field-hint">사유는 예약 화면에 <b>그대로 보입니다.</b> 부원이 왜 못 누르는지 알 수 있게 적어 주세요.</small>

      <div className="admin-actions">
        <button className="button" type="button" disabled={busy} onClick={submit}>
          {busy ? "확인 중" : "이 시간 막기"}
        </button>
      </div>
      {notice}

      {rules.length > 0 && (
        <div className="admin-items">
          <h3>걸려 있는 사용 제한 <em>{rules.length}</em></h3>
          {rules.map((rule) => (
            <div className={`admin-item${rule.upcomingDays === 0 ? " spent" : ""}`} key={rule.id}>
              <div className="admin-item-copy">
                <strong>
                  {rule.unitLabel ? unitTitle(rule.equipmentName, rule.unitLabel) : `${rule.equipmentName} 전체 호기`}
                </strong>
                <span>
                  <CalendarX2 size={13} aria-hidden="true" />
                  {" "}매주 {rule.weekdays.map((index) => WEEKDAYS[index]).join("·")} {rule.startTime}–{rule.endTime}
                  {" · "}{rule.fromDate} ~ {rule.untilDate}
                  {rule.upcomingDays > 0 ? ` · 남은 ${rule.upcomingDays}일` : " · 지난 제한"}
                  {rule.reason && ` · ${rule.reason}`}
                </span>
              </div>
              <div className="admin-item-actions">
                <button type="button" className="danger" onClick={() => remove(rule)}>해제</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {dialogNode}
    </section>
  );
}
