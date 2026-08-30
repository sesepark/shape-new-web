"use client";

import { Check, Mail, Reply, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAsk } from "@/components/ask-dialog";
import { useNotice } from "@/components/use-notice";
import { adminFetch, adminSend } from "@/lib/admin-api";
import type { AdminContactItem, AdminContactPage } from "@/lib/types";

/** 한 쪽에 받는 수. 백엔드의 `CONTACT_PAGE` 와 같아야 합니다. */
const PAGE = 30;
/**
 * 왼쪽 탭 이름 옆 숫자에게 "지금 안 읽은 수는 이만큼" 이라고 알리는 신호.
 *
 * 그 숫자는 관리자 화면이 열릴 때 한 번만 셉니다. 여기서 읽음 표시를 해도
 * 알려 주지 않으면, 다 읽었는데 탭에는 계속 3 이 떠 있게 됩니다.
 */
export const CONTACT_UNREAD_EVENT = "shape:contact-unread";

function tellTab(unread: number) {
  window.dispatchEvent(new CustomEvent(CONTACT_UNREAD_EVENT, { detail: unread }));
}
const stamp = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * `/contact` 로 들어온 문의를 모아 보는 화면.
 *
 * **운영진 알림으로 보내지 않습니다.** 예약 알림에 섞이면 묻히고, 문의는 급한
 * 일이 아니라 한곳에 모아 두고 훑는 편이 맞기 때문입니다. 대신 왼쪽 탭 이름
 * 옆에 안 읽은 수가 붙어, 관리자 화면을 열면 그 수가 눈에 들어옵니다.
 *
 * 읽음과 답변 완료를 따로 두는 이유는 **'읽었지만 아직 답을 못 한 것'** 이
 * 운영진이 실제로 챙겨야 하는 상태이기 때문입니다. 읽었다고 사라지면 그것이
 * 묻힙니다.
 */
