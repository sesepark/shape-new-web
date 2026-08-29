"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Repeat2 } from "lucide-react";
import { useAsk } from "@/components/ask-dialog";
import { SegmentedChoice } from "@/components/segmented-choice";
import { AutoTextarea } from "@/components/auto-textarea";
import { useNotice } from "@/components/use-notice";
import { adminFetch, adminSend } from "@/lib/admin-api";
import { PURPOSE_CATEGORIES, URGENCY_LEVELS, localDay, slotLabels, unitTitle } from "@/lib/booking";
import type {
  AdminEquipmentItem,
  AdminReservationItem,
  RecurringGroup,
  RecurringResult,
  ReservationPurpose,
  ReservationUrgency,
} from "@/lib/types";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HALF_HOURS = slotLabels(30);
/** 서버와 같은 상한. 한 번의 실수가 되돌리기 어려운 양이 되지 않게 합니다. */
const MAX_ROWS = 30;

const day = (value: string) => new Date(`${value}T12:00:00`);
const dayLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });

/** 요일·기간에서 실제로 만들어질 날짜. 서버와 같은 방식으로 폅니다. */
function expand(weekdays: number[], from: string, until: string): string[] {
  const start = day(from);
  const end = day(until);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const wanted = new Set(weekdays);
  const out: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    // `Date.getDay()` 는 일요일이 0 이고 서버는 월요일이 0 입니다.
    if (wanted.has((cursor.getDay() + 6) % 7)) out.push(localDay(cursor));
  }
  return out;
}

/**
 * 정기 예약. 운영진만 씁니다.
 *
 * 교육 트랙은 화·수·목이 학기 내내 고정인데, 지금까지는 같은 신청을 매주 손으로
 * 되풀이해야 했습니다. 등록하기 **전에** 만들어질 날짜를 보여 주고 이미 잡혀 있는
 * 날짜를 표시하는 것이 핵심입니다 — 서른 건을 만든 뒤에 알게 되면 되돌리기가
 * 번거롭습니다.
 */
