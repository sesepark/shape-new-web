"use client";

import { CornerDownRight, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAsk } from "@/components/ask-dialog";
import { AutoTextarea } from "@/components/auto-textarea";
import { board, boardSend } from "@/lib/board";
import type { CommentItem } from "@/lib/types";

const stamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

function CommentForm({ placeholder, onSubmit, onCancel }: { placeholder: string; onSubmit: (body: string) => Promise<boolean>; onCancel?: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    const ok = await onSubmit(body.trim());
    setBusy(false);
    if (ok) setBody("");
  }
  return (
    <div className="comment-form">
      <AutoTextarea value={body} maxLength={2000} placeholder={placeholder} onChange={setBody} />
      <div className="inline-actions">
        <button type="button" className="button small" disabled={busy || !body.trim()} onClick={send}>
          <Send size={14} /> {busy ? "등록 중" : "등록"}
        </button>
        {onCancel && (
          <button type="button" className="button secondary small" onClick={onCancel}>취소</button>
        )}
      </div>
    </div>
  );
}

export function NoticeComments({ noticeId }: { noticeId: string }) {
  const { ask, dialogNode } = useAsk();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const response = await board(`/notices/${noticeId}/comments`);
    setItems(response.ok ? ((await response.json()) as CommentItem[]) : []);
  }, [noticeId]);

  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);

  async function write(body: string, parentId?: string) {
    const response = await boardSend(`/notices/${noticeId}/comments`, "POST", { body, parentId: parentId ?? null });
    if (!response.ok) { setMessage("댓글을 등록하지 못했습니다."); return false; }
    setMessage("");
    setReplyTo(null);
    await reload();
    return true;
  }

  async function remove(id: string) {
    const confirmed = await ask({
      title: "이 댓글을 삭제할까요?",
      description: "답글이 달린 자리에는 '삭제된 댓글입니다' 표시만 남습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (confirmed === null) return;
    if ((await board(`/comments/${id}`, { method: "DELETE" })).ok) await reload();
    else setMessage("댓글을 삭제하지 못했습니다.");
  }

  const roots = (items ?? []).filter((item) => !item.parentId);
  const total = (items ?? []).filter((item) => !item.isDeleted).length;

  return (
    <section className="comment-section" aria-label="댓글">
      <h3>댓글 {total}</h3>
      {message && <p className="save-notice">{message}</p>}
      <CommentForm placeholder="댓글을 남겨 주세요." onSubmit={(body) => write(body)} />
      {items === null ? (
        <p className="form-note">댓글을 불러오고 있습니다.</p>
      ) : roots.length ? (
        <ul className="comment-list">
          {roots.map((comment) => (
            <li key={comment.id}>
              <article className={comment.isDeleted ? "comment removed" : "comment"}>
                <header>
                  <strong>{comment.authorName || "—"}</strong>
                  <time>{stamp.format(new Date(comment.createdAt))}</time>
                </header>
                <p>{comment.body}</p>
                <div className="comment-actions">
                  {!comment.isDeleted && (
                    <button type="button" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>
                      <CornerDownRight size={13} /> 답글
                    </button>
                  )}
                  {comment.canDelete && (
                    <button type="button" className="danger" onClick={() => remove(comment.id)}>
                      <Trash2 size={13} /> 삭제
                    </button>
                  )}
                </div>
              </article>
              <ul className="comment-replies">
                {(items ?? []).filter((reply) => reply.parentId === comment.id).map((reply) => (
                  <li key={reply.id}>
                    <article className={reply.isDeleted ? "comment removed" : "comment"}>
                      <header>
                        <strong><CornerDownRight size={13} /> {reply.authorName || "—"}</strong>
                        <time>{stamp.format(new Date(reply.createdAt))}</time>
                      </header>
                      <p>{reply.body}</p>
                      {reply.canDelete && (
                        <div className="comment-actions">
                          <button type="button" className="danger" onClick={() => remove(reply.id)}>
                            <Trash2 size={13} /> 삭제
                          </button>
                        </div>
                      )}
                    </article>
                  </li>
                ))}
                {replyTo === comment.id && (
                  <li>
                    <CommentForm placeholder="답글을 남겨 주세요." onCancel={() => setReplyTo(null)} onSubmit={(body) => write(body, comment.id)} />
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">첫 댓글을 남겨 보세요.</p>
      )}
      {dialogNode}
    </section>
  );
}