export function AdminContact() {
  const { node: notice, say } = useNotice();
  const { ask, dialogNode } = useAsk();
  const [rows, setRows] = useState<AdminContactItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  const path = `/admin/contact${unreadOnly ? "?unreadOnly=true" : ""}`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await adminFetch(path, { signal }).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json()) as AdminContactPage;
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((page) => {
      if (!page) return;
      setRows(page.items);
      setUnread(page.unread);
      setMore(page.items.length >= PAGE);
      tellTab(page.unread);
    });
    return () => controller.abort();
  }, [load]);

  async function reload() {
    const page = await load();
    if (!page) { say("문의를 다시 불러오지 못했습니다.", false); return; }
    setRows(page.items);
    setUnread(page.unread);
    setMore(page.items.length >= PAGE);
    tellTab(page.unread);
  }

  async function loadOlder() {
    const oldest = rows?.[rows.length - 1]?.createdAt;
    if (!oldest) return;
    setLoading(true);
    const query = new URLSearchParams({ before: oldest });
    if (unreadOnly) query.set("unreadOnly", "true");
    const response = await adminFetch(`/admin/contact?${query}`).catch(() => null);
    setLoading(false);
    if (!response?.ok) return;
    const page = (await response.json()) as AdminContactPage;
    setMore(page.items.length >= PAGE);
    setRows((current) => {
      const seen = new Set((current ?? []).map((item) => item.id));
      return [...(current ?? []), ...page.items.filter((item) => !seen.has(item.id))];
    });
  }

  /** 읽음·답변 완료 표시. 준 것만 바뀝니다. */
  async function mark(row: AdminContactItem, body: { isRead?: boolean; handled?: boolean }) {
    const response = await adminSend(`/admin/contact/${row.id}`, "PATCH", body);
    if (!response.ok) { say("표시를 바꾸지 못했습니다.", false); return; }
    const next = (await response.json()) as AdminContactItem;
    setRows((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? current);
    // 안 읽은 수는 이 쪽에 실린 것이 아니라 전체를 셉니다. 한 건을 바꾼
    // 것뿐이므로 다시 묻지 않고 하나만 더하고 뺍니다.
    if (body.isRead !== undefined) {
      // 상태 갱신 함수 **안에서** 신호를 보내지 않습니다. React 는 개발 모드에서
      // 그 함수를 두 번 부를 수 있어 신호가 두 번 나갑니다. 한 번에 한 건만
      // 누르므로 지금 값으로 세어도 어긋나지 않습니다.
      const next = Math.max(0, unread + (body.isRead ? -1 : 1));
      setUnread(next);
      tellTab(next);
    }
  }

  async function remove(row: AdminContactItem) {
    const confirmed = await ask({
      title: "이 문의를 지울까요?",
      description: `${row.name} 님의 ‘${row.subject}’ 문의를 지웁니다. 되돌릴 수 없습니다. 스팸이 아니라면 답변 완료로 표시해 두는 편이 낫습니다.`,
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (confirmed === null) return;
    const response = await adminSend(`/admin/contact/${row.id}`, "DELETE");
    if (!response.ok) { say("문의를 지우지 못했습니다.", false); return; }
    say("문의를 지웠습니다.");
    await reload();
  }

  return (
    <div className="admin-form">
      <p className="form-note">
        <b>/contact</b> 폼으로 들어온 문의입니다. 운영진 알림으로는 보내지 않습니다 —
        예약 알림에 섞이면 묻히기 때문에, 이 탭에 모아 두고 훑습니다.
        왼쪽 탭 이름 옆 숫자가 <b>아직 읽지 않은 문의 수</b>입니다.
      </p>
      <p className="form-note">
        답장은 <b>회신 이메일로 직접</b> 보내 주세요. 보낸 뒤 <b>답변 완료</b>로 표시해 두면
        읽기만 하고 아직 답하지 않은 문의가 남아 보입니다.
      </p>
      <div className="board-filter" aria-label="문의 필터">
        <button type="button" className={unreadOnly ? "" : "active"} onClick={() => setUnreadOnly(false)}>
          전체
        </button>
        <button type="button" className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>
          안 읽음{unread > 0 ? ` (${unread})` : ""}
        </button>
      </div>
      {notice}
      {rows === null ? (
        <p className="form-note">문의를 불러오는 중입니다.</p>
      ) : rows.length ? (
        <ul className="contact-inbox">
          {rows.map((row) => (
            <li key={row.id} className={row.isRead ? "" : "unread"}>
              <header>
                <div>
                  <strong>{row.subject}</strong>
                  <span>
                    {row.name} · <a href={`mailto:${row.replyTo}?subject=${encodeURIComponent(`Re: ${row.subject}`)}`}>{row.replyTo}</a>
                  </span>
                </div>
                <time>{stamp.format(new Date(row.createdAt))}</time>
              </header>
              {/* 문의 본문은 사람이 자유롭게 적은 글입니다. 줄바꿈을 살려서
                  적힌 그대로 보여 줍니다. */}
              <p className="contact-body">{row.message}</p>
              <div className="contact-actions">
                <a
                  className="button small"
                  href={`mailto:${row.replyTo}?subject=${encodeURIComponent(`Re: ${row.subject}`)}`}
                  onClick={() => { if (!row.isRead) void mark(row, { isRead: true }); }}
                >
                  <Reply size={14} /> 답장 쓰기
                </a>
                <button type="button" className="text-button" onClick={() => void mark(row, { isRead: !row.isRead })}>
                  <Mail size={14} /> {row.isRead ? "안 읽음으로" : "읽음으로"}
                </button>
                <button
                  type="button"
                  className={`text-button${row.handledAt ? " done" : ""}`}
                  onClick={() => void mark(row, { handled: !row.handledAt })}
                >
                  <Check size={14} /> {row.handledAt ? `답변 완료 · ${stamp.format(new Date(row.handledAt))}` : "답변 완료로 표시"}
                </button>
                <button type="button" className="text-button danger" onClick={() => void remove(row)}>
                  <Trash2 size={14} /> 지우기
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <h2>{unreadOnly ? "안 읽은 문의가 없습니다" : "받은 문의가 없습니다"}</h2>
          <p>연락 페이지의 문의 폼으로 들어온 글이 여기에 쌓입니다.</p>
        </div>
      )}
      {more && (
        <button type="button" className="button secondary board-more" disabled={loading} onClick={() => void loadOlder()}>
          {loading ? "불러오는 중…" : "이전 문의 더 보기"}
        </button>
      )}
      {dialogNode}
    </div>
  );
}
