"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronRight, CircleAlert, ClipboardPenLine, Lock, ShieldAlert, Users, Wrench } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ASK_ALT, useAsk } from "@/components/ask-dialog";
import { BookingGuide } from "@/components/booking-guide";
import { BookingRequestFields } from "@/components/booking-request-fields";
import { BookingSlotGrid } from "@/components/booking-slot-grid";
import { BookingWeekStrip } from "@/components/booking-week-strip";
import { ScrollingName } from "@/components/scrolling-name";
import { API_URL } from "@/lib/api";
import {
  RESERVATION_CLOSE_HOUR,
  at,
  confirmLabel,
  confirmOutlook,
  iso,
  localDay,
  pendingCounts,
  purposeLabel,
  slotLabels,
  slotState,
  timeLabel,
  urgencyLabel,
} from "@/lib/booking";
import { loadPolicy } from "@/lib/policy";
import { useSession } from "@/lib/session";
import { media, mediaSquare, optimizable } from "@/lib/media";
import type {
  EquipmentAvailability,
  EquipmentItem,
  MemberPick,
  PublicReservationPolicy,
  ReservationPurpose,
  ReservationUrgency,
} from "@/lib/types";

const dateLabel = (day: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${day}T12:00:00`));

const steps = [["장비 선택", Wrench], ["일정 선택", CalendarDays], ["신청 정보", ClipboardPenLine], ["예약 완료", Check]] as const;

/** 마이페이지와 같은 정보를 예약 화면에서도 미리 보여 주기 위한 응답 형태. */
type EquipmentPermission = {
  equipmentId: string;
  missingLicenses: string[];
  licensed: boolean;
  eligible: boolean;
};
/**
 * 예약 화면에서 지금 무엇을 할 수 있는지.
 *
 * `pending` 을 `guest` 와 나누는 이유: 두 사람에게 해 줄 말이 다릅니다. 로그인
 * 안 한 사람에게는 "로그인하세요" 가 맞지만, 이미 로그인하고 승인을 기다리는
 * 사람에게 같은 말을 하면 이미 한 일을 또 하라는 뜻이 됩니다.
 */
type Access = "checking" | "guest" | "pending" | "viewer" | "member";

export function EquipmentReservation({ equipment }: { equipment: EquipmentItem[] }) {
  const { session } = useSession();
  const search = useSearchParams();
  const router = useRouter();
  const { ask, dialogNode } = useAsk();
  const scheduleRef = useRef<HTMLDivElement>(null);
  const equipmentRef = useRef<HTMLElement>(null);
  const requestRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const requested = search.get("equipment");
  const [chosenId, setChosenId] = useState(requested ?? equipment.find((item) => item.status === "ACTIVE")?.id ?? "");
  const [today, setToday] = useState(localDay);
  // 시계는 그릴 때마다 읽지 않고 여기 담아 둔다. 렌더마다 값이 달라지면 안 되고,
  // 화면을 켜 둔 채로 두어도 지나간 칸이 스스로 잠겨야 한다.
  const [now, setNow] = useState(0);
  const [day, setDay] = useState(localDay);
  const [availability, setAvailability] = useState<EquipmentAvailability | null>(null);
  // 예약 규칙 값. 안내를 '한 시간' 이 아니라 **정확한 시각**으로 적기 위해 읽습니다.
  // 공개 창구라 로그인 없이도 옵니다(캐시를 그대로 탑니다).
  const [policy, setPolicy] = useState<PublicReservationPolicy | null>(null);
  const [unitId, setUnitId] = useState("");
  const [startHour, setStartHour] = useState("");
  const [endHour, setEndHour] = useState("");
  const [purposeCategory, setPurposeCategory] = useState<ReservationPurpose | "">("");
  const [urgency, setUrgency] = useState<ReservationUrgency>("NORMAL");
  const [note, setNote] = useState("");
  // 장비 하나를 여럿이 함께 쓰는 경우. 이름이 남아야 사고나 파손이 있을 때
  // 물어볼 곳이 있고, 함께 오는 사람도 알림을 받습니다.
  const [companions, setCompanions] = useState<MemberPick[]>([]);
  const [people, setPeople] = useState<MemberPick[]>([]);
  const [mateQuery, setMateQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(equipment.length));
  const [permissions, setPermissions] = useState<Record<string, EquipmentPermission>>({});
  // 이번에 앉은 자리에서 신청한 예약들. 실험 하나에 로봇 팔과 GPU 를 함께 쓰는 일이
  // 흔한데, 예전에는 한 건을 넣고 나면 버튼이 잠겨 새로고침을 해야 다음 장비를
  // 신청할 수 있었다. 무엇을 이미 넣었는지 보여 주고 곧바로 다음 장비로 넘어간다.
  const [booked, setBooked] = useState<{ id: string; name: string; unit: string; span: string; auto: boolean }[]>([]);
  // 로그인 여부는 머리글이 이미 읽어 둔 세션에서 그대로 읽습니다.
  const access: Access =
    session === undefined ? "checking"
    : !session ? "guest"
    : session.status === "APPROVED" ? "member"
    : session.status === "VIEWER" ? "viewer"
    : session.status === "PENDING" ? "pending"
    : "guest";
  // 기본 선택이 하필 교육 미이수 장비이면 신청 정보 요약이 처음부터 막힌 장비를
  // 가리킨다. 링크로 직접 지정해 온 경우가 아니면 신청 가능한 장비를 보여 준다.
  const lockedByDefault = Boolean(!requested && permissions[chosenId] && !permissions[chosenId].eligible);
  const equipmentId =
    (lockedByDefault ? equipment.find((item) => permissions[item.id]?.eligible)?.id : undefined) ?? chosenId;
  const selected = equipment.find((item) => item.id === equipmentId);

  // 자정을 넘겨 화면을 켜 둔 채로 두면 '오늘' 이 어제로 남는다. 날짜 띠의 오늘
  // 표시와 날짜 입력의 하한이 함께 어긋난다.
  useEffect(() => {
    const tick = () => { setToday(localDay()); setNow(Date.now()); };
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 신청 버튼을 누르고 나서야 "필수 라이선스가 없습니다"를 만나면 앞의 세 단계가
  // 모두 헛수고가 된다. 마이페이지와 같은 자격 정보를 미리 읽어 카드에 표시한다.
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

  // 규칙 값은 누구에게나 같으므로 로그인 여부와 상관없이 한 번만 읽습니다.
  // `lib/policy.ts` 가 진행 중인 요청 하나를 나눠 주므로, 떠 있는 '사진 올리기'
  // 띠와 이 화면이 같은 응답을 두 번 받지 않습니다.
  useEffect(() => {
    let alive = true;
    void loadPolicy().then((value) => { if (alive) setPolicy(value); });
    return () => { alive = false; };
  }, []);

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
  const eligibility = useCallback((item: EquipmentItem) => {
    if (item.status !== "ACTIVE") return { ok: false, reason: item.status === "MAINTENANCE" ? "점검 중" : "예약 불가" };
    const permission = permissions[item.id];
    if (!permission) return { ok: true, reason: "" };
    if (permission.eligible) return { ok: true, reason: "" };
    return { ok: false, reason: `교육 필요: ${permission.missingLicenses.join(", ")}` };
  }, [permissions]);

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
        // 지우고 다시 고르게 한다. 대기 중인 신청은 지우지 않는다 — 같은 시간에
        // 함께 신청하는 것은 막지 않기 때문이다.
        if (!startHour || !endHour) return;
        const grid = slotLabels(data.reservationUnitMinutes);
        const taken = new Set(unit?.reservedStarts.map((value) => value.slice(11, 16)) ?? []);
        const from = grid.indexOf(startHour);
        const to = grid.indexOf(endHour);
        const range = grid.slice(from, to === -1 ? grid.length : to);
        if (from === -1 || range.length === 0 || range.some((time) => taken.has(time))) {
          setStartHour(""); setEndHour("");
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
  const pending = useMemo(() => pendingCounts(selectedUnit?.pendingStarts), [selectedUnit]);
  // 운영진이 막아 둔 칸. 서버가 같은 규칙으로 신청을 거절하므로 두 쪽이 어긋나지 않습니다.
  const blocked = useMemo(
    () => new Set(selectedUnit?.blockedStarts?.map((value) => value.slice(11, 16)) ?? []),
    [selectedUnit],
  );

  /** 그 칸의 끝 시각. 마지막 칸은 자정으로 닫는다. */
  const endOf = useCallback((index: number) => times[index + 1] ?? timeLabel(RESERVATION_CLOSE_HOUR * 60), [times]);
  // 화면이 붙기 전(`now === 0`)에는 시계를 모른다. 그때 서버 시계로 그려 두면
  // 브라우저의 첫 그림과 달라져 하이드레이션이 어긋난다(실제로 어긋났다).
  // 시계를 모르는 동안에는 모든 칸을 '빈 시간' 으로 두고, 붙은 직후 30초 시계가
  // 돌면서 지난 칸과 지금 칸이 제자리를 찾는다.
  const stateOf = useCallback(
    (time: string, index: number) => slotState(day, time, endOf(index), reserved, pending, blocked, now),
    [day, endOf, reserved, pending, blocked, now],
  );

  /**
   * 신청할 수 있는 마지막 날짜. 서버가 거절할 날짜를 화면이 고를 수 있게 두지
   * 않는다 — 예전에는 180일이 코드에 박혀 있고 화면은 아무 날짜나 고를 수 있어서,
   * 신청서를 다 채우고 단추를 누른 뒤에야 422 를 만났다.
   */
  const lastDay = useMemo(() => {
    const days = policy?.bookingWindowDays ?? 180;
    const edge = new Date(`${today}T12:00:00`);
    if (Number.isNaN(edge.getTime())) return "";
    edge.setDate(edge.getDate() + days);
    return localDay(edge);
  }, [today, policy]);

  /** 그 날 걸려 있는 사용 제한의 사유. 왜 못 누르는지 화면이 말해 준다. */
  const blockedReasons = availability?.blockedReasons ?? [];
  /** 안내 문구에 적을 자동 확정 시점. 서버가 알려 준 값을 사람이 읽는 길이로 바꾼다. */
  const leadLabel = useMemo(() => {
    const minutes = policy?.autoApproveMinutes ?? 60;
    if (minutes <= 0) return "0분";
    if (minutes % 60 === 0) return `${minutes / 60}시간`;
    if (minutes > 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
    return `${minutes}분`;
  }, [policy]);

  /** 고른 구간에 걸려 있는 남의 대기 신청 수. 0 이면 다투는 사람이 없다. */
  const contested = useMemo(() => {
    if (!startHour || !endHour) return 0;
    return times
      .filter((time) => time >= startHour && time < endHour)
      .reduce((total, time) => total + (pending.get(time) ?? 0), 0);
  }, [times, startHour, endHour, pending]);

  /**
   * 지금 고른 시간이 어떻게 확정되는가. 화면이 붙기 전(`now === 0`)에는 시계를
   * 모르므로 아무 말도 하지 않는다 — 그때 그려 두면 서버의 첫 그림과 달라져
   * 하이드레이션이 어긋난다.
   */
  const outlook = useMemo(() => {
    // 신청할 수 없는 사람에게 "지금 신청하면 곧바로 확정됩니다" 를 보여 주면
    // 바로 아래의 "승인된 회원만 신청할 수 있습니다" 와 정면으로 어긋납니다.
    // 실제로 한 화면에 두 문장이 함께 떠 있었습니다.
    if (access !== "member") return null;
    if (!now || !startHour || !endHour) return null;
    const startsAt = at(day, startHour);
    if (Number.isNaN(startsAt)) return null;
    return confirmOutlook(startsAt, contested, policy?.autoApproveMinutes ?? 60, now);
  }, [access, now, day, startHour, endHour, contested, policy]);

  // 단계 표시는 상태를 따로 들지 않고 지금 고른 것에서 끌어낸다. 예전에는 여섯
  // 군데서 `setStage` 를 불렀는데, 한 군데만 빠뜨려도 화면과 실제가 어긋났다.
  const stage = submitted ? 4 : (startHour && endHour) ? 3 : equipmentId ? 2 : 1;

  function chooseEquipment(id: string) {
    // 이어서 신청하는 중이면 앞서 고른 시간을 들고 간다. 그 시간이 새 장비의
    // 시간표에 없으면 위 검사가 지우고 다시 고르라고 알려 준다.
    const keepTime = booked.length > 0 && Boolean(startHour && endHour);
    setLoading(true); setMessage(""); setChosenId(id);
    if (!keepTime) { setStartHour(""); setEndHour(""); }
    window.setTimeout(() => scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  /**
   * 한 번 누르면 그 한 칸이 잡히고, 뒤쪽 칸을 다시 누르면 거기까지 늘어난다.
   *
   * 예전에는 첫 번째 누름이 시작만 정하고 끝은 비워 두어서, 한 시간만 쓰려면
   * 두 칸을 눌러야 했고 그러면 두 시간이 잡혔다. 무엇이 잡혔는지도 보이지 않았다.
   */
  function chooseSlot(time: string, index: number) {
    const state = stateOf(time, index);
    if (!state.selectable) {
      setMessage(
        state.kind === "past" ? "이미 끝난 시간입니다."
        : state.kind === "blocked" ? "운영진이 막아 둔 시간입니다. 다른 시간을 골라 주세요."
        : "이미 확정된 예약이 있는 시간입니다.",
      );
      return;
    }
    const startIndex = times.indexOf(startHour);
    const cap = policy?.maxHours ?? 12;
    // 아직 아무것도 없거나, 시작보다 앞을 누르면 그 칸 하나로 다시 시작한다.
    if (!startHour || time <= startHour) {
      // 예약 단위가 상한보다 큰 장비도 있을 수 있다(단위 120분에 상한 1시간).
      // 그때는 한 칸만 눌러도 서버가 거절하므로, 화면이 먼저 말해 준다.
      if ((at(day, endOf(index)) - at(day, time)) / 3_600_000 > cap) {
        setMessage(`한 번에 최대 ${cap}시간까지 예약할 수 있습니다. 이 장비는 한 칸이 그보다 깁니다.`);
        return;
      }
      setStartHour(time); setEndHour(endOf(index)); setMessage("");
      return;
    }
    // 사이에 고를 수 없는 칸이 하나라도 있으면 건너뛸 수 없다. 남이 신청만 해 둔
    // 칸은 건너뛰는 것이 아니라 함께 신청하는 것이므로 여기서 막지 않는다.
    if (times.slice(startIndex, index + 1).some((item, offset) => !stateOf(item, startIndex + offset).selectable)) {
      setMessage("확정된 예약이나 막아 둔 시간, 지난 시간을 건너뛸 수 없습니다.");
      return;
    }
    // 서버와 같은 상한이다. 여기서 막지 않으면 열 칸을 고른 뒤에야 거절당한다.
    const hours = (at(day, endOf(index)) - at(day, startHour)) / 3_600_000;
    if (hours > cap) {
      setMessage(`한 번에 최대 ${cap}시간까지 예약할 수 있습니다.`);
      return;
    }
    setEndHour(endOf(index)); setMessage("");
  }

  /** 아직 채우지 못한 것. 제출 검사와 아래 체크리스트가 같은 목록을 씁니다. */
  const checklist = [
    { label: "장비와 호기", done: Boolean(unitId) },
    { label: "사용 날짜와 시간", done: Boolean(startHour && endHour) },
    { label: "사용 목적", done: Boolean(purposeCategory) },
  ];

  async function submit() {
    if (access === "viewer") { setMessage("보기 전용 계정이라 예약을 신청할 수 없습니다. 예약 현황은 그대로 보실 수 있습니다."); return; }
    if (access === "pending") { setMessage("가입 승인을 기다리는 중입니다. 승인되면 바로 신청할 수 있습니다."); return; }
    if (access === "guest") { setMessage("로그인 후 승인된 회원만 예약을 신청할 수 있습니다."); return; }
    if (selected) {
      const { ok, reason } = eligibility(selected);
      if (!ok) { setMessage(`${selected.name}은(는) 지금 신청할 수 없습니다. ${reason}`); return; }
    }
    const missing = checklist.find((item) => !item.done);
    if (missing) {
      setMessage(`${missing.label}을(를) 먼저 정해 주세요.`);
      if (missing.label === "사용 목적") requestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setLoading(true); setMessage("");
    let created: { id: string; auto: boolean } | null = null;
    try {
      const response = await fetch(`${API_URL}/reservations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          equipmentUnitId: unitId,
          startsAt: iso(day, startHour),
          endsAt: iso(day, endHour),
          purposeCategory,
          urgency,
          note: note.trim(),
          companionIds: companions.map((mate) => mate.id),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.detail ?? "예약을 신청하지 못했습니다."); return; }
      const auto = data.status === "APPROVED";
      created = { id: String(data.id ?? unitId), auto };
      setBooked((current) => [...current, {
        id: created!.id,
        name: selected?.name ?? "",
        unit: selectedUnit?.label ?? "",
        span: `${dateLabel(day)} ${startHour}–${endHour}`,
        auto,
      }]);
      setSubmitted(true);
      setMessage(auto
        ? "예약이 바로 확정되었습니다. 사용 전 사진을 올리고 시작해 주세요."
        : "예약 신청이 접수되었습니다. 운영진 승인 후 확정됩니다.");
    } catch { setMessage("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setLoading(false); }

    // 팝업은 `finally` 밖에서 기다린다. 안에서 기다리면 단추가 팝업이 닫힐
    // 때까지 "확인 중" 에 묶인다.
    if (!created) return;
    const answer = await ask({
      title: created.auto ? "예약이 확정되었습니다" : "예약을 신청했습니다",
      description: (
        <>
          <p className="ask-lead">사진 두 장을 잊지 마세요.</p>
          <p>
            <b>사용 전 사진을 올려야 사용이 시작되고, 사용 후 사진을 올려야 사용이 완료됩니다.</b>{" "}
            사진은 장비 상태를 남기는 유일한 기록이라, 빠지면 다음 사람이 이전 상태를 확인할 수 없습니다.
          </p>
          <ul>
            <li><b>마이페이지</b> — 내 예약 카드에서 바로 올립니다.</li>
            <li><b>장비 예약 현황</b> — 달력에서 내 예약을 누르면 뜨는 창에서도 올릴 수 있습니다.</li>
            <li>사용 시각이 되면 <b>화면 왼쪽 아래에 띠</b>가 떠서 그 자리에서 바로 갈 수 있습니다.</li>
          </ul>
          <p>사용을 일찍 마치면 사진을 올릴 때 <b>남은 시간을 반납</b>할 수 있습니다. 다른 부원이 그 시간을 바로 쓸 수 있습니다.</p>
        </>
      ),
      confirmLabel: "알겠습니다",
      altLabel: "마이페이지에서 확인",
      altTone: "plain",
      cancelLabel: "닫기",
    });
    // 취소(닫기·Esc·바깥 누름)에는 아무 동작도 걸지 않는다. 잘못 눌렀다고 방금
    // 채운 신청서가 날아가면 안 된다.
    if (answer === ASK_ALT) router.push("/mypage");
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
    setSubmitted(false);
    setMessage("");
    window.setTimeout(() => equipmentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  function goToStep(index: number) {
    const target = index === 1 ? equipmentRef : index === 2 ? scheduleRef : requestRef;
    target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (equipment.length === 0) return <div className="empty-state"><h2>예약 가능한 장비가 없습니다</h2><p>운영진이 장비와 개별 사용 단위를 등록하면 예약할 수 있습니다.</p></div>;

  const stepValue = [
    selected?.name ?? "고르는 중",
    startHour && endHour ? `${dateLabel(day)} ${startHour}–${endHour}` : "고르는 중",
    purposeCategory ? `${purposeLabel(purposeCategory)} · ${urgencyLabel(urgency)}` : "고르는 중",
    submitted ? "신청함" : "아직",
  ];

  return <div className="booking-app">
    <ol className="reservation-steps" aria-label="장비 예약 진행 단계">
      {steps.map(([label, Icon], index) => (
        <li className={stage === index + 1 ? "active" : stage > index + 1 ? "done" : ""} key={label}>
          <button type="button" onClick={() => goToStep(index + 1)} aria-current={stage === index + 1 ? "step" : undefined}>
            <span>{label}</span>
            <Icon size={23} aria-hidden="true" />
            <i className="step-state">{stepValue[index]}</i>
          </button>
          {index < steps.length - 1 && <ChevronRight className="step-arrow" size={19} aria-hidden="true" />}
        </li>
      ))}
    </ol>
    {/* **막히는 지점을 맨 위에서 말합니다.** 예전에는 이 줄이 안내 아래에
        묻혀 있어서, 신청할 수 없는 사람이 5,000px 을 스크롤하며 장비와 시간을
        고른 뒤에야 벽을 만났습니다. */}
    {access === "guest" && (
      <p className="booking-signin" role="status">
        <Lock size={15} aria-hidden="true" />
        <span><b>예약 신청은 로그인한 승인 회원만</b> 할 수 있습니다. 어느 시간이 비어 있는지는 지금도 보실 수 있습니다.</span>
        <Link className="button small" href="/login">로그인하기</Link>
      </p>
    )}
    {access === "pending" && (
      <p className="booking-signin" role="status">
        <Lock size={15} aria-hidden="true" />
        <span><b>가입 승인을 기다리는 중</b>이라 아직 신청할 수 없습니다. 승인되면 바로 이 화면에서 신청할 수 있습니다.</span>
        <Link className="button small" href="/mypage">가입 상태 보기</Link>
      </p>
    )}
    {access === "viewer" && (
      <p className="booking-signin" role="status">
        <Lock size={15} aria-hidden="true" />
        <span>보기 전용 계정입니다. 예약 현황은 확인하실 수 있지만 신청은 활동 중인 회원만 할 수 있습니다.</span>
      </p>
    )}

    <div className="booking-guidance">
      <strong>장비사용 예약 신청 순서</strong>
      <p>장비와 사용 날짜·시간을 고른 뒤, 사용 목적과 시급도를 골라 신청합니다.</p>
      {/* '한 시간' 을 화면에 박아 두면 운영진이 정책을 바꾼 뒤에도 안내가 옛말을
          한다. 서버가 알려 준 값(`policy`)을 그대로 적는다. */}
      <small><CircleAlert size={15} aria-hidden="true" />시작까지 {leadLabel} 안으로 남았고 같은 시간에 다른 신청이 없으면 <b>운영진을 기다리지 않고 바로 확정</b>됩니다.</small>
      {/* 예약할 수 있는 사람에게만 자동으로 띄웁니다. 예전에는 정책 값이
          왔는지만 보고 띄워서, **비로그인 방문자와 가입 대기자**가 자동
          확정·사진 두 장·조기 반납까지 여섯 장을 다 읽고 닫은 뒤에야
          "예약은 승인된 회원만" 이라는 줄을 만났습니다. 궁금한 사람은 아래
          '예약 안내 자세히 보기' 로 직접 열 수 있습니다. */}
      <BookingGuide
        policy={policy}
        sharedCalendar={equipment.some((item) => item.sharedCalendar)}
        autoOpen={access === "member"}
      />
    </div>
    <section className="booking-equipment" ref={equipmentRef} aria-labelledby="equipment-choice-title">
      <div className="booking-section-head"><p className="meta">01. EQUIPMENT</p><h3 id="equipment-choice-title">장비 선택</h3><span>예약할 장비와 개별 호기를 먼저 선택하세요.</span></div>
      <div className="booking-equipment-grid">{equipment.map((item) => { const { ok, reason } = eligibility(item); return <button className={`booking-equipment-card${item.id === equipmentId ? " selected" : ""}${ok ? "" : " disabled"}`} type="button" disabled={!ok} onClick={() => chooseEquipment(item.id)} key={item.id}>{item.imageUrl ? <Image src={mediaSquare(item.imageUrl, 800)} sizes="(max-width: 900px) 45vw, 340px" quality={88} alt="" width={640} height={360} unoptimized={!optimizable(item.imageUrl)} /> : <span className="booking-device-icon"><Wrench size={34} /></span>}<span className="booking-card-category">{item.category}</span><strong>{item.name}</strong><small>{item.availableUnits}개 호기 · {ok ? "예약 가능" : reason}</small>{!ok && reason.startsWith("교육 필요") && <span className="booking-card-lock"><Lock size={13} /> 교육 이수 후 신청할 수 있습니다</span>}</button>; })}</div>
    </section>

    <section className="booking-schedule-section" ref={scheduleRef} aria-labelledby="schedule-title">
      <div className="booking-section-head"><p className="meta">02. SCHEDULE</p><h3 id="schedule-title">일정 선택</h3><span>{selected ? `${selected.name}의 ${dateLabel(day)} 예약 현황` : "장비를 선택해 주세요."}</span></div>
      <BookingWeekStrip day={day} today={today} maxDay={lastDay} onPick={(next) => { setLoading(true); setMessage(""); setStartHour(""); setEndHour(""); setDay(next); }} />
      <div className="booking-schedule-grid">
        <article className="booking-date-card">
          <h4>예약 날짜</h4>
          <label><span>다른 날짜 고르기</span><input type="date" min={today} max={lastDay || undefined} value={day} onChange={(event) => { setLoading(true); setMessage(""); setStartHour(""); setEndHour(""); setDay(event.target.value); }} /></label>
          <p><CalendarDays size={16} aria-hidden="true" />{dateLabel(day)}</p>
        </article>
        <article className="booking-time-card" aria-busy={loading}>
          <h4>예약 시간</h4>
          <div className="unit-switcher">{availability?.units.map((unit) => <button type="button" className={unit.id === unitId ? "active" : ""} onClick={() => { setUnitId(unit.id); setStartHour(""); setEndHour(""); }} key={unit.id}>{unit.label.replace(`${selected?.name} `, "NO.")}</button>)}</div>
          <BookingSlotGrid times={times} endOf={endOf} stateOf={stateOf} startHour={startHour} endHour={endHour} onPick={chooseSlot} />
          {blockedReasons.length > 0 && (
            <p className="booking-blocked-note" role="status">
              <ShieldAlert size={16} aria-hidden="true" />
              <span>
                이 날에는 운영진이 막아 둔 시간이 있습니다 — <b>{blockedReasons.join(" · ")}</b>.
                ‘사용 제한’ 으로 표시된 칸은 신청할 수 없습니다.
              </span>
            </p>
          )}
          {/* 규칙을 설명하는 것만으로는 부족하다. 지금 고른 이 시간이 언제
              확정되는지를 **시각으로** 적어 준다. 겹쳤을 때는 아래 안내가 할 말을
              대신하므로 여기서는 비켜 준다. */}
          {outlook && contested === 0 && (
            <p className={`booking-outlook${outlook.kind === "immediate" ? " now" : ""}`} role="status">
              <Check size={16} aria-hidden="true" />
              <span>{confirmLabel(outlook)}</span>
            </p>
          )}
          {contested > 0 && (
            <p className="booking-contest-note" role="status">
              <Users size={16} aria-hidden="true" />
              <span>
                이 시간에 이미 <b>{contested}건</b>의 신청이 있습니다. 함께 신청할 수 있지만 운영진이 한 건만 확정합니다.
                <button type="button" className="text-button" onClick={() => { requestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); window.setTimeout(() => noteRef.current?.focus(), 400); }}>
                  왜 이 시간이어야 하는지 적기
                </button>
              </span>
            </p>
          )}
          {!availability && <p className="form-note">{loading ? "예약 현황을 불러오는 중입니다." : "예약 현황이 없습니다."}</p>}
        </article>
      </div>
    </section>

    <section className="booking-request" ref={requestRef} aria-labelledby="request-title">
      <div className="booking-section-head"><p className="meta">03. REQUEST</p><h3 id="request-title">신청 정보</h3><span>신청자 정보는 로그인한 계정으로 자동 기록됩니다.</span></div>
      <div className="booking-summary">
        <div><span>선택 장비</span><strong>{selected?.name ?? "장비를 선택해 주세요"}</strong></div>
        <div><span>선택 일정</span><strong>{startHour && endHour ? `${dateLabel(day)} ${startHour}–${endHour}` : "시간을 선택해 주세요"}</strong></div>
        <div><span>선택 호기</span><strong>{selectedUnit?.label ?? "호기를 선택해 주세요"}</strong></div>
      </div>
      <ul className="booking-summary-strip">
        <li>{purposeCategory ? purposeLabel(purposeCategory) : "목적 미정"}</li>
        <li data-level={urgency}>{urgencyLabel(urgency)}</li>
        {companions.length > 0 && <li>함께 쓰는 부원 {companions.length}명</li>}
        {contested > 0 && <li className="warn">같은 시간 신청 {contested}건</li>}
      </ul>
      {/* 이 장비는 확정되면 동아리가 함께 쓰는 구글 캘린더에도 올라갑니다. 그
          캘린더는 SHAPE 만 보는 곳이 아니라 장비를 같이 쓰는 다른 분들도 보므로,
          신청하기 전에 알고 있어야 합니다. 어떤 장비가 그런지는 서버가 알려
          줍니다(`sharedCalendar`) — 화면에 장비 이름을 적어 두면 서버 쪽만
          바뀌었을 때 안내가 거짓말을 합니다. */}
      {selected?.sharedCalendar && (
        <p className="booking-calendar-note">
          <CalendarDays size={16} aria-hidden="true" />
          <span>
            <strong>확정되면 동아리 공유 캘린더 ‘휴머노이드 운용’ 에 일정이 자동으로 올라갑니다.</strong>
            {" "}제목은 <i>SHAPE: 이름 {selected.name.toUpperCase()} 시간</i> 모양이고, 예약을 취소하면 그 일정도 함께 지워집니다.
            올라가는 것은 <b>분류까지</b>이고, 기타 내용은 올라가지 않습니다. 대기 중인 신청도 올라가지 않습니다.
          </span>
        </p>
      )}
      <BookingRequestFields
        purposeCategory={purposeCategory}
        urgency={urgency}
        note={note}
        disabled={access !== "member"}
        noteRef={noteRef}
        onPurposeChange={setPurposeCategory}
        onUrgencyChange={setUrgency}
        onNoteChange={setNote}
      />
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
      </div>
      <ul className="booking-checklist" aria-label="신청 전 확인">
        {checklist.map((item) => (
          <li key={item.label} className={item.done ? "done" : ""}>
            <Check size={14} aria-hidden="true" />{item.label}
          </li>
        ))}
      </ul>
      <div className="booking-submit-row">
        <p>같은 시간에 여러 장비를 함께 쓸 수 있습니다. 겹치는 신청이 있으면 운영진이 직접 한 건을 확정합니다.</p>
        <div className="booking-submit-buttons">
          {submitted && <button className="button ghost" type="button" onClick={bookAnother}>같은 시간으로 다른 장비 신청</button>}
          {/* 신청할 수 없는 사람에게는 잠급니다. 눌러야만 거절되는 단추는
              5,000px 을 스크롤해 온 사람에게 마지막에 한 번 더 헛수고를
              시킵니다. 왜 잠겼는지는 맨 위 줄이 이미 말하고 있습니다. */}
          <button
            className="button"
            type="button"
            disabled={loading || submitted || access !== "member"}
            title={access === "member" ? undefined : "신청은 승인된 회원만 할 수 있습니다."}
            onClick={submit}
          >
            {/* 왜 못 누르는지가 사람마다 다릅니다. 이미 로그인한 대기자에게
                "로그인이 필요합니다" 라고 하면 이미 한 일을 또 하라는 말이 됩니다. */}
            {submitted ? "신청 완료"
              : loading ? "확인 중"
              : access === "member" ? "예약 신청"
              : access === "pending" ? "가입 승인 뒤에 신청할 수 있습니다"
              : access === "viewer" ? "보기 전용 계정입니다"
              : "로그인해야 신청할 수 있습니다"}
          </button>
        </div>
      </div>
      {booked.length > 0 && <div className="booking-basket" role="status"><strong>이번에 신청한 예약 {booked.length}건</strong><ul>{booked.map((row, index) => <li key={`${row.id}-${index}`}><b>{row.unit || row.name}</b><span>{row.span}</span><i>{row.auto ? "확정" : "대기"}</i></li>)}</ul><Link href="/mypage">마이페이지에서 확인</Link></div>}
    </section>
    {message && <p className={`booking-message${submitted ? " success" : ""}`} role="status">{message}</p>}
    {dialogNode}
  </div>;
}
