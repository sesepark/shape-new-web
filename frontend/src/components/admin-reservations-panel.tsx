"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Clock3, Users } from "lucide-react";
import { useAsk } from "@/components/ask-dialog";
import { ScrollingName } from "@/components/scrolling-name";
import { useNotice } from "@/components/use-notice";
import { adminFetch, adminSend } from "@/lib/admin-api";
import { CLOCK_OPTIONS, purposeLabel, spanLabel, unitTitle, urgencyLabel } from "@/lib/booking";
import { conflictGroups, rejectionDraft, sortReservations, withoutConflicts } from "@/lib/reservation-triage";
import { media, optimizable } from "@/lib/media";
import type { AdminReservationItem } from "@/lib/types";

export const reservationStatusLabel: Record<string, string> = {
  PENDING: "승인 대기",
  APPROVED: "예약 확정",
  REJECTED: "반려",
  CANCELLED: "취소",
  IN_USE: "사용 중",
  COMPLETED: "사용 완료",
  EXPIRED: "기간 지남",
};

// 예약 시각은 어디서나 24시간제입니다(`lib/booking.ts` 의 `CLOCK_OPTIONS`).
const moment = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", ...CLOCK_OPTIONS });
const SORTS: [string, string][] = [
  ["start", "시작 시각순"],
  ["created", "신청순"],
  ["urgency", "시급도순"],
  ["priority", "추천순"],
];

/**
 * 예약 한 건. **반드시 이 파일의 맨 바깥에 둔다.**
 *
 * 패널 안에서 정의하면 그릴 때마다 새 컴포넌트 타입이 되어, React 가 카드와 그
 * 안의 사진·단추를 통째로 다시 붙인다. 목록을 다시 읽을 때마다 사진이 깜빡이고
 * 눌린 상태가 사라진다.
 */
function ReservationCard({
  row,
  group,
  sort,
  onDecide,
  onResolve,
  onCancel,
}: {
  row: AdminReservationItem;
  group?: AdminReservationItem[];
  sort: string;
  onDecide: (row: AdminReservationItem, approve: boolean) => void;
  onResolve: (group: AdminReservationItem[], winner: AdminReservationItem) => void;
  onCancel: (row: AdminReservationItem) => void;
}) {
  return (
    <article>
      <header>
        <div>
          <strong>{unitTitle(row.equipmentName, row.unitLabel)}</strong>
          <p><Clock3 size={14} aria-hidden="true" />{spanLabel(row.startsAt, row.endsAt)}</p>
        </div>
        <span className={`reservation-status ${row.status.toLowerCase()}`}>{reservationStatusLabel[row.status] ?? row.status}</span>
      </header>
      <ul className="reservation-tags">
        <li className="purpose-chip" data-kind={row.purposeCategory ?? "OTHER"}>{purposeLabel(row.purposeCategory)}</li>
        <li className="urgency-badge" data-level={row.urgency ?? "NORMAL"}>{urgencyLabel(row.urgency)}</li>
        {row.autoDecidedAt && <li className="auto-chip">자동 확정</li>}
        {row.recurrenceGroupId && <li className="auto-chip">정기 예약</li>}
        {sort === "priority" && row.priorityReasons && row.priorityReasons.length > 0 && (
          <li className="score-chip" title={row.priorityReasons.join(" · ")}>추천 {row.priority}점</li>
        )}
      </ul>
      {/* 겹쳤을 때 운영진이 실제로 읽어야 하는 곳입니다. 비어 있으면 아예
          자리를 차지하지 않게 두어, 적어 온 신청이 눈에 띄게 합니다. */}
      {row.note && <p className="reservation-note">{row.note}</p>}
      <p className="reservation-requester">
        <ScrollingName name={row.userName || "회원"} className="requester-name" />
        <i>{row.userEmail}</i>
        {row.companions && row.companions.length > 0 && (
          <b><Users size={13} aria-hidden="true" /> {row.companions.join(", ")}</b>
        )}
      </p>
      {row.rejectionReason && <p className="form-note">사유: {row.rejectionReason}</p>}
      {(row.beforePhotoUrl || row.afterPhotoUrl) && (
        <div className="reservation-photos">
          {row.beforePhotoUrl && (
            <figure>
              <Image src={media(row.beforePhotoUrl, 400)} alt="사용 전 사진" width={320} height={220} unoptimized={!optimizable(row.beforePhotoUrl)} />
              <figcaption>사용 전</figcaption>
            </figure>
          )}
          {row.afterPhotoUrl && (
            <figure>
              <Image src={media(row.afterPhotoUrl, 400)} alt="사용 후 사진" width={320} height={220} unoptimized={!optimizable(row.afterPhotoUrl)} />
              <figcaption>사용 후</figcaption>
            </figure>
          )}
        </div>
      )}
      <div className="inline-actions">
        {row.status === "PENDING" && (
          <>
            {group
              ? <button className="button small" type="button" onClick={() => onResolve(group, row)}>이 건 확정하고 나머지 반려</button>
              : <button className="button small" type="button" onClick={() => onDecide(row, true)}>확정</button>}
            <button className="button secondary small" type="button" onClick={() => onDecide(row, false)}>반려</button>
          </>
        )}
        {(row.status === "PENDING" || row.status === "APPROVED") && (
          <button className="text-button danger" type="button" onClick={() => onCancel(row)}>예약 취소</button>
        )}
      </div>
    </article>
  );
}

