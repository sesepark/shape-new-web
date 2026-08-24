"use client";

import { ArrowDown, ArrowUp, ExternalLink, Eye, PencilLine, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageUploadField } from "@/components/image-upload-field";
import { MemberDirectory } from "@/components/member-directory";
import {
  defaultOrganization,
  OrganizationChart,
  type OrganizationData,
  type OrganizationTeam,
} from "@/components/organization-chart";
import { RichTextEditor } from "@/components/rich-text-editor";
import { useAsk } from "@/components/ask-dialog";
import { media, optimizable } from "@/lib/media";
import type { ShapeMember } from "@/lib/members";
import type { AdminEquipmentItem, AdminReservationItem, AdminRoadmapItem, AdminUserItem, DirectoryUser, LicenseItem, MemberStatus } from "@/lib/types";

const groups = [
  { label: "SHAPE", tabs: ["인사말", "동아리 소개", "조직도", "부원"] },
  { label: "장비 예약", tabs: ["보유 장비", "라이선스", "장비 예약"] },
  { label: "소식", tabs: ["SHAPE 뉴스", "언론보도", "게시판"] },
  { label: "로드맵", tabs: ["전체 로드맵", "SHAPE-UP", "대회", "교육", "기타"] },
  { label: "바로가기", tabs: ["관련 링크"] },
  { label: "시스템", tabs: ["회원 및 권한"] },
] as const;
type Section = (typeof groups)[number]["tabs"][number];
// Every tab maps to the permission its API calls require, so a manager only
// sees the sections they can actually save; "owner" is reserved for members.
const tabPermission: Record<Section, string> = {
  "인사말": "content:manage",
  "동아리 소개": "content:manage",
  "조직도": "content:manage",
  "부원": "content:manage",
  "보유 장비": "equipment:manage",
  "라이선스": "equipment:manage",
  "장비 예약": "reservations:manage",
  "SHAPE 뉴스": "news:manage",
  "언론보도": "news:manage",
  "게시판": "notices:manage",
  "전체 로드맵": "roadmap:manage",
  "SHAPE-UP": "roadmap:manage",
  "대회": "roadmap:manage",
  "교육": "roadmap:manage",
  "기타": "roadmap:manage",
  "관련 링크": "links:manage",
  "회원 및 권한": "owner",
};
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
type AdminRow = Record<
  string,
  string | number | boolean | null | Record<string, unknown> | unknown[]
>;
const emptyRows: AdminRow[] = [];

/** A dropped connection must read as a failed call, never an unhandled reject. */
type AdminResult = { ok: boolean; status: number; json: () => Promise<unknown> };
const offline: AdminResult = { ok: false, status: 0, json: async () => ({}) };

async function adminFetch(path: string, init: RequestInit = {}): Promise<AdminResult> {
  try {
    return await fetch(`${apiUrl}${path}`, { credentials: "include", cache: "no-store", ...init });
  } catch {
    return offline;
  }
}

async function adminSend(path: string, method: string, body?: unknown): Promise<AdminResult> {
  return adminFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}


/** Plain-language orientation for each tab: what it changes and where to see it. */
const sectionGuide: Record<Section, { what: string; where: string; href?: string }> = {
  "인사말": { what: "운영진 인사말 글을 작성합니다.", where: "공개 페이지 SHAPE › 인사말", href: "/greeting" },
  "동아리 소개": { what: "동아리가 무엇을 하는 곳인지 소개하는 글과 숫자 정보를 작성합니다.", where: "공개 페이지 SHAPE › 동아리 소개", href: "/about" },
  "조직도": { what: "팀 구성과 담당 업무, 팀에 속한 부원을 연결합니다.", where: "공개 페이지 SHAPE › 조직도", href: "/organization" },
  "부원": { what: "부원 카드를 한 명씩 등록하고 사진·역할·회원 구분을 관리합니다.", where: "공개 페이지 SHAPE › 부원", href: "/members" },
  "보유 장비": { what: "장비를 등록하고 사진·상태·예약 조건과 개별 호기를 관리합니다.", where: "공개 페이지 장비 예약 › 보유 장비", href: "/equipment" },
  "라이선스": { what: "장비를 쓰기 전에 이수해야 하는 교육 항목을 만듭니다.", where: "장비 상세의 '사전 조건'과 부원 마이페이지" },
  "장비 예약": { what: "회원이 신청한 예약을 승인·반려하고 사용 전후 사진을 확인합니다.", where: "회원 마이페이지와 예약 시간표" },
  "SHAPE 뉴스": { what: "동아리 활동 소식을 사진과 함께 올립니다.", where: "공개 페이지 소식 › SHAPE 뉴스", href: "/news" },
  "언론보도": { what: "외부 기사·영상 링크를 등록하면 미리보기가 자동으로 만들어집니다.", where: "공개 페이지 소식 › 언론보도", href: "/news/press" },
  "게시판": { what: "승인된 회원만 보는 내부 공지를 씁니다. 공개하면 알림이 함께 전달됩니다.", where: "공개 페이지 소식 › 게시판(로그인 필요)", href: "/notices" },
  "전체 로드맵": { what: "연간 일정을 등록하고 참여 부원을 배정합니다.", where: "공개 페이지 로드맵", href: "/roadmap" },
  "SHAPE-UP": { what: "SHAPE-UP 일정만 따로 등록합니다.", where: "공개 페이지 로드맵 › SHAPE-UP", href: "/roadmap/shape-up" },
  "대회": { what: "대회 일정만 따로 등록합니다.", where: "공개 페이지 로드맵 › 대회", href: "/roadmap/competition" },
  "교육": { what: "교육 일정만 따로 등록합니다.", where: "공개 페이지 로드맵 › 교육", href: "/roadmap/education" },
  "기타": { what: "세 트랙에 들어가지 않는 일정을 등록합니다.", where: "공개 페이지 로드맵 › 전체 로드맵", href: "/roadmap" },
  "관련 링크": { what: "Drive·Notion 같은 외부 링크를 카드로 등록합니다.", where: "공개 페이지 바로가기 › 관련 링크", href: "/links" },
  "회원 및 권한": { what: "가입 신청을 승인하고 운영진 권한과 장비 라이선스를 부여합니다.", where: "회원 로그인과 마이페이지" },
};

function SectionGuide({ tab }: { tab: Section }) {
  const guide = sectionGuide[tab];
  return (
    <div className="admin-guide">
      <p>{guide.what}</p>
      <span>
        반영 위치: {guide.where}
        {guide.href && (
          <a href={guide.href} target="_blank" rel="noreferrer">
            공개 화면 열기 <ExternalLink size={13} />
          </a>
        )}
      </span>
    </div>
  );
}

/** One consistent editing banner so it is obvious what is being changed. */
function EditingBanner({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="admin-editing" role="status">
      <span><PencilLine size={15} /> <b>{title || "선택한 항목"}</b> 을(를) 수정하고 있습니다.</span>
      <button type="button" onClick={onCancel}>새로 작성하기</button>
    </div>
  );
}

/** Draft versus published, in words rather than a technical flag. */
function PublishChoice({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <fieldset className="publish-choice">
      <legend>공개 여부</legend>
      <label className={value ? "active" : ""}>
        <input type="radio" name="publish" checked={value} onChange={() => onChange(true)} />
        <b>바로 공개</b>
        <small>저장하는 즉시 공개 페이지에 보입니다.</small>
      </label>
      <label className={value ? "" : "active"}>
        <input type="radio" name="publish" checked={!value} onChange={() => onChange(false)} />
        <b>임시 저장</b>
        <small>운영진만 볼 수 있고 공개되지 않습니다.</small>
      </label>
    </fieldset>
  );
}

