"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { DraftNotice, DraftSaved } from "@/components/draft-notice";
import { board, boardError, boardSend } from "@/lib/board";
import { useDraft } from "@/lib/draft";
import type { NoticeCategory, NoticeDetail, SessionUser } from "@/lib/types";

const openCategories: NoticeCategory[] = ["질문", "정보", "일반"];

export function NoticeEditor({ session }: { session: SessionUser }) {
  const router = useRouter();
  const search = useSearchParams();
  const noticeId = search.get("id");
  const canManage = session.isOwner || session.permissions.includes("notices:manage");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<NoticeCategory>(canManage ? "공지" : "질문");
  const [pinned, setPinned] = useState(false);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!noticeId);

  useEffect(() => {
    if (!noticeId) return;
    let active = true;
    void board(`/notices/${noticeId}`).then(async (response) => {
      if (!active) return;
      if (!response.ok) { setMessage("글을 불러오지 못했습니다."); setReady(true); return; }
      const item = (await response.json()) as NoticeDetail;
      setTitle(item.title);
      setCategory(item.category);
      setPinned(item.isPinned);
      setBody(item.contentHtml);
      setReady(true);
    });
    return () => { active = false; };
  }, [noticeId]);

  const snapshot = { title, category, pinned, body };
  type Snapshot = typeof snapshot;
  /**
   * 본문이 TipTap 이라 빈 글도 `<p></p>` 같은 껍데기가 옵니다. 글자가 실제로
   * 있는지로 판단해야 "쓰다 만 글이 있다" 는 말이 거짓말이 되지 않습니다.
   */
  const written = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  const dirty = Boolean(title.trim() || written);
  // 고치는 글과 새 글을 따로 담습니다. 섞이면 남의 글을 고치다 만 내용이
  // 새 글 화면에 뜹니다.
  const draft = useDraft<Snapshot>(noticeId ? `notice:${noticeId}` : "notice:new", snapshot, dirty && ready);

  function restore(saved: Snapshot) {
    setTitle(saved.title);
    setCategory(saved.category);
    setPinned(saved.pinned);
    setBody(saved.body);
    draft.dismiss();
  }

  async function submit() {
    if (!title.trim()) { setMessage("제목을 입력해 주세요."); return; }
    setBusy(true);
    const payload = { title: title.trim(), category, contentHtml: body, contentJson: {}, isPinned: pinned };
    const response = noticeId
      ? await boardSend(`/notices/${noticeId}`, "PATCH", payload)
      : await boardSend("/notices", "POST", payload);
    setBusy(false);
    if (!response.ok) { setMessage(boardError(response.status)); return; }
    const saved = (await response.json()) as NoticeDetail;
    draft.clear();
    router.push(`/notices/${saved.id}`);
    router.refresh();
  }

  if (!ready) return <p className="form-note">글을 불러오고 있습니다.</p>;

  return (
    <div className="board-editor">
      <Link className="detail-back" href={noticeId ? `/notices/${noticeId}` : "/notices"}>
        <ArrowLeft size={16} /> {noticeId ? "글로 돌아가기" : "게시판"}
      </Link>
      <div className="admin-form">
        {draft.found && (
          <DraftNotice at={draft.found.at} onRestore={() => restore(draft.found!.value)} onDiscard={draft.clear} />
        )}
        <p className="form-note">
          승인된 회원은 질문·정보·일반 글을 자유롭게 쓸 수 있습니다.
          {canManage
            ? " 운영진이므로 공지 등록과 상단 고정도 가능합니다."
            : " 공지 등록과 상단 고정은 운영진만 할 수 있습니다."}
        </p>
        <label>
          제목
          <input value={title} maxLength={200} placeholder="제목을 입력해 주세요." onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="admin-form-row">
          <label>
            글 종류
            <select value={category} onChange={(event) => setCategory(event.target.value as NoticeCategory)}>
              {canManage && <option value="공지">공지</option>}
              {openCategories.map((item) => (
                <option value={item} key={item}>{item}</option>
              ))}
            </select>
          </label>
          {canManage && (
            <label className="toggle-field">
              <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
              <span>목록 맨 위에 &lsquo;중요&rsquo;로 고정</span>
            </label>
          )}
        </div>
        <div className="field-block">
          <span className="field-label">본문</span>
          {/* 편집기를 <label> 로 감싸면 안 됩니다. label 을 누르면 브라우저가 그 안의
            첫 입력 요소를 대신 눌러 주는데, 글상자를 누르는 순간 그 동작이 일어나
            **도구 막대의 첫 단추로 초점이 끌려갔습니다.** 글을 쓰려고 눌렀는데
            '문단 모양' 이 잡히는 문제가 여기서 났습니다. */}
          <RichTextEditor value={body} onChange={setBody} purpose="notice" />
        </div>
        <div className="admin-actions">
          <button type="button" className="button" disabled={busy} onClick={submit}>
            {busy ? "저장 중" : noticeId ? "수정 내용 저장" : "글 등록"}
          </button>
          <Link className="button secondary" href={noticeId ? `/notices/${noticeId}` : "/notices"}>취소</Link>
          <DraftSaved at={draft.savedAt} />
          {message && <p className="save-notice" role="status">{message}</p>}
        </div>
      </div>
    </div>
  );
}
