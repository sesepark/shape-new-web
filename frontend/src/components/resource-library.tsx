"use client";

import { Download, ExternalLink, FileText, Link2, Lock, Plus, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAsk } from "@/components/ask-dialog";
import { AutoTextarea } from "@/components/auto-textarea";
import { board, boardSend } from "@/lib/board";
import { uploadDocument } from "@/lib/upload";
import { useSession } from "@/lib/session";
import type { ResourceCategory, ResourceItem } from "@/lib/types";

const categories: ResourceCategory[] = ["양식", "교육 자료", "장비 매뉴얼", "발표 자료", "기타"];
const filters = ["전체", ...categories] as const;
const listDate = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" });
/** 서버가 한 번에 보내 주는 자료 수. 백엔드의 RESOURCE_PAGE 와 같아야 합니다. */
const PAGE = 40;

function readableSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extensionOf(item: ResourceItem) {
  if (item.linkUrl && !item.fileUrl) return "LINK";
  return (item.fileName?.split(".").pop() ?? "FILE").toUpperCase();
}

function UploadForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ResourceCategory>("양식");
  const [isPublic, setIsPublic] = useState(false);
  const [file, setFile] = useState<{ url: string; name: string; size: number } | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function pick(chosen: File) {
    setBusy(true);
    setMessage("");
    const result = await uploadDocument(chosen);
    setBusy(false);
    if (!result.url) { setMessage(result.error ?? "파일을 올리지 못했습니다."); return; }
    setFile({ url: result.url, name: result.name ?? chosen.name, size: result.size ?? chosen.size });
  }

  async function submit() {
    if (!title.trim()) { setMessage("자료 이름을 입력해 주세요."); return; }
    if (!file && !linkUrl.trim()) { setMessage("파일을 올리거나 링크 주소를 입력해 주세요."); return; }
    setBusy(true);
    const response = await boardSend("/resources", "POST", {
      title: title.trim(), description, category, isPublic,
      fileUrl: file?.url ?? null, fileName: file?.name ?? null, fileSize: file?.size ?? 0,
      linkUrl: linkUrl.trim() || null,
    });
    setBusy(false);
    if (!response.ok) {
      setMessage(response.status === 401 || response.status === 403 ? "로그인한 회원만 자료를 올릴 수 있습니다." : "자료를 등록하지 못했습니다.");
      return;
    }
    onDone();
  }

  return (
    <div className="resource-form admin-form">
      <label>
        자료 이름
        <input value={title} maxLength={200} placeholder="예: SHAPE-UP 제안서 양식" onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        설명
        <AutoTextarea value={description} maxLength={2000} minRows={2} placeholder="언제 쓰는 자료인지 한두 줄로 적어 주세요." onChange={setDescription} />
      </label>
      <div className="admin-form-row">
        <label>
          분류
          <select value={category} onChange={(event) => setCategory(event.target.value as ResourceCategory)}>
            {categories.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
          <span>로그인하지 않은 사람에게도 공개</span>
        </label>
      </div>
      <div className="resource-source">
        <div>
          <span className="field-label">파일 올리기</span>
          {file ? (
            <p className="resource-picked">
              <FileText size={15} /> {file.name} <b>{readableSize(file.size)}</b>
              <button type="button" onClick={() => setFile(null)} aria-label="파일 제거"><X size={14} /></button>
            </p>
          ) : (
            <label className="resource-dropzone">
              <Upload size={18} />
              <span>{busy ? "올리는 중…" : "파일 선택"}</span>
              {/* 받는 형식은 서버가 정합니다. 여기 다 적으면 백 가지가 넘어
                  오히려 읽히지 않으므로, 자주 쓰는 갈래만 적습니다. */}
              <small>문서 · 압축 · 코드 · 데이터 · 3D · 사진과 영상 · 최대 10MB</small>
              <input className="sr-only" type="file" disabled={busy} onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) void pick(chosen); event.target.value = ""; }} />
            </label>
          )}
        </div>
        <div>
          <label>
            또는 링크 주소
            <input type="url" value={linkUrl} placeholder="https://drive.google.com/..." onChange={(event) => setLinkUrl(event.target.value)} />
          </label>
          <p className="form-note">용량이 큰 영상이나 폴더는 Drive 링크로 등록하면 편합니다.</p>
        </div>
      </div>
      <div className="admin-actions">
        <button type="button" className="button" disabled={busy} onClick={submit}>{busy ? "저장 중" : "자료 등록"}</button>
        <button type="button" className="button secondary" onClick={onCancel}>취소</button>
        {message && <p className="save-notice" role="status">{message}</p>}
      </div>
    </div>
  );
}