export function ReservationsPanel() {
  const { ask, dialogNode } = useAsk();
  const [rows, setRows] = useState<AdminReservationItem[] | null>(null);
  const [filter, setFilter] = useState("PENDING");
  const [sort, setSort] = useState("start");
  const { say, node: notice } = useNotice();

  const reload = useCallback(async () => {
    const query = new URLSearchParams({ sort });
    if (filter !== "ALL") query.set("status", filter);
    const response = await adminFetch(`/admin/reservations?${query}`).catch(() => null);
    if (!response) {
      say("백엔드 서버에 연결하지 못했습니다.", false);
      setRows([]);
      return;
    }
    if (!response.ok) {
      say("목록을 확인하려면 예약 관리 권한이 필요합니다.", false);
      setRows([]);
      return;
    }
    // 여기서 알림을 지우지 않습니다. 승인·반려 직후에도 목록을 다시 읽는데,
    // 그때 지워 버리면 "승인했습니다" 가 떴다가 곧바로 사라집니다.
    setRows((await response.json()) as AdminReservationItem[]);
  }, [filter, sort, say]);

  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);

  async function decide(row: AdminReservationItem, approve: boolean, draft?: string) {
    let reason: string | null = null;
    if (approve) {
      const confirmed = await ask({
        title: "이 예약을 확정할까요?",
        description: `${unitTitle(row.equipmentName, row.unitLabel)} · ${row.userName} 님의 신청입니다. 확정하면 그 시간이 다른 회원에게 확정 예약으로 표시됩니다.`,
        confirmLabel: "확정",
      });
      if (confirmed === null) return false;
    } else {
      reason = await ask({
        title: "예약을 반려합니다",
        description: `${row.userName} 님에게 그대로 전달되니, 다음에 어떻게 신청하면 되는지 함께 적어 주세요.`,
        confirmLabel: "반려",
        tone: "danger",
        field: {
          label: "반려 사유", multiline: true, required: true, defaultValue: draft ?? "",
          placeholder: "예: 같은 시간에 교육 트랙 실습이 예정되어 있습니다. 오후 시간대로 다시 신청해 주세요.",
        },
      });
      if (reason === null) return false;
    }
    const response = await adminSend(`/admin/reservations/${row.id}/decision`, "POST", { approve, reason });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "처리하지 못했습니다. 같은 시간에 확정된 예약이 있는지 확인해 주세요.", false);
      return false;
    }
    say(approve
      ? `${row.userName} 님의 ${row.equipmentName} 예약을 확정했습니다.`
      : `${row.userName} 님의 ${row.equipmentName} 예약을 반려했습니다.`);
    await reload();
    return true;
  }

  /**
   * 겹친 묶음에서 한 건을 확정하고 나머지를 한 번에 반려한다.
   *
   * 겹침은 결국 "누구를 고를 것인가" 하나의 결정인데, 예전에는 확정 한 번과
   * 반려 몇 번을 따로 눌러야 했고 그 사이에 반려 사유를 매번 새로 적어야 했다.
   * 사유는 무엇과 겹쳤는지까지 미리 채워 준다.
   */
  async function resolveGroup(group: AdminReservationItem[], winner: AdminReservationItem) {
    const losers = group.filter((row) => row.id !== winner.id);
    const confirmed = await ask({
      title: "이 신청을 확정하고 나머지를 반려할까요?",
      description: (
        <>
          <p><b>{winner.userName}</b> 님의 신청을 확정합니다.</p>
          <ul>
            {losers.map((row) => <li key={row.id}>{row.userName} 님의 신청은 반려됩니다.</li>)}
          </ul>
          <p>반려 사유는 미리 채워 드립니다. 다음 화면에서 고칠 수 있습니다.</p>
        </>
      ),
      confirmLabel: "확정하고 나머지 반려",
    });
    if (confirmed === null) return;
    if (!(await decide(winner, true))) return;
    for (const loser of losers) {
      // 한 건이라도 취소하면 거기서 멈춥니다. 남은 신청은 대기 상태로 남아
      // 다시 볼 수 있습니다.
      if (!(await decide(loser, false, rejectionDraft(winner, loser)))) return;
    }
  }

  async function cancel(row: AdminReservationItem) {
    const reason = await ask({
      title: "확정된 예약을 취소합니다",
      description: `${unitTitle(row.equipmentName, row.unitLabel)} · ${row.userName} 님의 예약입니다. 취소하면 그 시간이 다시 열립니다.`,
      confirmLabel: "예약 취소",
      tone: "danger",
      field: { label: "취소 사유", multiline: true, required: true, placeholder: "예: 장비 긴급 점검이 잡혀 사용이 어렵습니다." },
    });
    if (reason === null) return;
    const response = await adminSend(`/admin/reservations/${row.id}/cancel`, "POST", { approve: false, reason });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "취소하지 못했습니다.", false);
      return;
    }
    say("예약을 취소하고 시간을 다시 열었습니다.");
    await reload();
  }

  const groups = rows ? conflictGroups(rows) : [];
  const plain = rows ? sortReservations(withoutConflicts(rows), sort as "start") : [];

  return (
    <div className="admin-form">
      <p className="form-note">
        같은 시간에 다투는 신청이 없으면 <b>정해 둔 시각에 저절로 확정</b>됩니다. 운영진이 먼저 확정해도 되고,
        그냥 두어도 됩니다. <b>사람이 반드시 봐야 하는 것은 시간이 겹친 신청뿐</b>이라 맨 위에 따로 모아 둡니다.
        확정 시점과 상한은 <b>관리자 장비예약</b> 탭의 예약 정책에서 바꿉니다.
      </p>
      <p className="form-note">
        정기 예약과 사용 제한(정비·교육 실습으로 시간대를 막는 것)은 <b>관리자 장비예약</b> 탭으로 옮겼습니다.
      </p>
      {/* 승인 단추가 사이트 밖에도 무언가를 남긴다는 것을 운영진이 알아야 합니다.
          그 캘린더는 SHAPE 만 보는 곳이 아니라 장비를 함께 쓰는 다른 분들도 봅니다. */}
      <p className="form-note">
        <strong>AI Worker</strong> 예약은 확정되는 순간 동아리 공유 캘린더 ‘휴머노이드 운용’ 에도 일정이 올라가고,
        취소하면 그 일정이 지워집니다. 자동으로 확정된 예약도 같습니다. 반려한 예약은 올라간 적이 없습니다.
      </p>
      <div className="board-filter" aria-label="예약 상태 필터">
        {["PENDING", "APPROVED", "IN_USE", "COMPLETED", "EXPIRED", "ALL"].map((value) => (
          <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {value === "ALL" ? "전체" : reservationStatusLabel[value]}
          </button>
        ))}
      </div>
      <div className="board-filter" aria-label="정렬">
        {SORTS.map(([value, label]) => (
          <button type="button" key={value} className={sort === value ? "active" : ""} onClick={() => setSort(value)}>
            {label}
          </button>
        ))}
      </div>
      {notice}
      {rows === null ? (
        <p className="form-note">예약 목록을 불러오는 중입니다.</p>
      ) : rows.length ? (
        <>
          {groups.map((group) => (
            <section className="reservation-conflict-group" key={group[0].id}>
              <header className="reservation-conflict-head">
                <AlertTriangle size={16} aria-hidden="true" />
                <div>
                  <strong>같은 시간에 신청 {group.length}건</strong>
                  <span>
                    {unitTitle(group[0].equipmentName, group[0].unitLabel)} · {moment.format(new Date(group[0].startsAt))} 무렵.
                    겹치는 동안에는 자동으로 확정되지 않습니다. 한 건을 고르면 나머지는 사유와 함께 반려됩니다.
                  </span>
                </div>
              </header>
              <div className="admin-reservations">
                {group.map((row) => (
                  <ReservationCard key={row.id} row={row} group={group} sort={sort} onDecide={decide} onResolve={resolveGroup} onCancel={cancel} />
                ))}
              </div>
            </section>
          ))}
          {plain.length > 0 && (
            <div className="admin-reservations">
              {plain.map((row) => (
                <ReservationCard key={row.id} row={row} sort={sort} onDecide={decide} onResolve={resolveGroup} onCancel={cancel} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <h2>표시할 예약이 없습니다</h2>
          <p>필터를 바꾸면 지난 예약과 사용 기록도 확인할 수 있습니다.</p>
        </div>
      )}
      {dialogNode}
    </div>
  );
}