export function AdminConsole({
  name,
  isOwner,
  permissions,
  preview = false,
}: {
  name: string;
  isOwner: boolean;
  permissions: string[];
  preview?: boolean;
}) {
  const allowed = useCallback(
    (section: Section) => isOwner || permissions.includes(tabPermission[section]),
    [isOwner, permissions],
  );
  const visibleGroups = groups
    .map((group) => ({ label: group.label, tabs: (group.tabs as readonly Section[]).filter(allowed) }))
    .filter((group) => group.tabs.length);
  const [tab, setTab] = useState<Section>(visibleGroups[0]?.tabs[0] ?? "인사말");
  if (!visibleGroups.length)
    return (
      <div className="empty-state">
        <h2>관리 권한이 없습니다</h2>
        <p>운영진에게 필요한 기능 권한을 요청해 주세요.</p>
      </div>
    );
  return (
    <div className="admin-layout">
      <aside>
        <p className="eyebrow">ADMINISTRATOR</p>
        <strong>{name}</strong>
        <span>
          {preview
            ? "개발 미리보기"
            : isOwner
              ? "Owner"
              : `${permissions.length}개 권한`}
        </span>
        <div className="admin-tabs">
          {visibleGroups.map((group) => (
            <section className="admin-tab-group" key={group.label}>
              <p>{group.label}</p>
              {group.tabs.map((section) => (
                <button
                  key={section}
                  className={tab === section ? "admin-tab active" : "admin-tab"}
                  onClick={() => setTab(section)}
                >
                  {section}
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">
              MANAGEMENT ·{" "}
              {
                visibleGroups.find((group) =>
                  (group.tabs as readonly string[]).includes(tab),
                )?.label
              }
            </p>
            <h2>{tab}</h2>
          </div>
          <span>
            {preview
              ? "개발 미리보기입니다. 로그인 없이 화면 구성만 확인할 수 있습니다."
              : "저장을 누르면 선택한 공개 여부에 따라 바로 반영됩니다."}
          </span>
        </div>
        <SectionGuide tab={tab} />
        <AdminSection tab={tab} owner={isOwner} />
      </section>
    </div>
  );
}

function AdminSection({ tab, owner }: { tab: Section; owner: boolean }) {
  if (tab === "인사말")
    return (
      <ContentForm
        tab={tab}
        endpoint="/admin/pages/greeting"
        method="PUT"
        hint="운영진 인사말을 작성합니다. 저장하면 공개 페이지 SHAPE › 인사말에 그대로 표시됩니다."
      />
    );
  if (tab === "동아리 소개") return <ClubIntroductionForm />;
  if (tab === "조직도") return <OrganizationForm />;
  if (tab === "부원") return <MembersForm />;
  if (tab === "SHAPE 뉴스")
    return <ContentForm tab={tab} endpoint="/admin/news" method="POST" news />;
  if (tab === "언론보도")
    return (
      <ContentForm tab={tab} endpoint="/admin/news" method="POST" news press />
    );
  if (tab === "게시판")
    return (
      <ContentForm tab={tab} endpoint="/admin/notices" method="POST" notice />
    );
  if (tab === "보유 장비") return <EquipmentForm />;
  if (tab === "라이선스") return <LicenseManager />;
  if (tab === "장비 예약") return <ReservationsPanel />;
  if (["전체 로드맵", "SHAPE-UP", "대회", "교육", "기타"].includes(tab))
    return (
      <RoadmapForm fixedCategory={tab === "전체 로드맵" ? undefined : tab} />
    );
  if (tab === "관련 링크") return <LinkForm />;
  return <MembersPanel owner={owner} />;
}

/**
 * 회원이 늘어나면 이름을 찾는 일이 먼저 힘들어진다. 아래 두 도구가 관리자
 * 페이지의 회원 고르기를 모두 담당한다.
 *
 * `matches` 는 이름·이메일 어느 쪽으로 쳐도 걸리게 하고, 한글은 대소문자
 * 구분이 없지만 이메일이 섞여 있어 소문자로 맞춰 비교한다.
 */
function matches(haystack: string, keyword: string) {
  return haystack.toLocaleLowerCase("ko").includes(keyword.trim().toLocaleLowerCase("ko"));
}

/** 목록 위에 놓는 검색 상자. 값은 부르는 쪽이 들고 있는다. */
function FilterBox({ value, onChange, placeholder, count }: { value: string; onChange: (next: string) => void; placeholder: string; count?: number }) {
  return (
    <div className="admin-filter">
      <Search size={15} aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {typeof count === "number" && <span>{count}명</span>}
    </div>
  );
}

/**
 * 한 사람을 골라 붙이는 상자. 예전에는 `select` 하나에 회원 전체를 넣어 두었는데,
 * 일흔 명이 넘어가면 원하는 이름까지 굴려 내려가야 한다. 검색으로 좁히고
 * 좁혀진 목록에서 누르게 한다.
 *
 * `value` 가 있으면 고른 사람을 칩으로 보여 주고 검색 상자는 감춘다.
 */
function PersonPicker({ people, value, onSelect, placeholder, emptyLabel, clearLabel }: {
  people: { id: string; name: string; detail?: string }[];
  value?: string;
  onSelect: (id: string | undefined) => void;
  placeholder: string;
  emptyLabel: string;
  clearLabel: string;
}) {
  const [keyword, setKeyword] = useState("");
  const chosen = people.find((person) => person.id === value);
  const found = useMemo(() => {
    if (!keyword.trim()) return people;
    return people.filter((person) => matches(`${person.name} ${person.detail ?? ""}`, keyword));
  }, [people, keyword]);

  if (chosen) {
    return (
      <div className="person-picked">
        <span><strong>{chosen.name}</strong>{chosen.detail && <small>{chosen.detail}</small>}</span>
        <button type="button" className="text-button" onClick={() => { onSelect(undefined); setKeyword(""); }}>{clearLabel}</button>
      </div>
    );
  }
  if (!people.length) return <p className="form-note">{emptyLabel}</p>;
  return (
    <div className="person-picker">
      <FilterBox value={keyword} onChange={setKeyword} placeholder={placeholder} />
      <ul className="person-options">
        {found.slice(0, 30).map((person) => (
          <li key={person.id}>
            <button type="button" onClick={() => { onSelect(person.id); setKeyword(""); }}>
              <strong>{person.name}</strong>
              {person.detail && <small>{person.detail}</small>}
            </button>
          </li>
        ))}
        {found.length === 0 && <li className="person-none">검색 결과가 없습니다.</li>}
        {found.length > 30 && <li className="person-none">30명까지만 보입니다. 검색어를 더 좁혀 주세요.</li>}
      </ul>
    </div>
  );
}

function useAdminRows(path: string) {
  const [rows, setRows] = useState<AdminRow[]>(emptyRows);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) setRows(await response.json());
    } catch {
      // 목록을 못 받으면 이전 상태를 그대로 둔다. 예시 행으로 채우지 않는다.
    }
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`${apiUrl}${path}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) setRows(await response.json());
      } catch {
        // 위와 같다.
      }
    };
    void load();
    return () => controller.abort();
  }, [path]);
  return { rows, setRows, reload };
}

function AdminItems({
  rows,
  onEdit,
  onDelete,
  selectedId = "",
  emptyLabel = "아직 등록된 항목이 없습니다. 위에서 첫 항목을 만들어 보세요.",
}: {
  rows: AdminRow[];
  onEdit: (row: AdminRow) => void;
  onDelete: (row: AdminRow) => void;
  selectedId?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="admin-items">
      <h3>등록된 항목 {rows.length > 0 && <em>{rows.length}</em>}</h3>
      {rows.length === 0 ? (
        <p className="empty-inline">{emptyLabel}</p>
      ) : (
        rows.map((row) => {
          const published = row.isPublished !== false;
          const when = row.publishedAt ?? row.startsAt ?? row.updatedAt;
          return (
            <div className={`admin-item${selectedId === String(row.id) ? " editing" : ""}`} key={String(row.id)}>
              <div className="admin-item-copy">
                <strong>{String(row.title ?? row.name ?? "항목")}</strong>
                <span>
                  <b className={published ? "badge live" : "badge draft"}>{published ? "공개 중" : "임시 저장"}</b>
                  {row.category ? <i>{String(row.category)}</i> : null}
                  {when ? <time>{listDate(String(when))}</time> : null}
                </span>
              </div>
              <div className="admin-item-actions">
                <button type="button" onClick={() => onEdit(row)}>수정</button>
                <button type="button" className="danger" onClick={() => onDelete(row)}>삭제</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

const listDateFormat = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" });
function listDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : listDateFormat.format(parsed);
}

function ContentPreview({
  title,
  body,
  summary,
  externalUrl,
  showLinkPreview,
}: {
  title: string;
  body: string;
  summary?: string;
  externalUrl?: string;
  showLinkPreview?: boolean;
}) {
  return (
    <section className="admin-live-preview">
      <div className="preview-label">
        <Eye size={15} /> 공개 화면 미리보기
      </div>
      <article className="preview-sheet">
        <p className="article-meta">SHAPE CONTENT</p>
        <h3>{title || "제목을 입력해 주세요"}</h3>
        {summary && <p className="preview-summary">{summary}</p>}
        {body ? (
          <div className="rich-content" dangerouslySetInnerHTML={{ __html: body }} />
        ) : (
          <p>본문을 작성하면 이곳에서 실제 공개 화면과 비슷하게 확인할 수 있습니다.</p>
        )}
        {externalUrl && showLinkPreview && (
          <a className="external-preview" href={externalUrl} target="_blank" rel="noreferrer">
            <small>EXTERNAL LINK</small>
            <strong>{externalUrl}</strong>
            <span>저장하면 이 링크의 영상 또는 기사 미리보기가 만들어집니다</span>
          </a>
        )}
      </article>
    </section>
  );
}

function ContentForm({
  tab,
  endpoint,
  method,
  hint,
  news = false,
  press = false,
  notice = false,
}: {
  tab: string;
  endpoint: string;
  method: "PUT" | "POST";
  hint?: string;
  news?: boolean;
  press?: boolean;
  notice?: boolean;
}) {
  const newsCategory = press ? "언론보도" : "활동";
  const [title, setTitle] = useState(method === "PUT" ? tab : "");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [noticeCategory, setNoticeCategory] = useState("공지");
  const [pinned, setPinned] = useState(false);
  const [linkPreview, setLinkPreview] = useState(true);
  const [published, setPublished] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const { ask, dialogNode } = useAsk();
  const { rows: allRows, reload } = useAdminRows(news ? "/admin/news" : notice ? "/admin/notices" : "");
  // A news tab must only list its own category, otherwise 언론보도 and SHAPE 뉴스
  // show each other's articles and editing one silently moves it.
  const rows = news ? allRows.filter((row) => String(row.category ?? "활동") === newsCategory) : allRows;

  useEffect(() => {
    if (method !== "PUT") return;
    const slug = endpoint.split("/").pop();
    void adminFetch(`/pages/${slug}`).then(async (response) => {
      if (!response.ok) return;
      const page = (await response.json()) as { title?: string; contentHtml?: string };
      setTitle(page.title ?? tab);
      setBody(page.contentHtml ?? "");
    });
  }, [endpoint, method, tab]);

  function reset() {
    setSelectedId("");
    if (method !== "PUT") setTitle("");
    setSummary("");
    setBody(method === "PUT" ? body : "");
    setExternalUrl("");
    setCoverImage("");
    setPinned(false);
    setLinkPreview(true);
    setPublished(true);
  }

  async function submit() {
    if (!title.trim()) {
      setMessage("제목을 입력해 주세요.");
      return;
    }
    const payload = news
      ? {
          title: title.trim(),
          summary: (summary.trim() || title.trim()).slice(0, 2000),
          contentHtml: body,
          contentJson: { linkPreview },
          category: newsCategory,
          coverImage: coverImage || null,
          externalUrl: externalUrl.trim() || null,
          isPublished: published,
        }
      : notice
        ? {
            title: title.trim(),
            contentHtml: body,
            contentJson: {},
            category: noticeCategory,
            isPinned: pinned,
            isPublished: published,
          }
        : { title: title.trim(), contentHtml: body, contentJson: {}, isPublished: published };
    const target = selectedId ? `${endpoint}/${selectedId}` : endpoint;
    const response = await adminSend(target, selectedId ? "PATCH" : method, payload);
    if (!response.ok) {
      setMessage(
        response.status === 0
          ? "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : response.status === 403
            ? "이 항목을 저장할 권한이 없습니다. 운영진에게 권한을 요청해 주세요."
            : "저장하지 못했습니다. 입력한 내용을 확인해 주세요.",
      );
      return;
    }
    setMessage(published ? `${tab}을(를) 저장하고 공개했습니다.` : `${tab}을(를) 임시 저장했습니다.`);
    reset();
    await reload();
  }

  function edit(row: AdminRow) {
    setSelectedId(String(row.id));
    setTitle(String(row.title ?? ""));
    setSummary(String(row.summary ?? ""));
    setBody(String(row.contentHtml ?? ""));
    setExternalUrl(String(row.externalUrl ?? ""));
    setCoverImage(String(row.coverImage ?? ""));
    setNoticeCategory(String(row.category ?? "공지"));
    setPinned(Boolean(row.isPinned));
    setPublished(row.isPublished !== false);
    const json = row.contentJson;
    if (json && typeof json === "object") setLinkPreview((json as { linkPreview?: boolean }).linkPreview ?? true);
  }

  async function remove(row: AdminRow) {
    const confirmed = await ask({ title: "이 글을 삭제할까요?", description: `${String(row.title ?? "선택한 항목")} · 되돌릴 수 없습니다.`, confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    if ((await adminFetch(`${endpoint}/${row.id}`, { method: "DELETE" })).ok) {
      if (selectedId === String(row.id)) reset();
      await reload();
    }
  }

  async function refreshPreview() {
    if (!selectedId) {
      setMessage("먼저 저장한 뒤 미리보기를 새로 만들 수 있습니다.");
      return;
    }
    const response = await adminSend(`/admin/news/${selectedId}/preview`, "POST");
    setMessage(response.ok ? "링크 미리보기를 다시 가져왔습니다." : "링크에서 미리보기를 가져오지 못했습니다.");
    if (response.ok) await reload();
  }

  return (
    <div className="admin-form">
      <p className="form-note">
        {hint ?? "제목과 본문을 채우고 아래 미리보기로 확인한 다음 저장하세요. 글자 크기·색상·목록·링크·이미지는 본문 도구 모음에서 넣을 수 있습니다."}
      </p>
      {selectedId && <EditingBanner title={title} onCancel={reset} />}
      <label>
        제목
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${tab} 제목`} maxLength={200} />
      </label>
      {news && (
        <>
          <label>
            한 줄 요약
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="목록에서 제목 아래에 보일 짧은 소개 (비우면 제목을 그대로 씁니다)"
              maxLength={200}
            />
          </label>
          <ImageUploadField value={coverImage} onChange={setCoverImage} purpose="news" label="대표 이미지" />
          <label>
            외부 링크 (기사 · YouTube · Instagram)
            <input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} type="url" placeholder="https://" />
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={linkPreview} onChange={(event) => setLinkPreview(event.target.checked)} />
            <span>공개 글에 링크 미리보기를 함께 보여주기</span>
          </label>
          <p className="form-note">
            영상·인스타그램 링크는 화면 안에서 바로 재생되고, 기사 링크는 썸네일과 요약이 담긴 미리보기 카드가 자동으로 만들어집니다.
            {selectedId && (
              <button type="button" className="text-button" onClick={refreshPreview}>
                <RefreshCw size={14} /> 미리보기 다시 가져오기
              </button>
            )}
          </p>
        </>
      )}
      {notice && (
        <div className="admin-form-row">
          <label>
            글 종류
            <select value={noticeCategory} onChange={(event) => setNoticeCategory(event.target.value)}>
              <option value="공지">공지</option>
              <option value="질문">질문</option>
              <option value="정보">정보</option>
              <option value="일반">일반</option>
            </select>
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
            <span>목록 맨 위에 &lsquo;중요&rsquo;로 고정</span>
          </label>
        </div>
      )}
      <label>
        본문
        <RichTextEditor value={body} onChange={setBody} />
      </label>
      <PublishChoice value={published} onChange={setPublished} />
      <div className="admin-actions">
        <button type="button" className="button" onClick={submit}>
          {selectedId ? "수정 내용 저장" : published ? "저장하고 공개" : "임시 저장"}
        </button>
        {selectedId && (
          <button type="button" className="button secondary" onClick={reset}>
            취소
          </button>
        )}
        {message && (
          <p className="save-notice" role="status">
            {message}
          </p>
        )}
      </div>
      <ContentPreview title={title} body={body} externalUrl={externalUrl} showLinkPreview={linkPreview} summary={summary} />
      <AdminItems rows={rows} onEdit={edit} onDelete={remove} selectedId={selectedId} />
      {dialogNode}
    </div>
  );
}

function ClubIntroductionForm() {
  const [title, setTitle] = useState("동아리 소개");
  const [body, setBody] = useState("");
  const [facts, setFacts] = useState([
    { value: "2026", label: "창설 연도" },
    { value: "35+", label: "현 부원" },
    { value: "3", label: "핵심 연구 분야" },
  ]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void fetch(`${apiUrl}/pages/club-introduction`)
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json();
        setTitle(page.title || "동아리 소개");
        setBody(page.contentHtml ?? "");
        if (Array.isArray(page.contentJson?.facts))
          setFacts(page.contentJson.facts);
      })
      .catch(() => undefined);
  }, []);
  async function submit() {
    const response = await fetch(`${apiUrl}/admin/pages/club-introduction`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        contentHtml: body,
        contentJson: { facts },
        isPublished: true,
      }),
    });
    setMessage(
      response.ok ? "동아리 소개를 저장했습니다." : "저장하지 못했습니다.",
    );
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        동아리가 무엇을 하는지, 활동 분야와 운영 방식을 쉬운 문장으로 소개해
        주세요.
      </p>
      <label>
        페이지 제목
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        소개 본문
        <RichTextEditor value={body} onChange={setBody} />
      </label>
      <div className="fact-editor">
        <div>
          <strong>숫자 정보</strong>
          <button
            type="button"
            onClick={() =>
              setFacts((current) => [...current, { value: "", label: "" }])
            }
          >
            <Plus size={15} /> 항목 추가
          </button>
        </div>
        {facts.map((fact, index) => (
          <div className="fact-row" key={index}>
            <input
              value={fact.value}
              placeholder="예: 35+"
              onChange={(event) =>
                setFacts((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              value={fact.label}
              placeholder="예: 현 부원"
              onChange={(event) =>
                setFacts((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, label: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label="항목 삭제"
              onClick={() =>
                setFacts((current) => current.filter((_, i) => i !== index))
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button className="button" type="button" onClick={submit}>
        동아리 소개 저장 및 공개
      </button>
      {message && <p className="save-notice">{message}</p>}
      <ContentPreview title={title} body={body} />
    </div>
  );
}

function MembersForm() {
  const [members, setMembers] = useState<ShapeMember[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void adminFetch("/admin/directory").then(async (response) => {
      if (response.ok) setDirectory((await response.json()) as DirectoryUser[]);
    });
  }, []);
  useEffect(() => {
    void fetch(`${apiUrl}/pages/members`)
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json();
        const stored = page.contentJson?.members ?? page.content_json?.members;
        if (Array.isArray(stored) && stored.length) setMembers(stored);
      })
      .catch(() => undefined);
  }, []);
  const update = (index: number, patch: Partial<ShapeMember>) =>
    setMembers((current) =>
      current.map((member, i) =>
        i === index ? { ...member, ...patch } : member,
      ),
    );
  async function submit() {
    try {
      const response = await fetch(`${apiUrl}/admin/pages/members`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "부원",
          contentHtml: "",
          contentJson: { members },
          isPublished: true,
        }),
      });
      setMessage(
        response.ok
          ? "부원 카드를 저장했습니다."
          : "저장하지 못했습니다. 콘텐츠 관리 권한을 확인해 주세요.",
      );
    } catch {
      setMessage(
        "개발 미리보기에서 부원 카드 편집 상태를 확인 중입니다. 실제 저장은 백엔드 연결 후 반영됩니다.",
      );
    }
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        부원 한 명을 카드 하나로 관리합니다. 회원 구분(준회원·정회원·알럼·멤버)은 공개 페이지의 필터에 그대로 쓰입니다.
        구글 로그인 계정이 있는 부원은 아래에서 계정을 연결해 주세요.
      </p>
      <div className="member-admin-list">
        {members.map((member, index) => (
          <fieldset className="member-admin-card" key={member.id}>
            <legend>
              {String(index + 1).padStart(2, "0")} · {member.name || "새 부원"}
            </legend>
            <ImageUploadField
              purpose="members"
              label="부원 사진"
              value={member.imageUrl ?? ""}
              onChange={(imageUrl) => update(index, { imageUrl })}
            />
            <div className="admin-form-row">
              <label>
                이름
                <input
                  value={member.name}
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                />
              </label>
              <label>
                팀
                <select
                  value={member.team}
                  onChange={(event) =>
                    update(index, {
                      team: event.target.value as ShapeMember["team"],
                    })
                  }
                >
                  <option>Management</option>
                  <option>Manipulation</option>
                  <option>Navigation</option>
                  <option>Reasoning</option>
                  <option>미배정</option>
                </select>
              </label>
            </div>
            <div className="admin-form-row">
              <label>
                회원 구분
                <select value={member.membership ?? "정회원"} onChange={(event) => update(index, { membership: event.target.value as ShapeMember["membership"] })}>
                  <option>준회원</option><option>정회원</option><option>알럼</option><option>멤버</option>
                </select>
              </label>
              <label>
                역할
                <input
                  value={member.role}
                  onChange={(event) =>
                    update(index, { role: event.target.value })
                  }
                />
              </label>
              <label>
                소속
                <input
                  value={member.affiliation}
                  onChange={(event) =>
                    update(index, { affiliation: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="field-block">
              <span className="field-label">연결할 계정</span>
              <PersonPicker
                people={directory.map((person) => ({ id: person.id, name: person.name, detail: person.email }))}
                value={member.userId}
                onSelect={(id) => update(index, { userId: id })}
                placeholder="이름이나 이메일로 검색"
                emptyLabel="승인된 회원이 아직 없습니다."
                clearLabel="연결 해제"
              />
            </div>
            <p className="form-note">
              계정을 연결하면 이 카드의 <b>사진과 소개말</b>은 본인이 마이페이지에서 설정한 값으로 표시되고,
              카드를 누르면 참여 중인 프로젝트가 함께 보입니다. 운영진은 이름·팀·역할·소속만 관리합니다.
            </p>
            <button
              type="button"
              className="text-button danger"
              onClick={() =>
                setMembers((current) => current.filter((_, i) => i !== index))
              }
            >
              <Trash2 size={15} /> 부원 삭제
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        className="add-team"
        onClick={() =>
          setMembers((current) => [
            ...current,
            {
              id: `member-${Date.now()}`,
              name: "",
              team: "Management",
              role: "팀원",
              affiliation: "서울대학교",
              membership: "준회원",
            },
          ])
        }
      >
        <Plus size={16} /> 부원 추가
      </button>
      <button className="button" type="button" onClick={submit}>
        부원 카드 저장 및 공개
      </button>
      {message && <p className="save-notice">{message}</p>}
      <section className="admin-live-preview">
        <div className="preview-label">
          <Eye size={15} /> 공개 화면 미리보기
        </div>
        <MemberDirectory members={members} />
      </section>
    </div>
  );
}

function TeamEditor({
  title,
  value,
  onChange,
  members = [],
}: {
  title: string;
  value: OrganizationTeam[];
  onChange: (next: OrganizationTeam[]) => void;
  members?: ShapeMember[];
}) {
  const update = (index: number, patch: Partial<OrganizationTeam>) =>
    onChange(
      value.map((team, i) => (i === index ? { ...team, ...patch } : team)),
    );
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="team-editor">
      <legend>{title}</legend>
      {value.map((team, index) => (
        <div className="team-editor-card" key={`${team.name}-${index}`}>
          <div className="team-editor-card-head">
            <strong>
              {String(index + 1).padStart(2, "0")} · {team.name || "새 팀"}
            </strong>
            <div>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="팀을 위로 이동"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === value.length - 1}
                aria-label="팀을 아래로 이동"
              >
                <ArrowDown size={15} />
              </button>
            </div>
          </div>
          <div className="admin-form-row">
            <label>
              팀명
              <input
                value={team.name}
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
              />
            </label>
            <label>
              구성 / 역할
              <input
                value={team.role}
                onChange={(event) =>
                  update(index, { role: event.target.value })
                }
              />
            </label>
          </div>
          <label>
            담당 업무 (줄바꿈으로 여러 업무 입력)
            <textarea
              value={team.work.join("\n")}
              onChange={(event) =>
                update(index, {
                  work: event.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="field-block">
            <span className="field-label">연결된 부원</span>
            <PersonPicker
              people={members.filter((member) => !(team.memberIds ?? []).includes(member.id)).map((member) => ({ id: member.id, name: member.name, detail: `${member.membership ?? "정회원"} · ${member.team}` }))}
              onSelect={(id) => { if (id) update(index, { memberIds: [...(team.memberIds ?? []), id] }); }}
              placeholder="부원 이름으로 검색"
              emptyLabel="연결할 부원이 없습니다."
              clearLabel="해제"
            />
          </div>
          {team.memberIds?.length ? <div className="org-editor-tags">{team.memberIds.map((id) => <button type="button" key={id} onClick={() => update(index, { memberIds: team.memberIds?.filter((memberId) => memberId !== id) })}>{members.find((member) => member.id === id)?.name ?? id} ×</button>)}</div> : null}
          <button
            type="button"
            className="text-button danger"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 size={15} /> 이 팀 삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        className="add-team"
        onClick={() => onChange([...value, { name: "", role: "", work: [], memberIds: [] }])}
      >
        <Plus size={16} /> 팀 추가
      </button>
    </fieldset>
  );
}

function OrganizationForm() {
  const [data, setData] = useState<OrganizationData>(defaultOrganization);
  const [members, setMembers] = useState<ShapeMember[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void fetch(`${apiUrl}/pages/organization`)
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json();
        const json = page.contentJson ?? page.content_json;
        if (json?.operationTeams) setData(json);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    void fetch(`${apiUrl}/pages/members`).then(async (response) => {
      if (!response.ok) return;
      const page = await response.json();
      const stored = page.contentJson?.members ?? page.content_json?.members;
      if (Array.isArray(stored)) setMembers(stored);
    }).catch(() => undefined);
  }, []);
  async function submit() {
    const response = await fetch(`${apiUrl}/admin/pages/organization`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "조직도",
        contentHtml: "",
        contentJson: data,
        isPublished: true,
      }),
    });
    setMessage(
      response.ok ? "조직도를 저장했습니다." : "조직도를 저장하지 못했습니다.",
    );
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        운영 조직과 프로젝트 팀은 구분하지 않고 한 조직도에 함께 표시됩니다. 연결할
        부원을 선택하면 해당 카드의 이름과 공개 프로필이 조직도에 자동 연결됩니다.
      </p>
      <div className="admin-form-row">
        <label>
          지도교수 표기
          <input
            value={data.advisor}
            onChange={(event) =>
              setData({ ...data, advisor: event.target.value })
            }
          />
        </label>
        <label>
          회장단 표기
          <input
            value={data.leadership}
            onChange={(event) =>
              setData({ ...data, leadership: event.target.value })
            }
          />
        </label>
      </div>
      <TeamEditor title="조직 팀" value={[...data.operationTeams, ...(data.projectTeams ?? [])]} onChange={(operationTeams) => setData({ ...data, operationTeams, projectTeams: [] })} members={members} />
      <button className="button" type="button" onClick={submit}>
        조직도 저장 및 공개
      </button>
      {message && <p className="save-notice">{message}</p>}
      <section className="admin-live-preview">
        <div className="preview-label">
          <Eye size={15} /> 공개 화면 미리보기
        </div>
        <OrganizationChart data={data} memberNames={Object.fromEntries(members.map((member) => [member.id, member.name]))} />
      </section>
    </div>
  );
}

function UnitEditor({ equipment, onChanged }: { equipment: AdminEquipmentItem; onChanged: () => void }) {
  const { ask, dialogNode } = useAsk();
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  async function add() {
    if (!label.trim()) {
      setMessage("호기 이름을 입력해 주세요.");
      return;
    }
    const response = await adminSend(`/admin/equipment/${equipment.id}/units`, "POST", { label: label.trim(), status: "ACTIVE" });
    setMessage(response.ok ? "" : "호기를 추가하지 못했습니다.");
    if (response.ok) {
      setLabel("");
      onChanged();
    }
  }
  async function setStatus(unitId: string, unitLabel: string, status: string) {
    if ((await adminSend(`/admin/equipment/units/${unitId}`, "PATCH", { label: unitLabel, status })).ok) onChanged();
  }
  async function remove(unitId: string) {
    const confirmed = await ask({ title: "이 호기를 삭제할까요?", description: "예약 이력이 있으면 삭제가 거절됩니다. 그럴 때는 상태를 '점검 중'으로 바꿔 주세요.", confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    const response = await adminFetch(`/admin/equipment/units/${unitId}`, { method: "DELETE" });
    setMessage(response.ok ? "" : "예약 이력이 있는 호기는 삭제할 수 없습니다. 점검 중으로 바꿔 주세요.");
    if (response.ok) onChanged();
  }
  return (
    <div className="unit-editor">
      <strong>{equipment.name} 개별 호기</strong>
      <p className="form-note">호기를 한 대 이상 등록해야 회원이 이 장비를 예약할 수 있습니다.</p>
      {equipment.units.length ? (
        <ul>
          {equipment.units.map((unit) => (
            <li key={unit.id}>
              <span>{unit.label}</span>
              <select value={unit.status} onChange={(event) => setStatus(unit.id, unit.label, event.target.value)}>
                <option value="ACTIVE">예약 가능</option>
                <option value="MAINTENANCE">점검 중</option>
                <option value="INACTIVE">운영 중지</option>
              </select>
              <button type="button" className="text-button danger" onClick={() => remove(unit.id)}>
                <Trash2 size={14} /> 삭제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">등록된 호기가 없습니다.</p>
      )}
      <div className="unit-add">
        <input value={label} placeholder={`예: ${equipment.name} 1호기`} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
        <button type="button" className="text-button" onClick={add}>
          <Plus size={15} /> 호기 추가
        </button>
      </div>
      {message && <p className="save-notice">{message}</p>}
      {dialogNode}
    </div>
  );
}

function EquipmentForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [unit, setUnit] = useState(30);
  const [status, setStatus] = useState("ACTIVE");
  const [sortOrder, setSortOrder] = useState(0);
  const [licenseIds, setLicenseIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [licenses, setLicenses] = useState<LicenseItem[]>([]);
  const { ask, dialogNode } = useAsk();
  const { rows, setRows, reload } = useAdminRows("/admin/equipment");
  const items = rows as unknown as AdminEquipmentItem[];
  const selected = items.find((item) => String(item.id) === selectedId);
  useEffect(() => {
    void adminFetch("/admin/licenses")
      .then(async (response) => {
        if (response.ok) setLicenses((await response.json()) as LicenseItem[]);
      })
      .catch(() => undefined);
  }, []);
  function reset() {
    setSelectedId("");
    setName("");
    setCategory("");
    setDescription("");
    setImageUrl("");
    setUnit(30);
    setStatus("ACTIVE");
    setSortOrder(0);
    setLicenseIds([]);
  }
  async function submit() {
    if (!name.trim() || !category.trim()) {
      setMessage("장비명과 분류를 입력해 주세요.");
      return;
    }
    const target = selectedId ? `/admin/equipment/${selectedId}` : "/admin/equipment";
    const payload = { name, category, description, imageUrl: imageUrl || null, status, reservationUnitMinutes: unit, sortOrder };
    const response = await adminSend(target, selectedId ? "PATCH" : "POST", payload).catch(() => null);
    if (!response?.ok) {
      setMessage(response?.status === 409 ? "같은 이름의 장비가 이미 있습니다." : "저장하지 못했습니다. 로그인과 권한을 확인해 주세요.");
      return;
    }
    // The licence requirement is a separate resource, so it is written right
    // after the equipment row exists.
    const id = selectedId || String(((await response.json()) as { id: string }).id);
    await adminSend(`/admin/equipment/${id}/licenses`, "PUT", { licenseIds });
    setMessage(`장비를 ${selectedId ? "수정" : "등록"}했습니다.`);
    reset();
    await reload();
  }
  function edit(row: AdminRow) {
    const item = row as unknown as AdminEquipmentItem;
    setSelectedId(String(item.id));
    setName(item.name ?? "");
    setCategory(item.category ?? "");
    setDescription(item.description ?? "");
    setImageUrl(item.imageUrl ?? "");
    setUnit(Number(item.reservationUnitMinutes ?? 30));
    setStatus(item.status ?? "ACTIVE");
    setSortOrder(Number(item.sortOrder ?? 0));
    setLicenseIds((item.requiredLicenseIds ?? []).map(String));
  }
  async function remove(row: AdminRow) {
    const confirmed = await ask({ title: "이 장비를 삭제할까요?", description: `${String(row.name ?? "선택한 장비")} · 관련 예약이 있으면 삭제가 거절됩니다. 그럴 때는 '운영 중지'로 바꿔 주세요.`, confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    const response = await adminFetch(`/admin/equipment/${row.id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      if (selectedId === String(row.id)) reset();
      await reload();
      return;
    }
    if (response) {
      setMessage("예약 이력이 있는 장비는 삭제할 수 없습니다. 운영 중지로 변경해 주세요.");
      return;
    }
    setRows((current) => current.filter((item) => String(item.id) !== String(row.id)));
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        장비를 등록한 다음 아래에서 <b>개별 호기</b>를 한 대 이상 추가해야 회원이 예약할 수 있습니다. 사진은 10MB 이하만 올라갑니다.
      </p>
      {selectedId && <EditingBanner title={name} onCancel={reset} />}
      <label>
        장비명
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
      </label>
      <label>
        분류
        <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="예: 3D 프린터" maxLength={80} />
      </label>
      <ImageUploadField value={imageUrl} onChange={setImageUrl} />
      <label>
        장비 상세 설명
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="용도, 주요 사양, 사용 전 확인 사항을 입력해 주세요. 공개 상세 페이지에 그대로 표시됩니다."
        />
      </label>
      <div className="admin-form-row">
        <label>
          상태
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ACTIVE">예약 가능</option>
            <option value="MAINTENANCE">점검 중</option>
            <option value="INACTIVE">운영 중지</option>
          </select>
        </label>
        <label>
          예약 단위
          <select value={unit} onChange={(event) => setUnit(Number(event.target.value))}>
            <option value={30}>30분</option>
            <option value={60}>60분</option>
            <option value={90}>90분</option>
            <option value={120}>120분</option>
          </select>
        </label>
        <label>
          노출 순서
          <input type="number" min={0} max={999} value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} />
        </label>
      </div>
      <fieldset className="license-picker">
        <legend>예약에 필요한 라이선스</legend>
        {licenses.length ? (
          licenses.map((license) => (
            <label key={license.id} className="toggle-field">
              <input
                type="checkbox"
                checked={licenseIds.includes(license.id)}
                onChange={(event) =>
                  setLicenseIds((current) =>
                    event.target.checked ? [...current, license.id] : current.filter((id) => id !== license.id),
                  )
                }
              />
              <span>{license.name}</span>
            </label>
          ))
        ) : (
          <p className="form-note">먼저 라이선스 탭에서 교육 항목을 등록해 주세요.</p>
        )}
      </fieldset>
      <p className="form-note">모든 장비의 예약 가능 시간은 00:00–24:00으로 고정됩니다.</p>
      <div className="admin-actions">
        <button className="button" type="button" onClick={submit}>
          {selectedId ? "장비 수정" : "장비 등록"}
        </button>
        {selectedId && (
          <button className="button secondary" type="button" onClick={reset}>
            취소
          </button>
        )}
        {message && <p className="save-notice" role="status">{message}</p>}
      </div>
      {selected && <UnitEditor equipment={selected} onChanged={reload} />}
      <ContentPreview title={name} body={`<p>${description || "장비 설명이 여기에 표시됩니다."}</p>`} />
      <AdminItems rows={rows} onEdit={edit} onDelete={remove} selectedId={selectedId} emptyLabel="등록된 장비가 없습니다. 첫 장비를 등록해 주세요." />
      {dialogNode}
    </div>
  );
}

function RoadmapForm({ fixedCategory }: { fixedCategory?: string }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(fixedCategory ?? "SHAPE-UP");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [published, setPublished] = useState(true);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const { ask, dialogNode } = useAsk();
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const {
    rows: allRows,
    setRows,
    reload,
  } = useAdminRows("/admin/roadmap");
  useEffect(() => {
    void adminFetch("/admin/directory").then(async (response) => {
      if (response.ok) setDirectory((await response.json()) as DirectoryUser[]);
    });
  }, []);
  const rows = fixedCategory
    ? allRows.filter((row) => row.category === fixedCategory)
    : allRows;
  async function submit() {
    if (!startsAt) {
      setMessage("시작 날짜를 입력해 주세요.");
      return;
    }
    const target = selectedId
      ? `/admin/roadmap/${selectedId}`
      : "/admin/roadmap";
    const payload = {
      title,
      category,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      description,
      isPublished: published,
      memberIds,
    };
    try {
      const response = await fetch(`${apiUrl}${target}`, {
        method: selectedId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMessage(
        response.ok ? "일정을 저장했습니다." : "일정을 저장하지 못했습니다.",
      );
      if (response.ok) {
        setSelectedId("");
        setMemberIds([]);
        await reload();
      }
    } catch {
      const local = {
        id: selectedId || `unsaved-${Date.now()}`,
        ...payload,
      };
      setRows((current) =>
        selectedId
          ? current.map((row) => (String(row.id) === selectedId ? local : row))
          : [...current, local],
      );
      setMessage(
        "개발 미리보기 일정에 반영했습니다. 백엔드 연결 후에는 실제 저장됩니다.",
      );
      setSelectedId("");
    }
  }
  const inputDate = (value: unknown) =>
    value ? new Date(String(value)).toISOString().slice(0, 16) : "";
  function edit(row: AdminRow) {
    setSelectedId(String(row.id));
    setTitle(String(row.title ?? ""));
    setCategory(String(row.category ?? fixedCategory ?? "SHAPE-UP"));
    setDescription(String(row.description ?? ""));
    setStartsAt(inputDate(row.starts_at ?? row.startsAt));
    setEndsAt(inputDate(row.ends_at ?? row.endsAt));
    setPublished(row.isPublished !== false);
    setMemberIds(((row as unknown as AdminRoadmapItem).memberIds ?? []).map(String));
  }
  async function remove(row: AdminRow) {
    const confirmed = await ask({ title: "이 일정을 삭제할까요?", description: `${String(row.title ?? "선택한 일정")} · 배정된 참여 부원도 함께 해제됩니다.`, confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    try {
      if (
        (
          await fetch(`${apiUrl}/admin/roadmap/${row.id}`, {
            method: "DELETE",
            credentials: "include",
          })
        ).ok
      )
        await reload();
    } catch {
      setRows((current) =>
        current.filter((item) => String(item.id) !== String(row.id)),
      );
    }
  }
  return (
    <div className="admin-form">
      {selectedId && <EditingBanner title={title} onCancel={() => { setSelectedId(""); setMemberIds([]); setTitle(""); setDescription(""); }} />}
      <label>
        일정명
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        영역
        <select
          value={category}
          disabled={Boolean(fixedCategory)}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option>SHAPE-UP</option>
          <option>대회</option>
          <option>교육</option>
          <option>기타</option>
        </select>
      </label>
      <div className="admin-form-row">
        <label>
          시작
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label>
          종료
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </label>
      </div>
      <label>
        설명
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <fieldset className="license-picker">
        <legend>참여 부원</legend>
        <p className="form-note">
          선택한 부원의 마이페이지에 이 프로젝트가 &ldquo;참여 중인 프로젝트&rdquo;로 표시됩니다.
        </p>
        {directory.length ? (
          <>
            {/* 고른 사람은 검색과 무관하게 항상 위에 남는다. 검색으로 목록이
                좁아진 사이에 누구를 넣어 두었는지 놓치지 않도록. */}
            {memberIds.length > 0 && (
              <div className="picked-tags">
                {memberIds.map((id) => (
                  <button type="button" key={id} onClick={() => setMemberIds((current) => current.filter((each) => each !== id))}>
                    {directory.find((person) => person.id === id)?.name ?? id} ×
                  </button>
                ))}
              </div>
            )}
            <FilterBox value={memberQuery} onChange={setMemberQuery} placeholder="이름이나 이메일로 검색" count={memberIds.length} />
            <div className="permission-grid">
              {directory
                .filter((person) => !memberQuery.trim() || matches(`${person.name} ${person.email}`, memberQuery))
                .map((person) => (
                  <label className="toggle-field" key={person.id}>
                    <input
                      type="checkbox"
                      checked={memberIds.includes(person.id)}
                      onChange={(event) =>
                        setMemberIds((current) =>
                          event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                        )
                      }
                    />
                    <span>{person.name}</span>
                  </label>
                ))}
            </div>
          </>
        ) : (
          <p className="form-note">승인된 회원이 아직 없습니다.</p>
        )}
      </fieldset>
      <PublishChoice value={published} onChange={setPublished} />
      <div className="admin-actions">
        <button className="button" type="button" onClick={submit}>
          {selectedId ? "일정 수정" : published ? "일정 등록하고 공개" : "일정 임시 저장"}
        </button>
        {selectedId && (
          <button
            className="button secondary"
            type="button"
            onClick={() => { setSelectedId(""); setMemberIds([]); setTitle(""); setDescription(""); }}
          >
            취소
          </button>
        )}
        {message && <p className="save-notice" role="status">{message}</p>}
      </div>
      <AdminItems rows={rows} onEdit={edit} onDelete={remove} selectedId={selectedId} emptyLabel="등록된 일정이 없습니다. 위에서 첫 일정을 추가해 보세요." />
      {dialogNode}
    </div>
  );
}

function LinkForm() {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [published, setPublished] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const { ask, dialogNode } = useAsk();
  const { rows, reload } = useAdminRows("/admin/links");
  function reset() {
    setSelectedId(""); setTitle(""); setUrl(""); setDescription(""); setSortOrder(0); setPublished(true);
  }
  async function submit() {
    if (!title.trim() || !/^https?:\/\//.test(url.trim())) {
      setMessage("링크 이름과 http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.");
      return;
    }
    const target = selectedId ? `/admin/links/${selectedId}` : "/admin/links";
    const response = await adminSend(target, selectedId ? "PATCH" : "POST", {
      title: title.trim(), url: url.trim(), description, sortOrder, isPublished: published,
    });
    setMessage(response.ok ? "링크를 저장했습니다." : "저장하지 못했습니다. 주소 형식과 권한을 확인해 주세요.");
    if (response.ok) {
      reset();
      await reload();
    }
  }
  function edit(row: AdminRow) {
    setSelectedId(String(row.id));
    setTitle(String(row.title ?? ""));
    setUrl(String(row.url ?? ""));
    setDescription(String(row.description ?? ""));
    setSortOrder(Number(row.sortOrder ?? 0));
    setPublished(row.isPublished !== false);
  }
  async function remove(row: AdminRow) {
    const confirmed = await ask({ title: "이 링크를 삭제할까요?", description: `${String(row.title ?? "선택한 링크")} · 공개 페이지에서 즉시 사라집니다.`, confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    if ((await adminFetch(`/admin/links/${row.id}`, { method: "DELETE" })).ok) {
      if (selectedId === String(row.id)) reset();
      await reload();
    }
  }
  return (
    <div className="admin-form">
      {selectedId && <EditingBanner title={title} onCancel={reset} />}
      <label>
        링크명
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        URL
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
        />
      </label>
      <div className="admin-form-row">
        <label>
          설명
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="이 링크에 무엇이 있는지 한 줄로 적어 주세요." />
        </label>
        <label>
          노출 순서
          <input type="number" min={0} max={999} value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} />
        </label>
      </div>
      <PublishChoice value={published} onChange={setPublished} />
      <div className="admin-actions">
        <button className="button" type="button" onClick={submit}>
          {selectedId ? "링크 수정" : published ? "링크 등록하고 공개" : "링크 임시 저장"}
        </button>
        {selectedId && <button className="button secondary" type="button" onClick={reset}>취소</button>}
        {message && <p className="save-notice" role="status">{message}</p>}
      </div>
      <ContentPreview
        title={title}
        body={`<p>${description}</p>`}
        externalUrl={url}
        showLinkPreview
      />
      <AdminItems rows={rows} onEdit={edit} onDelete={remove} selectedId={selectedId} emptyLabel="등록된 링크가 없습니다. Drive·Notion 주소를 추가해 보세요." />
      {dialogNode}
    </div>
  );
}

const reservationStatusLabel: Record<string, string> = {
  PENDING: "승인 대기",
  APPROVED: "예약 확정",
  REJECTED: "반려",
  CANCELLED: "취소",
  IN_USE: "사용 중",
  COMPLETED: "사용 완료",
};
const memberStatusLabel: Record<MemberStatus, string> = {
  PENDING: "승인 대기",
  APPROVED: "정상",
  REJECTED: "거절",
  SUSPENDED: "정지",
};
const permissionLabels: [string, string][] = [
  ["content:manage", "동아리 소개·부원"],
  ["news:manage", "뉴스·언론보도"],
  ["notices:manage", "게시판"],
  ["equipment:manage", "장비·라이선스"],
  ["reservations:manage", "예약 승인"],
  ["roadmap:manage", "로드맵"],
  ["links:manage", "관련 링크"],
];
const moment = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

function LicenseManager() {
  const { ask, dialogNode } = useAsk();
  const [licenses, setLicenses] = useState<LicenseItem[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const reload = useCallback(async () => {
    const response = await adminFetch("/admin/licenses").catch(() => null);
    if (response?.ok) setLicenses((await response.json()) as LicenseItem[]);
    else setMessage("라이선스 목록을 불러오려면 장비 관리 권한이 필요합니다.");
  }, []);
  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);
  async function submit() {
    if (!name.trim()) {
      setMessage("라이선스 이름을 입력해 주세요.");
      return;
    }
    const target = selectedId ? `/admin/licenses/${selectedId}` : "/admin/licenses";
    const response = await adminSend(target, selectedId ? "PATCH" : "POST", { name: name.trim(), description: description || null, isActive: true }).catch(() => null);
    if (!response?.ok) {
      setMessage(response?.status === 409 ? "같은 이름의 라이선스가 이미 있습니다." : "저장하지 못했습니다.");
      return;
    }
    setMessage(selectedId ? "라이선스를 수정했습니다." : "라이선스를 등록했습니다.");
    setSelectedId("");
    setName("");
    setDescription("");
    await reload();
  }
  async function remove(license: LicenseItem) {
    const confirmed = await ask({ title: "이 라이선스를 삭제할까요?", description: `${license.name} · 부원에게 부여된 이력과 장비 조건도 함께 사라집니다.`, confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    if ((await adminFetch(`/admin/licenses/${license.id}`, { method: "DELETE" })).ok) await reload();
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        라이선스는 장비 예약의 사전 조건입니다. 여기에서 교육 항목을 만들고, 보유 장비 탭에서 장비에 연결한 뒤, 회원 및 권한 탭에서 부원에게 부여합니다.
      </p>
      <label>
        라이선스 이름
        <input value={name} maxLength={120} placeholder="예: 로봇 안전 교육" onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        설명
        <textarea value={description} maxLength={2000} placeholder="이수 조건과 교육 방식을 적어 주세요." onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="admin-actions">
        <button className="button" type="button" onClick={submit}>
          {selectedId ? "라이선스 수정" : "라이선스 등록"}
        </button>
        {selectedId && (
          <button className="button secondary" type="button" onClick={() => { setSelectedId(""); setName(""); setDescription(""); }}>
            취소
          </button>
        )}
        {message && <p className="save-notice" role="status">{message}</p>}
      </div>
      {selectedId && <EditingBanner title={name} onCancel={() => { setSelectedId(""); setName(""); setDescription(""); }} />}
      {licenses.length ? (
        <div className="admin-items">
          <h3>등록된 라이선스 <em>{licenses.length}</em></h3>
          {licenses.map((license) => (
            <div className={`admin-item${selectedId === license.id ? " editing" : ""}`} key={license.id}>
              <div className="admin-item-copy">
                <strong>{license.name}</strong>
                {license.description && <span>{license.description}</span>}
              </div>
              <div className="admin-item-actions">
                <button type="button" onClick={() => { setSelectedId(license.id); setName(license.name); setDescription(license.description ?? ""); }}>
                  수정
                </button>
                <button type="button" className="danger" onClick={() => remove(license)}>
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>등록된 라이선스가 없습니다</h2>
          <p>첫 교육 항목을 만들면 장비 예약 조건으로 사용할 수 있습니다.</p>
        </div>
      )}
      {dialogNode}
    </div>
  );
}

function ReservationsPanel() {
  const { ask, dialogNode } = useAsk();
  const [rows, setRows] = useState<AdminReservationItem[] | null>(null);
  const [filter, setFilter] = useState("PENDING");
  const [message, setMessage] = useState("");
  const reload = useCallback(async () => {
    const query = filter === "ALL" ? "" : `?status=${filter}`;
    const response = await adminFetch(`/admin/reservations${query}`).catch(() => null);
    if (!response) {
      setMessage("백엔드 서버에 연결하지 못했습니다.");
      setRows([]);
      return;
    }
    if (!response.ok) {
      setMessage("목록을 확인하려면 예약 관리 권한이 필요합니다.");
      setRows([]);
      return;
    }
    setMessage("");
    setRows((await response.json()) as AdminReservationItem[]);
  }, [filter]);
  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
  }, [reload]);
  async function decide(row: AdminReservationItem, approve: boolean) {
    let reason: string | null = null;
    if (approve) {
      const confirmed = await ask({
        title: "이 예약을 승인할까요?",
        description: `${row.equipmentName} ${row.unitLabel} · ${row.userName} 님의 신청입니다. 승인하면 그 시간이 다른 회원에게 확정 예약으로 표시됩니다.`,
        confirmLabel: "승인",
      });
      if (confirmed === null) return;
    } else {
      reason = await ask({
        title: "예약을 반려합니다",
        description: `${row.userName} 님에게 그대로 전달되니, 다음에 어떻게 신청하면 되는지 함께 적어 주세요.`,
        confirmLabel: "반려",
        tone: "danger",
        field: { label: "반려 사유", multiline: true, required: true, defaultValue: "", placeholder: "예: 같은 시간에 교육 트랙 실습이 예정되어 있습니다. 오후 시간대로 다시 신청해 주세요." },
      });
      if (reason === null) return;
    }
    const response = await adminSend(`/admin/reservations/${row.id}/decision`, "POST", { approve, reason });
    setMessage(response.ok ? (approve ? "승인했습니다." : "반려했습니다.") : "처리하지 못했습니다. 같은 시간에 확정된 예약이 있는지 확인해 주세요.");
    if (response.ok) await reload();
  }
  async function cancel(row: AdminReservationItem) {
    const reason = await ask({
      title: "확정된 예약을 취소합니다",
      description: `${row.equipmentName} ${row.unitLabel} · ${row.userName} 님의 예약입니다. 취소하면 그 시간이 다시 열립니다.`,
      confirmLabel: "예약 취소",
      tone: "danger",
      field: { label: "취소 사유", multiline: true, required: true, placeholder: "예: 장비 긴급 점검이 잡혀 사용이 어렵습니다." },
    });
    if (reason === null) return;
    const response = await adminSend(`/admin/reservations/${row.id}/cancel`, "POST", { approve: false, reason });
    setMessage(response.ok ? "예약을 취소하고 시간을 다시 열었습니다." : "취소하지 못했습니다.");
    if (response.ok) await reload();
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        승인하면 해당 시간이 다른 회원에게 확정 예약으로 표시되고, 데이터베이스가 중복 슬롯을 차단합니다. 사용 전후 사진은 회원이 올린 그대로 확인할 수 있습니다.
      </p>
      <div className="board-filter" aria-label="예약 상태 필터">
        {["PENDING", "APPROVED", "IN_USE", "COMPLETED", "ALL"].map((value) => (
          <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {value === "ALL" ? "전체" : reservationStatusLabel[value]}
          </button>
        ))}
      </div>
      {message && <p className="save-notice">{message}</p>}
      {rows === null ? (
        <p className="form-note">예약 목록을 불러오는 중입니다.</p>
      ) : rows.length ? (
        <div className="admin-reservations">
          {rows.map((row) => (
            <article key={row.id}>
              <header>
                <div>
                  <strong>{row.equipmentName || "장비"}{row.unitLabel ? ` · ${row.unitLabel}` : ""}</strong>
                  <p>{moment.format(new Date(row.startsAt))} — {moment.format(new Date(row.endsAt))}</p>
                </div>
                <span className={`reservation-status ${row.status.toLowerCase()}`}>{reservationStatusLabel[row.status]}</span>
              </header>
              <p className="reservation-purpose">{row.purpose}</p>
              <p className="form-note">
                {row.userName} · {row.userEmail}
                {row.rejectionReason ? ` · 사유: ${row.rejectionReason}` : ""}
              </p>
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
                    <button className="button small" type="button" onClick={() => decide(row, true)}>
                      승인
                    </button>
                    <button className="button secondary small" type="button" onClick={() => decide(row, false)}>
                      반려
                    </button>
                  </>
                )}
                {(row.status === "PENDING" || row.status === "APPROVED") && (
                  <button className="text-button danger" type="button" onClick={() => cancel(row)}>
                    예약 취소
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
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

function MembersPanel({ owner }: { owner: boolean }) {
  const [rows, setRows] = useState<AdminUserItem[] | null>(null);
  const [licenses, setLicenses] = useState<LicenseItem[]>([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const reload = useCallback(async () => {
    const response = await adminFetch("/admin/users").catch(() => null);
    if (!response?.ok) {
      setMessage(response ? "회원 관리는 Owner만 수행할 수 있습니다." : "백엔드 서버에 연결하지 못했습니다.");
      setRows([]);
      return;
    }
    setMessage("");
    setRows((await response.json()) as AdminUserItem[]);
  }, []);
  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
    void adminFetch("/admin/licenses")
      .then(async (response) => {
        if (response.ok) setLicenses((await response.json()) as LicenseItem[]);
      })
      .catch(() => undefined);
  }, [reload]);
  async function setStatus(user: AdminUserItem, status: MemberStatus) {
    const response = await adminSend(`/admin/users/${user.id}/status`, "PATCH", { status });
    setMessage(response.ok ? `${user.name} 회원 상태를 ${memberStatusLabel[status]}(으)로 바꿨습니다.` : "상태를 바꾸지 못했습니다.");
    if (response.ok) await reload();
  }
  async function togglePermission(user: AdminUserItem, permission: string, granted: boolean) {
    const response = granted
      ? await adminFetch(`/admin/users/${user.id}/permissions/${encodeURIComponent(permission)}`, { method: "DELETE" })
      : await adminSend(`/admin/users/${user.id}/permissions`, "POST", { permission });
    setMessage(response.ok ? "권한을 변경했습니다." : "권한을 변경하지 못했습니다.");
    if (response.ok) await reload();
  }
  async function toggleLicense(user: AdminUserItem, licenseId: string, granted: boolean) {
    const response = granted
      ? await adminFetch(`/admin/users/${user.id}/licenses/${licenseId}`, { method: "DELETE" })
      : await adminSend(`/admin/users/${user.id}/licenses`, "POST", { licenseId });
    setMessage(response.ok ? "라이선스를 변경했습니다." : "라이선스를 변경하지 못했습니다.");
    if (response.ok) await reload();
  }
  const waiting = rows?.filter((row) => row.status === "PENDING") ?? [];
  // 승인 대기는 늘 위에 다 보여 준다. 검색은 그 아래 전체 명단에만 건다.
  const shown = (rows ?? []).filter((row) => !query.trim() || matches(`${row.name} ${row.email}`, query));
  return (
    <div className="admin-form">
      <p className="form-note">
        {owner
          ? "가입 신청을 승인하고, 부원별 기능 권한과 장비 라이선스를 관리합니다. 권한은 Owner만, 라이선스는 장비 관리 권한으로도 부여할 수 있습니다."
          : "회원 관리는 Owner만 수행할 수 있습니다."}
      </p>
      {message && <p className="save-notice">{message}</p>}
      {waiting.length > 0 && (
        <div className="admin-items">
          <h3>승인 대기 {waiting.length}명</h3>
          {waiting.map((row) => (
            <div className="admin-item" key={row.id}>
              <div className="admin-item-copy">
                <strong>{row.name}</strong>
                <span>{row.email}</span>
              </div>
              <div className="admin-item-actions">
                <button type="button" onClick={() => setStatus(row, "APPROVED")}>승인</button>
                <button type="button" className="danger" onClick={() => setStatus(row, "REJECTED")}>거절</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows === null ? (
        <p className="form-note">회원 목록을 불러오는 중입니다.</p>
      ) : rows.length ? (
        <div className="member-permission-list">
          <FilterBox value={query} onChange={setQuery} placeholder="이름이나 이메일로 회원 검색" count={shown.length} />
          {shown.length === 0 && <p className="form-note">검색 결과가 없습니다.</p>}
          {shown.map((row) => (
            <fieldset key={row.id}>
              <legend>
                {row.name} {row.isOwner && <em>Owner</em>}
              </legend>
              <div className="member-permission-head">
                <span>{row.email}</span>
                <select value={row.status} onChange={(event) => setStatus(row, event.target.value as MemberStatus)}>
                  {(Object.keys(memberStatusLabel) as MemberStatus[]).map((status) => (
                    <option value={status} key={status}>{memberStatusLabel[status]}</option>
                  ))}
                </select>
              </div>
              <p className="form-note">관리 권한</p>
              <div className="permission-grid">
                {permissionLabels.map(([permission, label]) => {
                  const granted = row.permissions.includes(permission);
                  return (
                    <label className="toggle-field" key={permission}>
                      <input type="checkbox" checked={granted || row.isOwner} disabled={row.isOwner} onChange={() => togglePermission(row, permission, granted)} />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="form-note">장비 라이선스</p>
              {licenses.length ? (
                <div className="permission-grid">
                  {licenses.map((license) => {
                    const granted = row.licenseIds.includes(license.id);
                    return (
                      <label className="toggle-field" key={license.id}>
                        <input type="checkbox" checked={granted} onChange={() => toggleLicense(row, license.id, granted)} />
                        <span>{license.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-inline">라이선스 탭에서 교육 항목을 먼저 등록해 주세요.</p>
              )}
            </fieldset>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>표시할 회원이 없습니다</h2>
        </div>
      )}
    </div>
  );
}