export function ResourceLibrary() {
  const { session } = useSession();
  const { ask, dialogNode } = useAsk();
  const [items, setItems] = useState<ResourceItem[] | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]>("전체");
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState("");
  // 자료실은 기수가 쌓일수록 늘기만 합니다. 게시판과 같이 한 번에 40개만 받고,
  // 더 오래된 자료는 눌러서 이어 받습니다.
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    const response = await board("/resources");
    const rows = response.ok ? ((await response.json()) as ResourceItem[]) : [];
    setItems(rows);
    setMore(rows.length >= PAGE);
  }, []);

  async function loadOlder() {
    const oldest = items?.[items.length - 1]?.createdAt;
    if (!oldest) return;
    setLoading(true);
    const response = await board(`/resources?before=${encodeURIComponent(oldest)}`).catch(() => null);
    setLoading(false);
    if (!response?.ok) return;
    const rows = (await response.json()) as ResourceItem[];
    setMore(rows.length >= PAGE);
    setItems((current) => {
      const seen = new Set((current ?? []).map((item) => item.id));
      return [...(current ?? []), ...rows.filter((item) => !seen.has(item.id))];
    });
  }

  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);

  async function remove(item: ResourceItem) {
    const confirmed = await ask({
      title: "이 자료를 삭제할까요?",
      description: `${item.title} · 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (confirmed === null) return;
    if ((await board(`/resources/${item.id}`, { method: "DELETE" })).ok) await reload();
    else setMessage("자료를 삭제하지 못했습니다.");
  }

  // 보기 전용 회원은 자료를 읽기만 합니다. 서버도 같은 기준으로 막습니다.
  const canWrite = Boolean(session && session.status === "APPROVED");
  const visible = (items ?? []).filter((item) => filter === "전체" || item.category === filter);

  return (
    <div className="resource-library">
      <div className="board-head">
        <div className="board-filter" aria-label="자료 분류 필터">
          {filters.map((item) => (
            <button type="button" key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
        </div>
        {canWrite && !writing && (
          <button type="button" className="button small" onClick={() => setWriting(true)}>
            <Plus size={16} /> 자료 올리기
          </button>
        )}
      </div>
      {message && <p className="save-notice">{message}</p>}
      {writing && <UploadForm onCancel={() => setWriting(false)} onDone={() => { setWriting(false); void reload(); }} />}
      {!canWrite && session === null && (
        <p className="form-note">로그인하면 회원 전용 자료까지 모두 보이고, 직접 자료를 올릴 수도 있습니다.</p>
      )}
      {items === null ? (
        <p className="form-note">자료를 불러오고 있습니다.</p>
      ) : visible.length ? (
        <ul className="resource-list">
          {visible.map((item) => {
            const href = item.fileUrl ?? item.linkUrl ?? "#";
            return (
              <li key={item.id}>
                <span className="resource-type" aria-hidden="true">{extensionOf(item)}</span>
                <div className="resource-copy">
                  <strong>
                    {item.title}
                    {!item.isPublic && <b className="resource-locked"><Lock size={11} /> 회원 전용</b>}
                  </strong>
                  {item.description && <p>{item.description}</p>}
                  <span className="resource-meta">
                    {item.category}
                    <i>·</i>
                    {item.authorName}
                    <i>·</i>
                    <time>{listDate.format(new Date(item.createdAt))}</time>
                    {item.fileSize > 0 && <><i>·</i>{readableSize(item.fileSize)}</>}
                  </span>
                </div>
                <div className="resource-actions">
                  <a className="button secondary small" href={href} target="_blank" rel="noreferrer" download={item.fileName ?? undefined}>
                    {item.fileUrl ? <><Download size={14} /> 내려받기</> : <><ExternalLink size={14} /> 열기</>}
                  </a>
                  {item.canEdit && (
                    <button type="button" className="text-button danger" onClick={() => remove(item)}>
                      <Trash2 size={14} /> 삭제
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-state">
          <Link2 aria-hidden="true" />
          <h2>{filter === "전체" ? "등록된 자료가 없습니다" : `${filter} 자료가 없습니다`}</h2>
          <p>양식이나 매뉴얼을 올리면 부원 누구나 바로 내려받을 수 있습니다.</p>
        </div>
      )}
      {more && visible.length > 0 && (
        <button type="button" className="button secondary board-more" disabled={loading} onClick={() => void loadOlder()}>
          {loading ? "불러오는 중…" : "이전 자료 더 보기"}
        </button>
      )}
      {dialogNode}
    </div>
  );
}