export function AdminRecurring({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const { ask, dialogNode } = useAsk();
  const { say, node: notice } = useNotice();
  const [open, setOpen] = useState(false);
  const [equipment, setEquipment] = useState<AdminEquipmentItem[]>([]);
  const [groups, setGroups] = useState<RecurringGroup[]>([]);
  const [approved, setApproved] = useState<AdminReservationItem[]>([]);
  const [unitId, setUnitId] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [fromDate, setFromDate] = useState(localDay);
  const [untilDate, setUntilDate] = useState(localDay);
  const [purposeCategory, setPurposeCategory] = useState<ReservationPurpose>("EDUCATION");
  const [urgency, setUrgency] = useState<ReservationUrgency>("NORMAL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [gear, list, booked] = await Promise.all([
      adminFetch("/admin/equipment"),
      adminFetch("/admin/reservations/recurring"),
      adminFetch("/admin/reservations?status=APPROVED&limit=300"),
    ]);
    if (gear.ok) setEquipment((await gear.json()) as AdminEquipmentItem[]);
    if (list.ok) setGroups((await list.json()) as RecurringGroup[]);
    if (booked.ok) setApproved((await booked.json()) as AdminReservationItem[]);
  }, []);

  useEffect(() => {
    if (!open) return;
    const load = async () => { await reload(); };
    void load();
  }, [open, reload]);

  const units = useMemo(
    () => equipment.flatMap((item) => (item.units ?? []).map((unit) => ({ ...unit, equipmentName: item.name }))),
    [equipment],
  );

  /** 만들어질 날짜와, 그중 이미 확정 예약이 걸려 있는 날짜. */
  const preview = useMemo(() => {
    const days = expand(weekdays, fromDate, untilDate);
    const busyDays = new Set(
      approved
        .filter((row) => row.equipmentUnitId === unitId)
        .map((row) => localDay(new Date(row.startsAt))),
    );
    return days.map((value) => ({ day: value, clash: busyDays.has(value) }));
  }, [weekdays, fromDate, untilDate, approved, unitId]);

  const tooMany = preview.length > MAX_ROWS;

  async function submit() {
    if (!unitId) { say("장비 호기를 골라 주세요.", false); return; }
    if (weekdays.length === 0) { say("요일을 하나 이상 골라 주세요.", false); return; }
    if (endTime <= startTime) { say("끝나는 시각이 시작 시각보다 뒤여야 합니다.", false); return; }
    if (preview.length === 0) { say("그 기간에 해당하는 요일이 없습니다.", false); return; }
    if (tooMany) { say(`한 번에 ${MAX_ROWS}건까지 만들 수 있습니다. 기간을 나눠 주세요.`, false); return; }
    const clashes = preview.filter((row) => row.clash).length;
    if (clashes === preview.length) {
      // 만들 것이 하나도 없는데 "0건을 등록할까요?" 라고 물으면, 무엇이 잘못됐는지
      // 알 수 없는 채로 확인만 누르게 된다. 물어보기 전에 이유를 말한다.
      say("고른 요일이 모두 이미 잡혀 있습니다. 기간이나 시간을 바꿔 주세요.", false);
      return;
    }
    const confirmed = await ask({
      title: `정기 예약 ${preview.length - clashes}건을 등록할까요?`,
      description: clashes > 0
        ? `이미 확정된 예약이 있는 ${clashes}일은 건너뜁니다. 나머지는 곧바로 확정 상태로 잡힙니다.`
        : "곧바로 확정 상태로 잡힙니다. 운영진이 넣는 것이라 승인을 따로 기다리지 않습니다.",
      confirmLabel: "등록",
    });
    if (confirmed === null) return;
    setBusy(true);
    const response = await adminSend("/admin/reservations/recurring", "POST", {
      equipmentUnitId: unitId, weekdays, startTime, endTime, fromDate, untilDate,
      purposeCategory, urgency, note,
    });
    setBusy(false);
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "정기 예약을 만들지 못했습니다.", false);
      return;
    }
    const result = (await response.json()) as RecurringResult;
    say(result.skipped.length
      ? `${result.created.length}건을 등록했습니다. 이미 예약이 있는 ${result.skipped.length}일은 건너뛰었습니다.`
      : `${result.created.length}건을 등록했습니다.`);
    setWeekdays([]);
    await reload();
    await onChanged();
  }

  async function remove(group: RecurringGroup) {
    const confirmed = await ask({
      title: "정기 예약을 해제할까요?",
      description: `${unitTitle(group.equipmentName, group.unitLabel)} · 아직 시작하지 않은 ${group.upcoming}건이 취소됩니다. 이미 지나간 ${group.total - group.upcoming}건은 사용 기록이라 그대로 둡니다.`,
      confirmLabel: "해제",
      tone: "danger",
    });
    if (confirmed === null) return;
    const response = await adminFetch(`/admin/reservations/recurring/${group.groupId}`, { method: "DELETE" });
    if (!response.ok) { say("해제하지 못했습니다.", false); return; }
    say(`앞으로 남은 ${group.upcoming}건을 취소했습니다.`);
    await reload();
    await onChanged();
  }

  return (
    <section className="admin-recurring">
      <button type="button" className="text-button recurring-toggle" onClick={() => setOpen(!open)}>
        <Repeat2 size={15} aria-hidden="true" /> 정기 예약 {open ? "닫기" : "열기"}
      </button>
      {open && (
        <div className="recurring-body">
          <p className="form-note">
            교육 트랙처럼 학기 내내 같은 요일·같은 시각을 쓰는 일정을 한 번에 잡습니다.
            <b> 곧바로 확정 상태</b>가 되고, 예약은 등록한 운영진 이름으로 잡힙니다.
            실제로 오는 부원은 각 예약에서 따로 넣어 주세요.
          </p>

          <label>
            장비 호기
            <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              <option value="">고르기</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>{unitTitle(unit.equipmentName, unit.label)}</option>
              ))}
            </select>
          </label>

          <div className="recurring-weekdays">
            <span className="booking-field-label">요일</span>
            <div className="weekday-grid" role="group" aria-label="요일">
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

          <SegmentedChoice label="사용 목적" options={PURPOSE_CATEGORIES} value={purposeCategory} onChange={setPurposeCategory} />
          <SegmentedChoice label="사용 시급도" options={URGENCY_LEVELS} value={urgency} onChange={setUrgency} levelled />

          <label className="booking-note">
            <span className="booking-field-label">기타 내용 <i>(선택)</i></span>
            <AutoTextarea value={note} onChange={setNote} minRows={2} maxLength={2000} placeholder="예: 2기 교육 트랙 정규 실습" />
          </label>

          {preview.length > 0 && (
            <div className="recurring-preview">
              <p className={tooMany ? "warn" : ""}>
                <CalendarRange size={15} aria-hidden="true" />
                만들어질 날짜 <b>{preview.length}일</b>
                {tooMany && ` — ${MAX_ROWS}일을 넘습니다. 기간을 나눠 주세요.`}
              </p>
              <ul>
                {preview.map((row) => (
                  <li key={row.day} className={row.clash ? "clash" : ""}>
                    {dayLabel.format(day(row.day))}
                    {row.clash && <i>이미 예약 있음 · 건너뜀</i>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="admin-actions">
            <button className="button" type="button" disabled={busy} onClick={submit}>
              {busy ? "등록 중" : "정기 예약 등록"}
            </button>
          </div>
          {notice}

          {groups.length > 0 && (
            <div className="admin-items">
              <h3>등록된 정기 예약 <em>{groups.length}</em></h3>
              {groups.map((group) => (
                <div className="admin-item" key={group.groupId}>
                  <div className="admin-item-copy">
                    <strong>{unitTitle(group.equipmentName, group.unitLabel)}</strong>
                    <span>
                      매주 {group.weekdays.map((index) => WEEKDAYS[index]).join("·")} {group.startTime}–{group.endTime}
                      {" · "}{group.firstDate} ~ {group.lastDate} · 전체 {group.total}건 (남은 {group.upcoming}건)
                    </span>
                  </div>
                  <div className="admin-item-actions">
                    <button type="button" className="danger" disabled={group.upcoming === 0} onClick={() => remove(group)}>
                      해제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {dialogNode}
    </section>
  );
}
