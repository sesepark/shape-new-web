"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronRight, CircleAlert, ClipboardPenLine, Wrench } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { media } from "@/lib/media";
import type { EquipmentAvailability, EquipmentItem } from "@/lib/types";

function localDay() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
const timeLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const dateLabel = (day: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${day}T12:00:00`));

function mockAvailability(equipment: EquipmentItem, day: string): EquipmentAvailability {
  const reservedStarts = ["10:00", "10:30"].map((time) => `${day}T${time}:00+09:00`);
  return { equipmentId: equipment.id, reservationUnitMinutes: equipment.reservationUnitMinutes, openHour: equipment.openHour, closeHour: equipment.closeHour, units: Array.from({ length: Math.max(1, equipment.availableUnits) }, (_, index) => ({ id: `${equipment.id}-unit-${index + 1}`, label: `${equipment.name} ${index + 1}호기`, reservedStarts: index === 0 ? reservedStarts : [] })) };
}

const steps = [["장비 선택", Wrench], ["일정 선택", CalendarDays], ["신청 정보", ClipboardPenLine], ["예약 완료", Check]] as const;
const RESERVATION_OPEN_HOUR = 0;
const RESERVATION_CLOSE_HOUR = 24;

export function EquipmentReservation({ equipment }: { equipment: EquipmentItem[] }) {
  const search = useSearchParams();
  const scheduleRef = useRef<HTMLDivElement>(null);
  const [equipmentId, setEquipmentId] = useState(search.get("equipment") ?? equipment.find((item) => item.status === "ACTIVE")?.id ?? "");
  const [day, setDay] = useState(localDay);
  const [availability, setAvailability] = useState<EquipmentAvailability | null>(null);
  const [unitId, setUnitId] = useState("");
  const [startHour, setStartHour] = useState("");
  const [endHour, setEndHour] = useState("");
  const [purpose, setPurpose] = useState("");
  const [stage, setStage] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(equipment.length));
  const selected = equipment.find((item) => item.id === equipmentId);

  useEffect(() => {
    if (!equipmentId || !day) return;
    const controller = new AbortController();
    fetch(`${API_URL}/equipment/${equipmentId}/availability?date=${encodeURIComponent(day)}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); const data = await response.json() as EquipmentAvailability; setAvailability(data); setUnitId(data.units[0]?.id ?? ""); })
      .catch((error: Error) => { if (error.name !== "AbortError") { const fallbackItem = equipment.find((item) => item.id === equipmentId); if (fallbackItem?.id.startsWith("mock-")) { const fallback = mockAvailability(fallbackItem, day); setAvailability(fallback); setUnitId(fallback.units[0]?.id ?? ""); setMessage("예시 예약 현황을 표시하고 있습니다."); } else { setAvailability(null); setMessage("예약 현황을 불러오지 못했습니다."); } } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [equipment, equipmentId, day]);

  const times = useMemo(() => {
    if (!availability) return [];
    const count = Math.floor(((RESERVATION_CLOSE_HOUR - RESERVATION_OPEN_HOUR) * 60) / availability.reservationUnitMinutes);
    return Array.from({ length: Math.max(0, count) }, (_, index) => timeLabel(RESERVATION_OPEN_HOUR * 60 + index * availability.reservationUnitMinutes));
  }, [availability]);
  const selectedUnit = availability?.units.find((unit) => unit.id === unitId);
  const reserved = useMemo(() => new Set(selectedUnit?.reservedStarts.map((value) => value.slice(11, 16)) ?? []), [selectedUnit]);

  function chooseEquipment(id: string) {
    setLoading(true); setMessage(""); setEquipmentId(id); setStartHour(""); setEndHour(""); setStage(2);
    window.setTimeout(() => scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }
  function chooseSlot(time: string, index: number) {
    if (!startHour || endHour) { setStartHour(time); setEndHour(""); return; }
    if (time <= startHour) { setStartHour(time); setEndHour(""); return; }
    const startIndex = times.indexOf(startHour);
    if (times.slice(startIndex, index + 1).some((item) => reserved.has(item))) { setMessage("예약된 시간대를 건너뛸 수 없습니다."); return; }
    setEndHour(times[index + 1] ?? timeLabel(RESERVATION_CLOSE_HOUR * 60)); setStage(3); setMessage("");
  }
  async function submit() {
    if (!unitId || !startHour || !endHour || purpose.trim().length < 3) { setMessage("예약할 시간 범위와 사용 목적을 모두 입력해 주세요."); return; }
    setLoading(true); setMessage("");
    const iso = (time: string) => new Date(`${day}T${time}:00+09:00`).toISOString();
    try {
      const response = await fetch(`${API_URL}/reservations`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ equipmentUnitId: unitId, startsAt: iso(startHour), endsAt: iso(endHour), purpose: purpose.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.detail ?? "예약을 신청하지 못했습니다."); return; }
      setStage(4); setMessage("예약 신청이 접수되었습니다. 운영진 승인 후 확정됩니다.");
    } catch { setMessage("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setLoading(false); }
  }
  if (equipment.length === 0) return <div className="empty-state"><h2>예약 가능한 장비가 없습니다</h2><p>운영진이 장비와 개별 사용 단위를 등록하면 예약할 수 있습니다.</p></div>;

  return <div className="booking-app">
    <ol className="reservation-steps" aria-label="장비 예약 진행 단계">{steps.map(([label, Icon], index) => <li className={stage === index + 1 ? "active" : stage > index + 1 ? "done" : ""} key={label}><span>{label}</span><Icon size={23} />{index < steps.length - 1 && <ChevronRight className="step-arrow" size={19} />}</li>)}</ol>
    <div className="booking-guidance"><strong>장비사용 예약 신청 순서</strong><p>장비 모델과 사용 날짜·시간을 선택한 후, 작업 목적을 작성해 예약을 신청합니다.</p><small><CircleAlert size={15} />승인된 예약만 달력과 시간표에서 다른 회원에게 표시됩니다.</small></div>
    <section className="booking-equipment" aria-labelledby="equipment-choice-title"><div className="booking-section-head"><p className="meta">01. EQUIPMENT</p><h3 id="equipment-choice-title">장비 선택</h3><span>예약할 장비와 개별 호기를 먼저 선택하세요.</span></div><div className="booking-equipment-grid">{equipment.map((item) => <button className={`booking-equipment-card${item.id === equipmentId ? " selected" : ""}${item.status !== "ACTIVE" ? " disabled" : ""}`} type="button" disabled={item.status !== "ACTIVE"} onClick={() => chooseEquipment(item.id)} key={item.id}>{item.imageUrl ? <Image src={media(item.imageUrl, 640)} alt="" width={640} height={360} unoptimized /> : <span className="booking-device-icon"><Wrench size={34} /></span>}<span className="booking-card-category">{item.category}</span><strong>{item.name}</strong><small>{item.availableUnits}개 호기 · {item.status === "ACTIVE" ? "예약 가능" : "점검 중"}</small></button>)}</div></section>
    <section className="booking-schedule-section" ref={scheduleRef} aria-labelledby="schedule-title"><div className="booking-section-head"><p className="meta">02. SCHEDULE</p><h3 id="schedule-title">일정 선택</h3><span>{selected ? `${selected.name}의 ${dateLabel(day)} 예약 현황` : "장비를 선택해 주세요."}</span></div><div className="booking-schedule-grid"><article className="booking-date-card"><h4>예약 날짜</h4><label><span>예약 가능 날짜</span><input type="date" min={localDay()} value={day} onChange={(event) => { setLoading(true); setMessage(""); setStartHour(""); setEndHour(""); setDay(event.target.value); }} /></label><p><CalendarDays size={16} />{dateLabel(day)}</p></article><article className="booking-time-card" aria-busy={loading}><h4>예약 시간</h4><div className="unit-switcher">{availability?.units.map((unit) => <button type="button" className={unit.id === unitId ? "active" : ""} onClick={() => { setUnitId(unit.id); setStartHour(""); setEndHour(""); }} key={unit.id}>{unit.label.replace(`${selected?.name} `, "NO.")}</button>)}</div><p className="slot-help">시작 시간과 종료 시간을 차례로 선택하세요. <i>회색은 이미 승인된 예약입니다.</i></p><div className="booking-slots">{times.map((time, index) => { const inRange = Boolean(startHour && endHour && time >= startHour && time < endHour); return <button type="button" disabled={reserved.has(time)} className={`${startHour === time ? "start" : ""}${inRange ? " range" : ""}`} onClick={() => chooseSlot(time, index)} key={time}>{time} - {times[index + 1] ?? timeLabel(RESERVATION_CLOSE_HOUR * 60)}</button>; })}</div>{!availability && <p className="form-note">{loading ? "예약 현황을 불러오는 중입니다." : "예약 현황이 없습니다."}</p>}</article></div></section>
    <section className="booking-request" aria-labelledby="request-title"><div className="booking-section-head"><p className="meta">03. REQUEST</p><h3 id="request-title">신청 정보</h3><span>신청자 정보는 로그인한 계정으로 자동 기록됩니다.</span></div><div className="booking-summary"><div><span>선택 장비</span><strong>{selected?.name ?? "장비를 선택해 주세요"}</strong></div><div><span>선택 일정</span><strong>{startHour && endHour ? `${dateLabel(day)} ${startHour}–${endHour}` : "시간을 선택해 주세요"}</strong></div><div><span>선택 호기</span><strong>{selectedUnit?.label ?? "호기를 선택해 주세요"}</strong></div></div><label className="booking-purpose"><span>사용 목적 및 작업 내용</span><textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={2000} placeholder="예: 휴머노이드 로봇 외장 부품 시제품 제작 / 사용 재료와 안전 유의사항" /></label><div className="booking-submit-row"><p>신청 후 운영진이 검토합니다. 승인 전에는 예약이 확정되지 않습니다.</p><button className="button" type="button" disabled={loading || stage === 4} onClick={submit}>{stage === 4 ? "신청 완료" : loading ? "확인 중" : "예약 신청"}</button></div></section>
    {message && <p className={`booking-message${stage === 4 ? " success" : ""}`} role="status">{message}</p>}
  </div>;
}
