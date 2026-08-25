"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronRight, CircleAlert, ClipboardPenLine, Lock, Wrench } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ScrollingName } from "@/components/scrolling-name";
import { API_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { media, mediaSquare, optimizable } from "@/lib/media";
import type { EquipmentAvailability, EquipmentItem, MemberPick } from "@/lib/types";

function localDay() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
const timeLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const dateLabel = (day: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${day}T12:00:00`));

const steps = [["장비 선택", Wrench], ["일정 선택", CalendarDays], ["신청 정보", ClipboardPenLine], ["예약 완료", Check]] as const;

/** 지금 이후 몇 분 뒤부터 신청을 받을지. 서버도 시작 시각이 현재보다 앞이면 거절한다. */
const LEAD_MINUTES = 5;

/**
 * `HH:MM` 칸이 이미 지났는지 본다.
 *
 * 예전에는 오늘도 00:00~23:00 스물네 칸을 모두 눌릴 수 있게 두었다. 화면에서는
 * 멀쩡해 보이는데 신청하면 서버가 "지난 시간은 예약할 수 없습니다" 로 거절해,
 * 왜 안 되는지 알 수 없었다. 고를 수 없는 칸은 처음부터 잠근다.
 */
function past(day: string, time: string): boolean {
  const at = new Date(`${day}T${time}:00+09:00`);
  return Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + LEAD_MINUTES * 60_000;
}

/** 하루를 예약 단위로 쪼갠 시작 시각 목록. 장비마다 단위가 달라 매번 새로 만든다. */
function slotLabels(unitMinutes: number): string[] {
  const count = Math.floor(((RESERVATION_CLOSE_HOUR - RESERVATION_OPEN_HOUR) * 60) / unitMinutes);
  return Array.from({ length: Math.max(0, count) }, (_, index) => timeLabel(RESERVATION_OPEN_HOUR * 60 + index * unitMinutes));
}

/** 마이페이지와 같은 정보를 예약 화면에서도 미리 보여 주기 위한 응답 형태. */
type EquipmentPermission = {
  equipmentId: string;
  missingLicenses: string[];
  licensed: boolean;
  eligible: boolean;
};
/** 예약 화면에서 지금 무엇을 할 수 있는지. `viewer` 는 보고만 갑니다. */
type Access = "checking" | "guest" | "viewer" | "member";
const RESERVATION_OPEN_HOUR = 0;
const RESERVATION_CLOSE_HOUR = 24;

export function EquipmentReservation({ equipment }: { equipment: EquipmentItem[] }) {
  const { session } = useSession();
  const search = useSearchParams();
  const scheduleRef = useRef<HTMLDivElement>(null);
  const equipmentRef = useRef<HTMLElement>(null);
  const requested = search.get("equipment");
  const [chosenId, setChosenId] = useState(requested ?? equipment.find((item) => item.status === "ACTIVE")?.id ?? "");
  const [day, setDay] = useState(localDay);
  const [availability, setAvailability] = useState<EquipmentAvailability | null>(null);
  const [unitId, setUnitId] = useState("");
  const [startHour, setStartHour] = useState("");
  const [endHour, setEndHour] = useState("");
  const [purpose, setPurpose] = useState("");
  // 장비 하나를 여럿이 함께 쓰는 경우. 이름이 남아야 사고나 파손이 있을 때
  // 물어볼 곳이 있고, 함께 오는 사람도 알림을 받습니다.
  const [companions, setCompanions] = useState<MemberPick[]>([]);
  const [people, setPeople] = useState<MemberPick[]>([]);
  const [mateQuery, setMateQuery] = useState("");
  const [stage, setStage] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(equipment.length));
  const [permissions, setPermissions] = useState<Record<string, EquipmentPermission>>({});
  // 이번에 앉은 자리에서 신청한 예약들. 실험 하나에 로봇 팔과 GPU 를 함께 쓰는 일이
  // 흔한데, 예전에는 한 건을 넣고 나면 버튼이 잠겨 새로고침을 해야 다음 장비를
  // 신청할 수 있었다. 무엇을 이미 넣었는지 보여 주고 곧바로 다음 장비로 넘어간다.
  const [booked, setBooked] = useState<{ id: string; name: string; unit: string; span: string }[]>([]);
  // 로그인 여부는 머리글이 이미 읽어 둔 세션에서 그대로 읽습니다.
  const access: Access =
    session === undefined ? "checking"
    : session?.status === "APPROVED" ? "member"
    : session?.status === "VIEWER" ? "viewer"
    : "guest";
  // 기본 선택이 하필 교육 미이수 장비이면 신청 정보 요약이 처음부터 막힌 장비를
  // 가리킨다. 링크로 직접 지정해 온 경우가 아니면 신청 가능한 장비를 보여 준다.
  const lockedByDefault = Boolean(!requested && permissions[chosenId] && !permissions[chosenId].eligible);
  const equipmentId =
    (lockedByDefault ? equipment.find((item) => permissions[item.id]?.eligible)?.id : undefined) ?? chosenId;
  const selected = equipment.find((item) => item.id === equipmentId);

  // 신청 버튼을 누르고 나서야 "필수 라이선스가 없습니다"를 만나면 앞의 세 단계가
  // 모두 헛수고가 된다. 마이페이지와 같은 자격 정보를 미리 읽어 카드에 표시한다.
  // 세션은 머리글이 이미 한 번 읽어 두므로 여기서 다시 요청하지 않고, 로그인하지
  // 않은 방문자에게는 아예 물어보지 않는다.
  useEffect(() => {
    if (access !== "member") return;
    const controller = new AbortController();
    fetch(`${API_URL}/equipment-permissions`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const rows = (await response.json()) as EquipmentPermission[];
        setPermissions(Object.fromEntries(rows.map((row) => [row.equipmentId, row])));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [access]);

  // 함께 쓸 사람을 고르려면 회원 목록이 필요합니다. 로그인한 회원에게만 옵니다.
  useEffect(() => {
    if (access !== "member") return;
    const controller = new AbortController();
    fetch(`${API_URL}/members/directory`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (response.ok) setPeople((await response.json()) as MemberPick[]); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [access]);

  /** 아직 고르지 않은 부원. 검색어가 있으면 이름으로 좁힙니다. */
  const pickableMates = useMemo(() => {
    const keyword = mateQuery.trim().toLowerCase();
    return people
      .filter((person) => !companions.some((mate) => mate.id === person.id))
      .filter((person) => !keyword || person.name.toLowerCase().includes(keyword));
  }, [people, companions, mateQuery]);

  /** 이 장비를 지금 신청할 수 있는지와, 안 되는 이유 한 줄. */
  function eligibility(item: EquipmentItem) {
    if (item.status !== "ACTIVE") return { ok: false, reason: item.status === "MAINTENANCE" ? "점검 중" : "예약 불가" };
    const permission = permissions[item.id];
    if (!permission) return { ok: true, reason: "" };
    if (permission.eligible) return { ok: true, reason: "" };
    return { ok: false, reason: `교육 필요: ${permission.missingLicenses.join(", ")}` };
  }

  useEffect(() => {
    if (!equipmentId || !day) return;
    const controller = new AbortController();
    fetch(`${API_URL}/equipment/${equipmentId}/availability?date=${encodeURIComponent(day)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as EquipmentAvailability;
        setAvailability(data);
        const unit = data.units[0];
        setUnitId(unit?.id ?? "");
        // 앞 장비에서 들고 온 시간이 이 장비에서도 쓸 수 있는지 여기서 본다.
        // 예약 단위가 다르거나(60분 대 120분) 그 시간이 이미 확정되어 있으면
        // 지우고 다시 고르게 한다.
        if (!startHour || !endHour) return;
        const grid = slotLabels(data.reservationUnitMinutes);
        const taken = new Set(unit?.reservedStarts.map((value) => value.slice(11, 16)) ?? []);
        const from = grid.indexOf(startHour);
        const to = grid.indexOf(endHour);
        const range = grid.slice(from, to === -1 ? grid.length : to);
        if (from === -1 || range.length === 0 || range.some((time) => taken.has(time))) {
          setStartHour(""); setEndHour(""); setStage(2);
          setMessage("이 장비는 그 시간을 쓸 수 없습니다. 시간을 다시 선택해 주세요.");
        }
      })
      .catch((error: Error) => { if (error.name !== "AbortError") { setAvailability(null); setMessage("예약 현황을 불러오지 못했습니다."); } })
      // 예전에는 취소된 요청이면 loading 을 내리지 않았다. 마지막 요청이 취소되면
      // 단추가 "확인 중" 으로 영구히 잠겼다(브라우저 확인에서 실제로 걸렸다).
      // 새 요청은 어차피 스스로 loading 을 다시 올리므로 언제나 내려도 안전하다.
      .finally(() => setLoading(false));
    return () => controller.abort();
    // 시간표는 장비와 날짜가 바뀔 때만 다시 받는다. 고른 시각(startHour·endHour)을
    // 여기 넣으면 시간을 누를 때마다 API 를 다시 부른다. 이 효과가 도는 시점에는
    // 이미 새 화면이 그려진 뒤라 두 값 모두 최신이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, equipmentId, day]);

  const times = useMemo(() => (availability ? slotLabels(availability.reservationUnitMinutes) : []), [availability]);
  const selectedUnit = availability?.units.find((unit) => unit.id === unitId);
  const reserved = useMemo(() => new Set(selectedUnit?.reservedStarts.map((value) => value.slice(11, 16)) ?? []), [selectedUnit]);


  function chooseEquipment(id: string) {
    // 이어서 신청하는 중이면 앞서 고른 시간을 들고 간다. 그 시간이 새 장비의
    // 시간표에 없으면 아래 검사가 지우고 다시 고르라고 알려 준다.
    const keepTime = booked.length > 0 && Boolean(startHour && endHour);
    setLoading(true); setMessage(""); setChosenId(id);
    if (!keepTime) { setStartHour(""); setEndHour(""); }
    setStage(2);
    window.setTimeout(() => scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }
  /** 그 칸의 끝 시각. 마지막 칸은 자정으로 닫는다. */
  const endOf = (index: number) => times[index + 1] ?? timeLabel(RESERVATION_CLOSE_HOUR * 60);

  /**
   * 한 번 누르면 그 한 칸이 잡히고, 뒤쪽 칸을 다시 누르면 거기까지 늘어난다.
   *
   * 예전에는 첫 번째 누름이 시작만 정하고 끝은 비워 두어서, 한 시간만 쓰려면
   * 두 칸을 눌러야 했고 그러면 두 시간이 잡혔다. 무엇이 잡혔는지도 보이지 않았다.
   */
  function chooseSlot(time: string, index: number) {
    if (past(day, time)) { setMessage("이미 지난 시간은 예약할 수 없습니다."); return; }
    const startIndex = times.indexOf(startHour);
    // 아직 아무것도 없거나, 시작보다 앞을 누르면 그 칸 하나로 다시 시작한다.
    if (!startHour || time <= startHour) {
      setStartHour(time); setEndHour(endOf(index)); setStage(3); setMessage("");
      return;
    }
    if (times.slice(startIndex, index + 1).some((item) => reserved.has(item))) {
      setMessage("예약된 시간대를 건너뛸 수 없습니다.");
      return;
    }
    setEndHour(endOf(index)); setStage(3); setMessage("");
  }
  async function submit() {
    if (access === "viewer") { setMessage("보기 전용 계정이라 예약을 신청할 수 없습니다. 예약 현황은 그대로 보실 수 있습니다."); return; }
    if (access === "guest") { setMessage("로그인 후 승인된 회원만 예약을 신청할 수 있습니다."); return; }
    if (selected) {
      const { ok, reason } = eligibility(selected);
      if (!ok) { setMessage(`${selected.name}은(는) 지금 신청할 수 없습니다. ${reason}`); return; }
    }
    if (!unitId || !startHour || !endHour || purpose.trim().length < 3) { setMessage("예약할 시간 범위와 사용 목적을 모두 입력해 주세요."); return; }
    setLoading(true); setMessage("");
    const iso = (time: string) => new Date(`${day}T${time}:00+09:00`).toISOString();
    try {
      const response = await fetch(`${API_URL}/reservations`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ equipmentUnitId: unitId, startsAt: iso(startHour), endsAt: iso(endHour), purpose: purpose.trim(), companionIds: companions.map((mate) => mate.id) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.detail ?? "예약을 신청하지 못했습니다."); return; }
      setBooked((current) => [...current, {
        id: String(data.id ?? unitId),
        name: selected?.name ?? "",
        unit: selectedUnit?.label ?? "",
        span: `${dateLabel(day)} ${startHour}–${endHour}`,
      }]);
      setStage(4); setMessage("예약 신청이 접수되었습니다. 운영진 승인 후 확정됩니다.");
    } catch { setMessage("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setLoading(false); }
  }
  /**
   * 방금 고른 날짜·시간·목적을 그대로 두고 장비 선택으로 돌아간다.
   * 겹침을 막는 기준은 사람이 아니라 호기이므로, 다른 장비라면 같은 시간에
   * 그대로 신청할 수 있다.
   */
  function bookAnother() {
    setChosenId("");
    setUnitId("");
    setAvailability(null);
    setStage(1);
    setMessage("");
    window.setTimeout(() => equipmentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  if (equipment.length === 0) return <div className="empty-state"><h2>예약 가능한 장비가 없습니다</h2><p>운영진이 장비와 개별 사용 단위를 등록하면 예약할 수 있습니다.</p></div>;

  return <div className="booking-app">
    <ol className="reservation-steps" aria-label="장비 예약 진행 단계">{steps.map(([label, Icon], index) => <li className={stage === index + 1 ? "active" : stage > index + 1 ? "done" : ""} key={label}><span>{label}</span><Icon size={23} />{index < steps.length - 1 && <ChevronRight className="step-arrow" size={19} />}</li>)}</ol>
    <div className="booking-guidance"><strong>장비사용 예약 신청 순서</strong><p>장비 모델과 사용 날짜·시간을 선택한 후, 작업 목적을 작성해 예약을 신청합니다.</p><small><CircleAlert size={15} />승인된 예약만 달력과 시간표에서 다른 회원에게 표시됩니다.</small></div>
    {access === "guest" && <p className="booking-signin" role="status"><Lock size={15} />예약 신청은 승인된 회원만 할 수 있습니다. 예약 가능 시간은 로그인 없이도 확인할 수 있습니다. <Link href="/login">로그인하기</Link></p>}
    {access === "viewer" && <p className="booking-signin" role="status"><Lock size={15} />보기 전용 계정입니다. 예약 현황은 확인하실 수 있지만 신청은 활동 중인 회원만 할 수 있습니다.</p>}
    <section className="booking-equipment" ref={equipmentRef} aria-labelledby="equipment-choice-title"><div className="booking-section-head"><p className="meta">01. EQUIPMENT</p><h3 id="equipment-choice-title">장비 선택</h3><span>예약할 장비와 개별 호기를 먼저 선택하세요.</span></div><div className="booking-equipment-grid">{equipment.map((item) => { const { ok, reason } = eligibility(item); return <button className={`booking-equipment-card${item.id === equipmentId ? " selected" : ""}${ok ? "" : " disabled"}`} type="button" disabled={!ok} onClick={() => chooseEquipment(item.id)} key={item.id}>{item.imageUrl ? <Image src={mediaSquare(item.imageUrl, 800)} sizes="(max-width: 900px) 45vw, 340px" quality={88} alt="" width={640} height={360} unoptimized={!optimizable(item.imageUrl)} /> : <span className="booking-device-icon"><Wrench size={34} /></span>}<span className="booking-card-category">{item.category}</span><strong>{item.name}</strong><small>{item.availableUnits}개 호기 · {ok ? "예약 가능" : reason}</small>{!ok && reason.startsWith("교육 필요") && <span className="booking-card-lock"><Lock size={13} /> 교육 이수 후 신청할 수 있습니다</span>}</button>; })}</div></section>
    <section className="booking-schedule-section" ref={scheduleRef} aria-labelledby="schedule-title"><div className="booking-section-head"><p className="meta">02. SCHEDULE</p><h3 id="schedule-title">일정 선택</h3><span>{selected ? `${selected.name}의 ${dateLabel(day)} 예약 현황` : "장비를 선택해 주세요."}</span></div><div className="booking-schedule-grid"><article className="booking-date-card"><h4>예약 날짜</h4><label><span>예약 가능 날짜</span><input type="date" min={localDay()} value={day} onChange={(event) => { setLoading(true); setMessage(""); setStartHour(""); setEndHour(""); setDay(event.target.value); }}  /></label><p><CalendarDays size={16} />{dateLabel(day)}</p></article><article className="booking-time-card" aria-busy={loading}><h4>예약 시간</h4><div className="unit-switcher">{availability?.units.map((unit) => <button type="button" className={unit.id === unitId ? "active" : ""} onClick={() => { setUnitId(unit.id); setStartHour(""); setEndHour(""); }} key={unit.id}>{unit.label.replace(`${selected?.name} `, "NO.")}</button>)}</div><p className="slot-help">한 칸을 누르면 그 시간이 잡히고, 뒤쪽 칸을 다시 누르면 거기까지 늘어납니다. <i>회색은 이미 승인된 예약이거나 지난 시간입니다.</i></p><div className="booking-slots">{times.map((time, index) => { const inRange = Boolean(startHour && endHour && time >= startHour && time < endHour); const gone = past(day, time); return <button type="button" disabled={reserved.has(time) || gone} title={gone ? "이미 지난 시간입니다" : undefined} className={`${startHour === time ? "start" : ""}${inRange ? " range" : ""}${gone ? " gone" : ""}`} onClick={() => chooseSlot(time, index)} key={time}>{time} - {endOf(index)}</button>; })}</div>{!availability && <p className="form-note">{loading ? "예약 현황을 불러오는 중입니다." : "예약 현황이 없습니다."}</p>}</article></div></section>
    <section className="booking-request" aria-labelledby="request-title"><div className="booking-section-head"><p className="meta">03. REQUEST</p><h3 id="request-title">신청 정보</h3><span>신청자 정보는 로그인한 계정으로 자동 기록됩니다.</span></div><div className="booking-summary"><div><span>선택 장비</span><strong>{selected?.name ?? "장비를 선택해 주세요"}</strong></div><div><span>선택 일정</span><strong>{startHour && endHour ? `${dateLabel(day)} ${startHour}–${endHour}` : "시간을 선택해 주세요"}</strong></div><div><span>선택 호기</span><strong>{selectedUnit?.label ?? "호기를 선택해 주세요"}</strong></div></div>
      {/* 이 장비는 확정되면 동아리가 함께 쓰는 구글 캘린더에도 올라갑니다. 그
          캘린더는 SHAPE 만 보는 곳이 아니라 장비를 같이 쓰는 다른 분들도 보므로,
          신청하기 전에 알고 있어야 합니다. 어떤 장비가 그런지는 서버가 알려
          줍니다(`sharedCalendar`) — 화면에 장비 이름을 적어 두면 서버 쪽만
          바뀌었을 때 안내가 거짓말을 합니다. */}
      {selected?.sharedCalendar && (
        <p className="booking-calendar-note">
          <CalendarDays size={16} aria-hidden="true" />
          <span>
            <strong>운영진이 확정하면 동아리 공유 캘린더 ‘휴머노이드 운용’ 에 일정이 자동으로 올라갑니다.</strong>
            {" "}제목은 <i>SHAPE: 이름 {selected.name.toUpperCase()} 시간</i> 모양이고, 예약을 취소하면 그 일정도 함께 지워집니다.
            대기 중인 신청은 올라가지 않습니다.
          </span>
        </p>
      )}
      <label className="booking-purpose"><span>사용 목적 및 작업 내용</span><textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={2000} placeholder="예: 휴머노이드 로봇 외장 부품 시제품 제작 / 사용 재료와 안전 유의사항" /></label>
      {/* 장비 하나를 여럿이 함께 쓰는 경우. 이름이 남아야 사고나 파손이 있을 때
          물어볼 곳이 있고, 함께 오는 사람도 알림을 받습니다. */}
      <div className="booking-companions">
        <span className="booking-field-label">함께 쓰는 부원 <i>(선택)</i></span>
        {companions.length > 0 && (
          <ul className="companion-chips">
            {companions.map((mate) => (
              <li key={mate.id}>
                {mate.imageUrl
                  ? <Image src={media(mate.imageUrl, 72, "eco")} alt="" width={22} height={22} unoptimized={!optimizable(mate.imageUrl)} />
                  : <span className="pick-face" aria-hidden="true">{mate.name.slice(0, 1)}</span>}
                <ScrollingName name={mate.name} className="chip-name" />
                <button type="button" aria-label={`${mate.name} 빼기`} onClick={() => setCompanions((current) => current.filter((row) => row.id !== mate.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <input
          type="search"
          value={mateQuery}
          placeholder="이름으로 부원 찾기"
          disabled={access !== "member"}
          onChange={(event) => setMateQuery(event.target.value)}
        />
        {/*
          부원 목록을 늘 펼쳐 둡니다. 예전에는 글자를 쳐야 후보가 나와서, 누구를
          넣을 수 있는지 자체가 보이지 않았습니다. 서너 명 높이만 두고 안에서
          굴러가게 해, 자리를 많이 먹지 않으면서도 고를 수 있다는 것이 보입니다.
          사진은 SHAPE 프로필(마이페이지에서 정한 사진)을 씁니다.
        */}
        <ul className="companion-picker">
          {pickableMates.length === 0 ? (
            <li className="companion-empty">{mateQuery.trim() ? "찾는 이름이 없습니다." : "고를 수 있는 부원이 없습니다."}</li>
          ) : (
            pickableMates.map((person) => (
              <li key={person.id}>
                <button type="button" onClick={() => { setCompanions((current) => [...current, person]); setMateQuery(""); }}>
                  {person.imageUrl
                    ? <Image src={media(person.imageUrl, 96, "eco")} alt="" width={32} height={32} unoptimized={!optimizable(person.imageUrl)} />
                    : <span className="pick-face" aria-hidden="true">{person.name.slice(0, 1)}</span>}
                  <span>{person.name}</span>
                  <i aria-hidden="true">+</i>
                </button>
              </li>
            ))
          )}
        </ul>
        <small className="field-hint">
          함께 장비를 쓰는 부원을 넣어 주세요. 넣은 사람에게도 알림이 갑니다.
          <b> 신청자 본인은 넣지 않아도 됩니다.</b> 필수 교육은 신청자에게만 따집니다.
        </small>
      </div><div className="booking-submit-row"><p>신청 후 운영진이 검토합니다. 승인 전에는 예약이 확정되지 않습니다. 여러 장비를 같은 시간에 함께 쓸 수 있습니다.</p><div className="booking-submit-buttons">{stage === 4 && <button className="button ghost" type="button" onClick={bookAnother}>같은 시간으로 다른 장비 신청</button>}<button className="button" type="button" disabled={loading || stage === 4} onClick={submit}>{stage === 4 ? "신청 완료" : loading ? "확인 중" : "예약 신청"}</button></div></div>{booked.length > 0 && <div className="booking-basket" role="status"><strong>이번에 신청한 예약 {booked.length}건</strong><ul>{booked.map((row, index) => <li key={`${row.id}-${index}`}><b>{row.unit || row.name}</b><span>{row.span}</span></li>)}</ul><Link href="/mypage">마이페이지에서 확인</Link></div>}</section>
    {message && <p className={`booking-message${stage === 4 ? " success" : ""}`} role="status">{message}</p>}
  </div>;
}
