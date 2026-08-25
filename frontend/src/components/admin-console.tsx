"use client";

import { ArrowDown, ArrowUp, ExternalLink, Eye, GripVertical, PencilLine, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLinkBlock } from "@/components/external-link-block";
import { ImageUploadField } from "@/components/image-upload-field";
import { ScrollingName } from "@/components/scrolling-name";
import { MemberDirectory } from "@/components/member-directory";
import {
  defaultOrganization,
  OrganizationChart,
  type OrganizationData,
  type OrganizationTeam,
} from "@/components/organization-chart";
import { HomeHero, HomeIntro, HomeNext, HomeNumbers, HomePillars } from "@/components/home-sections";
import { mergeHome, type HomeContent } from "@/lib/home-content";
import { RichTextEditor } from "@/components/rich-text-editor";
import { ASK_ALT, useAsk } from "@/components/ask-dialog";
import { date as longDate } from "@/lib/format";
import { media, optimizable } from "@/lib/media";
import type { ShapeMember } from "@/lib/members";
import type { AdminEquipmentItem, AdminReservationItem, AdminRoadmapItem, AdminUserItem, DirectoryUser, LicenseItem, LinkPreview, MemberStatus } from "@/lib/types";

const groups = [
  // 홈은 한 화면씩 스크롤로 넘어가므로, 그 장을 그대로 탭으로 나눕니다.
  { label: "HOME", tabs: ["히어로", "인트로", "단계", "현황", "일정"] },
  { label: "SHAPE", tabs: ["인사말", "동아리 소개", "조직도", "부원"] },
  { label: "장비 예약", tabs: ["보유 장비", "라이선스", "장비 예약"] },
  { label: "소식", tabs: ["SHAPE 뉴스", "언론보도", "게시판"] },
  { label: "로드맵", tabs: ["전체 로드맵", "SHAPE-UP", "대회", "교육", "기타"] },
  { label: "바로가기", tabs: ["관련 링크"] },
  { label: "시스템", tabs: ["회원 및 권한", "수정 내역", "서버"] },
] as const;
type Section = (typeof groups)[number]["tabs"][number];
// Every tab maps to the permission its API calls require, so a manager only
// sees the sections they can actually save; "owner" is reserved for members.
const tabPermission: Record<Section, string> = {
  "히어로": "content:manage",
  "인트로": "content:manage",
  "단계": "content:manage",
  "현황": "content:manage",
  "일정": "content:manage",
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
  "수정 내역": "owner",
  "서버": "owner",
};
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
/**
 * 관리자 화면이 공개 응답을 읽을 때 붙이는 설정.
 *
 * 공개 읽기는 방문자용으로 60초 캐시된다. 관리자 화면이 그냥 읽으면 방금 저장한
 * 내용 대신 최대 1분 전의 응답이 돌아온다. 실제로 부원 카드에 구글 계정을
 * 연결하고 저장해도 곧바로 다시 풀린 것처럼 보였다(서버에는 저장되어 있었다).
 */
/**
 * 관리자 화면이 고칠 내용을 불러올 때 쓰는 설정.
 *
 * 이 화면은 공개 창구(`/pages/*`)를 그대로 읽어 편집기를 채웁니다. 그런데 백엔드는
 * **세션 쿠키가 없는 요청**만 공개 응답 캐시에 담으므로, 쿠키를 빼고 부르면 편집기가
 * 최대 한 시간 된 값을 받아 그 위에 덮어쓸 수 있습니다. 저장할 때마다 캐시를 버리므로
 * 실제로 어긋나기는 어렵지만, 고치려고 여는 화면이 캐시를 거치는 구조 자체가
 * 위태롭습니다. 쿠키를 실어 보내면 백엔드가 `private, no-store` 로 답하고 캐시를
 * 완전히 비켜 갑니다.
 */
const PUBLIC_READ: RequestInit = { cache: "no-store", credentials: "include" };
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


/**
 * 저장하지 않은 변경을 화면 밖으로 들고 나가지 못하게 막습니다.
 *
 * 관리자 화면은 거의 모두 "고치고 마지막에 저장을 누른다" 는 구조입니다. 저장을
 * 누르지 않고 다른 탭이나 다른 쪽으로 가면 고친 것이 조용히 사라집니다(탭을
 * 바꾸면 화면이 통째로 다시 만들어집니다). 실제로 조직도에서 부원을 연결해 놓고
 * 저장을 누르지 않아 연결이 없어진 일이 있었습니다. 화면에는 연결된 것처럼
 * 보였으니 "연결했는데 끊긴다" 로 보이는 것이 당연합니다.
 *
 * 그래서 고친 것이 있으면 세 자리에서 한 번 물어봅니다.
 *
 * 1. 탭을 옮길 때(`AdminConsole.goTo`)
 * 2. 사이트 안의 다른 쪽으로 갈 때(`AdminConsole` 의 링크 가로채기)
 * 3. 새로 고침·창 닫기·주소 직접 입력(`beforeunload`)
 *
 * `save` 를 준 화면은 물음에 '저장하고 이동' 이 함께 뜹니다. 새 항목을 만드는
 * 폼은 주지 않습니다. 반쯤 쓰다 만 것이 실제로 등록되면 지우러 가야 합니다.
 *
 * 되돌아가기(브라우저 뒤로 가기)는 잡지 않습니다. App Router 에서 그것을
 * 가로채려면 히스토리에 가짜 칸을 하나 밀어 넣어야 하는데, 그 칸으로 돌아오는
 * 순간 화면이 다시 만들어지면서 오히려 고치던 내용이 날아갈 수 있습니다.
 */
const unsaved: {
  dirty: boolean;
  label: string;
  /** 저장까지 해 주고 나갈 수 있는 화면이면 참. 저장에 성공했는지 돌려줍니다. */
  save: (() => Promise<boolean>) | null;
} = { dirty: false, label: "", save: null };

function useUnsaved(dirty: boolean, label: string, save?: () => Promise<boolean>) {
  const canSave = Boolean(save);
  // 저장 함수는 그릴 때마다 새로 만들어집니다. 그대로 의존성에 넣으면 효과가
  // 매번 다시 도므로, 최신 것만 ref 로 붙들고 등록은 필요할 때만 합니다.
  // ref 는 그리는 도중이 아니라 그린 뒤에 채웁니다. 아래 등록 효과보다 먼저
  // 선언되어 있으므로 언제나 먼저 돕니다.
  const latest = useRef(save);
  useEffect(() => { latest.current = save; });
  useEffect(() => {
    unsaved.dirty = dirty;
    unsaved.label = label;
    unsaved.save = canSave ? async () => Boolean(await latest.current?.()) : null;
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      unsaved.dirty = false;
      unsaved.save = null;
    };
  }, [dirty, label, canSave]);
}

/**
 * 두 값을 견주기 좋은 문자열로 만듭니다. **칸의 차례에 흔들리지 않습니다.**
 *
 * `JSON.stringify` 는 칸이 적힌 차례까지 그대로 옮깁니다. 그래서 내용이 똑같아도
 * `{제목, 요약, 본문}` 과 `{제목, 본문, 요약}` 은 다른 문자열이 됩니다. 실제로
 * 언론보도 탭이 이것 때문에 **등록한 뒤에도 계속 '저장하지 않은 변경이 있습니다'**
 * 를 달고 있었습니다. 지금 값을 만드는 자리와 기준값을 만드는 자리에서 칸을 적은
 * 차례가 한 칸 어긋나 있었을 뿐인데, 그 뒤로 무엇을 해도 표시가 사라지지 않았습니다.
 *
 * 차례에 기대는 견주기는 언제 또 어긋날지 모르므로, 칸 이름을 정렬해서 씁니다.
 */
function stable(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item as object).sort().map((name) => [name, (item as Record<string, unknown>)[name]]))
      : item,
  );
}

/** 지금 화면의 값이 기준값과 다른지. 저장하지 않은 변경을 가려내는 데 씁니다. */
function changed(current: unknown, baseline: unknown) {
  return stable(current) !== stable(baseline);
}

/** 아직 저장하지 않았다는 표시. 저장 단추 옆에 붙습니다. */
function UnsavedMark({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return <span className="unsaved-mark">저장하지 않은 변경이 있습니다</span>;
}

/** Plain-language orientation for each tab: what it changes and where to see it. */
const sectionGuide: Record<Section, { what: string; where: string; href?: string }> = {
  "히어로": { what: "홈에 처음 보이는 큰 제목과 한 줄 소개를 고칩니다. 3D 로봇 무대는 화면에서 고칠 수 없어 여기 없습니다.", where: "홈 첫 화면", href: "/" },
  "인트로": { what: "'WHAT WE SHAPE' 장의 제목·표어·소개 문단과 다루는 분야 목록을 고칩니다.", where: "홈 두 번째 화면", href: "/#shape-intro" },
  "단계": { what: "교육·연구·검증 세 칸의 글과 연결되는 주소를 고칩니다.", where: "홈 세 번째 화면", href: "/#shape-pillars" },
  "현황": { what: "숫자 네 칸과 정기 활동 요일, 맨 아래 한 줄을 고칩니다.", where: "홈 네 번째 화면", href: "/#shape-numbers" },
  "일정": { what: "운용 플랫폼 목록과 준비 중인 대회를 고칩니다. 아래 일정 목록은 로드맵을 그대로 가져옵니다.", where: "홈 마지막 화면", href: "/#shape-next" },
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
  "수정 내역": { what: "운영진이 관리자 화면에서 무엇을 언제 고쳤는지 봅니다. 관리자 창구의 저장·삭제는 빠짐없이 남고, 지운 것도 이름이 함께 남습니다.", where: "고치는 곳이 아니라 보는 곳입니다" },
  "서버": { what: "사이트를 떠받치는 네 서비스를 무료 한도 대비 얼마나 썼는지 봅니다. 한도를 넘기면 요금이 붙는 것이 아니라 정지하므로, 달이 끝나기 전에 미리 보는 화면입니다.", where: "고치는 곳이 아니라 보는 곳입니다" },
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

/**
 * 바로가기 링크를 누구까지 볼지.
 *
 * 위의 '공개 여부' 와는 다른 축입니다. 그쪽은 **내보냈는가**(임시 저장이면
 * 이 관리 화면에만 남습니다)이고, 이쪽은 **내보낸 것을 누가 보는가** 입니다.
 * 아직 다듬는 중이라 감춰 두는 일과, 다 만든 링크를 부원에게만 여는 일은
 * 서로 다른 판단이라 칸을 합치지 않았습니다.
 *
 * 라디오의 `name` 이 '공개 여부' 와 겹치면 안 됩니다. 같은 폼 안의 두 무리가
 * 한 무리로 묶여 서로를 꺼 버립니다.
 */
type LinkScope = "PUBLIC" | "MEMBER" | "STAFF";
const linkScopes: { value: LinkScope; title: string; hint: string }[] = [
  { value: "PUBLIC", title: "전체 공개", hint: "로그인하지 않은 방문자도 볼 수 있습니다." },
  { value: "MEMBER", title: "부원에게만", hint: "승인된 회원과 보기 전용 회원(멤버)만 볼 수 있습니다." },
  { value: "STAFF", title: "운영진에게만", hint: "관련 링크 권한이 있는 운영진만 볼 수 있습니다." },
];

function VisibilityChoice({ value, onChange }: { value: LinkScope; onChange: (next: LinkScope) => void }) {
  return (
    <fieldset className="publish-choice">
      <legend>공개 범위</legend>
      {linkScopes.map((scope) => (
        <label className={value === scope.value ? "active" : ""} key={scope.value}>
          <input
            type="radio"
            name="link-visibility"
            checked={value === scope.value}
            onChange={() => onChange(scope.value)}
          />
          <b>{scope.title}</b>
          <small>{scope.hint}</small>
        </label>
      ))}
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
  const { ask, dialogNode } = useAsk();
  const router = useRouter();

  /**
   * 여기서 나가도 되는지 묻습니다. 나가도 되면 참을 돌려줍니다.
   *
   * 저장할 수 있는 화면이면 '저장하고 이동' 이 함께 뜨고, 그것을 고르면 여기서
   * 저장까지 마친 뒤에 보냅니다. 저장이 실패하면 보내지 않습니다. 실패한 줄
   * 모르고 화면을 옮기면 결국 고친 내용을 잃습니다.
   */
  const confirmLeave = useCallback(async (where: string) => {
    if (!unsaved.dirty) return true;
    const canSave = Boolean(unsaved.save);
    const answer = await ask({
      title: "저장하지 않은 변경이 있습니다",
      description: canSave
        ? `${unsaved.label}에서 고친 내용이 아직 저장되지 않았습니다. 지금 저장할까요?`
        : `${unsaved.label}에서 쓰던 내용이 아직 저장되지 않았습니다. 지금 ${where} 고친 내용이 사라집니다.`,
      confirmLabel: canSave ? "저장하고 이동" : "저장하지 않고 이동",
      altLabel: canSave ? "저장하지 않고 이동" : undefined,
      cancelLabel: "여기 머무르기",
      tone: canSave ? "default" : "danger",
    });
    if (answer === null) return false;
    if (answer !== ASK_ALT && unsaved.save) return await unsaved.save();
    // 표시는 지우지 않습니다. 화면이 사라지면서 `useUnsaved` 의 뒷정리가
    // 스스로 지웁니다.
    return true;
  }, [ask]);

  /** 저장하지 않은 변경이 있으면 탭을 떠나기 전에 한 번 물어봅니다. */
  async function goTo(section: Section) {
    if (section === tab) return;
    if (!(await confirmLeave("탭을 옮기면"))) return;
    setTab(section);
  }

  /**
   * 사이트 안의 다른 쪽으로 가는 링크를 가로챕니다.
   *
   * `beforeunload` 는 새로 고침·창 닫기에만 뜹니다. 머리글의 메뉴처럼 Next 가
   * 화면만 갈아 끼우는 이동(soft navigation)에는 아무 일도 일어나지 않아서,
   * 고치던 내용이 소리 없이 사라졌습니다.
   *
   * 누름을 잡는 단계(capture)에서 봐야 Next 의 `<Link>` 보다 먼저 끼어들 수
   * 있습니다. 새 창으로 여는 링크, 다른 사이트, 같은 쪽 안의 `#` 이동, 그리고
   * 새 탭으로 여는 누름(⌘·Ctrl·가운데 단추)은 그대로 둡니다.
   */
  useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (!unsaved.dirty || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const next = new URL(anchor.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmLeave("이 쪽을 떠나면").then((go) => {
        if (go) router.push(`${next.pathname}${next.search}${next.hash}`);
      });
    };
    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [confirmLeave, router]);
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
                  onClick={() => void goTo(section)}
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
      {dialogNode}
    </div>
  );
}

function AdminSection({ tab, owner }: { tab: Section; owner: boolean }) {
  if (tab === "히어로" || tab === "인트로" || tab === "단계" || tab === "현황" || tab === "일정")
    return <HomeForm key={tab} section={tab} />;
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
  // key 를 주는 이유: 탭이 바뀌어도 같은 컴포넌트가 같은 자리에 그려지면 React 가
  // 이전 상태를 이어 받는다. SHAPE 뉴스에서 저장한 뒤 언론보도로 넘어가면 그
  // 안내와 입력이 그대로 남아 있었다. 탭 이름을 key 로 주면 새로 만들어진다.
  if (tab === "SHAPE 뉴스")
    return <ContentForm key={tab} tab={tab} endpoint="/admin/news" method="POST" news />;
  if (tab === "언론보도")
    return (
      <ContentForm key={tab} tab={tab} endpoint="/admin/news" method="POST" news press />
    );
  if (tab === "게시판")
    return (
      <ContentForm key={tab} tab={tab} endpoint="/admin/notices" method="POST" notice />
    );
  if (tab === "보유 장비") return <EquipmentForm />;
  if (tab === "라이선스") return <LicenseManager />;
  if (tab === "장비 예약") return <ReservationsPanel />;
  if (["전체 로드맵", "SHAPE-UP", "대회", "교육", "기타"].includes(tab))
    return (
      <RoadmapForm key={tab} fixedCategory={tab === "전체 로드맵" ? undefined : tab} />
    );
  if (tab === "관련 링크") return <LinkForm />;
  if (tab === "수정 내역") return <AuditTrail />;
  if (tab === "서버") return <ServerUsage />;
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

/**
 * 사람을 고를 때 함께 보여 주는 작은 얼굴.
 *
 * 이름만 늘어놓으면 비슷한 이름을 고를 때 이메일을 하나하나 읽어야 합니다.
 * 사진이 없으면 이름 첫 글자를 대신 씁니다.
 */
function Avatar({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  if (!imageUrl) return <span className="pick-face" aria-hidden="true">{name.slice(0, 1)}</span>;
  return (
    <Image
      className="pick-face"
      src={media(imageUrl, 80, "eco")}
      alt=""
      width={36}
      height={36}
      unoptimized={!optimizable(imageUrl)}
    />
  );
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
  people: { id: string; name: string; detail?: string; imageUrl?: string | null }[];
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
        <span><Avatar name={chosen.name} imageUrl={chosen.imageUrl} /><strong>{chosen.name}</strong>{chosen.detail && <small>{chosen.detail}</small>}</span>
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
              <Avatar name={person.name} imageUrl={person.imageUrl} />
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

/**
 * 저장 결과 알림.
 *
 * 예전에는 패널마다 문자열 하나를 들고 있었는데 두 가지 문제가 있었습니다.
 * 첫째, 실패한 안내도 성공과 똑같은 초록 상자로 나왔습니다. 둘째, 저장에
 * 성공하면 곧바로 목록을 다시 읽어 오는데 그 함수가 알림을 지워 버려서,
 * "권한을 변경했습니다" 가 떴다가 순식간에 사라졌습니다.
 *
 * 알림을 성공 여부와 함께 들고 있고, 목록을 다시 읽는 일과 분리했습니다.
 */
/** 오늘 날짜를 `YYYY-MM-DD` 로. 브라우저가 있는 지역의 하루를 기준으로 삼습니다. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** `date` 입력에 넣을 수 있는 `YYYY-MM-DD`. 알 수 없으면 빈 문자열. */
function dateOnly(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function useNotice() {
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const say = useCallback((text: string, ok = true) => setNotice(text ? { text, ok } : null), []);
  const node = notice
    ? <p className={`save-notice${notice.ok ? "" : " danger"}`} role="status">{notice.text}</p>
    : null;
  return { say, node };
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
  onReorder,
  selectedId = "",
  emptyLabel = "아직 등록된 항목이 없습니다. 위에서 첫 항목을 만들어 보세요.",
}: {
  rows: AdminRow[];
  onEdit: (row: AdminRow) => void;
  onDelete: (row: AdminRow) => void;
  /** 주면 목록을 끌어다 놓아 차례를 바꿀 수 있습니다. 새 차례가 인자로 옵니다. */
  onReorder?: (ids: string[]) => void;
  selectedId?: string;
  emptyLabel?: string;
}) {
  // 끌고 있는 줄. 손을 떼면 그 자리로 옮깁니다.
  //
  // 어느 줄을 집었는지는 ref 에도 둡니다. 화면 표시(흐리게·파란 선)는 state 로
  // 충분하지만, 놓는 순간의 판단까지 state 에 기대면 다시 그려지기 전에 손을 뗀
  // 경우(아주 빠른 끌기)에 집은 줄을 잃어버립니다.
  const held = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  /** 한 줄을 다른 자리로 옮긴 새 차례. */
  const moved = (from: number, to: number) => {
    const ids = rows.map((row) => String(row.id));
    const [picked] = ids.splice(from, 1);
    ids.splice(to, 0, picked);
    return ids;
  };
  const drop = (to: number) => {
    const from = held.current;
    held.current = null;
    setDragging(null);
    setOver(null);
    if (from === null || from === to) return;
    onReorder?.(moved(from, to));
  };
  /**
   * 위·아래 단추.
   *
   * 손가락으로 쓰는 화면에서는 HTML 의 끌어놓기가 동작하지 않습니다. 키보드만
   * 쓰는 사람도 마찬가지입니다. 같은 일을 하는 단추를 함께 둡니다.
   */
  const nudge = (index: number, step: number) => {
    const to = index + step;
    if (to < 0 || to >= rows.length) return;
    onReorder?.(moved(index, to));
  };

  return (
    <div className="admin-items">
      <h3>등록된 항목 {rows.length > 0 && <em>{rows.length}</em>}</h3>
      {onReorder && rows.length > 1 && (
        <p className="form-note">
          줄을 끌어다 놓으면 공개 화면에 보이는 차례가 바뀝니다. 손가락으로 쓸 때는 <b>위·아래 화살표</b>를 누르세요.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="empty-inline">{emptyLabel}</p>
      ) : (
        rows.map((row, index) => {
          const published = row.isPublished !== false;
          const when = row.publishedAt ?? row.startsAt ?? row.updatedAt;
          const marks = [
            selectedId === String(row.id) ? " editing" : "",
            dragging === index ? " dragging" : "",
            over === index && dragging !== null && dragging !== index ? " drop-here" : "",
          ].join("");
          return (
            <div
              className={`admin-item${marks}`}
              key={String(row.id)}
              draggable={Boolean(onReorder)}
              onDragStart={() => { held.current = index; setDragging(index); }}
              onDragEnd={() => { held.current = null; setDragging(null); setOver(null); }}
              onDragOver={(event) => { if (held.current !== null) { event.preventDefault(); setOver(index); } }}
              onDrop={(event) => { event.preventDefault(); drop(index); }}
            >
              {onReorder && (
                <span className="admin-item-grip" aria-hidden="true" title="끌어서 차례 바꾸기">
                  <GripVertical size={16} />
                </span>
              )}
              <div className="admin-item-copy">
                <strong>{String(row.title ?? row.name ?? "항목")}</strong>
                <span>
                  <b className={published ? "badge live" : "badge draft"}>{published ? "공개 중" : "임시 저장"}</b>
                  {/* 공개 범위가 좁혀진 항목(지금은 관련 링크뿐)은 목록에서도
                      바로 보여야 합니다. 안 그러면 '공개 중' 만 보고 아무나
                      볼 수 있다고 읽게 됩니다. */}
                  {row.visibility === "MEMBER" ? <b className="badge scope">부원 전용</b> : null}
                  {row.visibility === "STAFF" ? <b className="badge scope staff">운영진 전용</b> : null}
                  {row.category ? <i>{String(row.category)}</i> : null}
                  {when ? <time>{listDate(String(when))}</time> : null}
                </span>
              </div>
              <div className="admin-item-actions">
                {onReorder && (
                  <span className="admin-item-move">
                    <button type="button" aria-label="위로 옮기기" title="위로" disabled={index === 0} onClick={() => nudge(index, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" aria-label="아래로 옮기기" title="아래로" disabled={index === rows.length - 1} onClick={() => nudge(index, 1)}>
                      <ArrowDown size={14} />
                    </button>
                  </span>
                )}
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

/**
 * 목록에 이 글이 어떻게 한 줄로 보이는지.
 *
 * 상세 화면만 미리 보여 주면 '한 줄 요약' 과 '대표 이미지' 를 어디에 쓰는지
 * 알 수 없습니다. 요약은 상세 화면에 아예 나오지 않고 **목록에만** 나오는데,
 * 예전 미리보기는 그 요약을 상세 화면 안에 그려서 실제와 어긋났습니다.
 *
 * 언론보도와 SHAPE 뉴스는 목록 모양이 서로 다릅니다(언론보도는 번호와 작은
 * 썸네일이 붙은 표, 소식은 큰 사진이 앞에 오는 카드). 공개 화면과 같은 클래스를
 * 그대로 쓰므로 css 를 두 번 손볼 일이 없습니다.
 */
function ListRowPreview({ press, title, summary, coverImage, publishedAt }: {
  press: boolean;
  title: string;
  summary: string;
  coverImage: string;
  publishedAt: string;
}) {
  const shown = title || "제목을 입력해 주세요";
  const line = summary || title;
  const when = publishedAt ? longDate(`${publishedAt}T09:00:00+09:00`) : "";
  if (press) {
    return (
      <div className="press-directory preview-list">
        <ol className="press-list">
          <li>
            {/* 공개 화면의 목록 규칙(.press-list a)이 `a` 를 고르므로 여기서도
                `a` 를 씁니다. href 를 주지 않았으니 링크로 동작하지는 않습니다. */}
            <a>
              <span className="press-number">1</span>
              <span className="press-thumb" aria-hidden="true">
                {coverImage ? (
                  <Image src={media(coverImage, 400, "eco")} alt="" width={400} height={250} unoptimized={!optimizable(coverImage)} />
                ) : (
                  <span className="press-thumb-blank">PRESS</span>
                )}
              </span>
              <span className="press-copy">
                <strong className="press-title">{shown}</strong>
                {line && <span className="press-summary">{line}</span>}
              </span>
              <time>{when}</time>
            </a>
          </li>
        </ol>
      </div>
    );
  }
  return (
    <div className="news-featured-list preview-list">
      <article className="news-featured-card">
        {coverImage ? (
          <Image src={media(coverImage, 1200, "high")} alt="" width={1200} height={760} unoptimized={!optimizable(coverImage)} />
        ) : (
          <div className="news-featured-placeholder" aria-hidden="true">SHAPE NEWS</div>
        )}
        <div className="news-featured-copy">
          <span className="meta">활동 · {when}</span>
          <h3>{shown}</h3>
          <p>{line}</p>
          <span className="card-action">자세히 보기</span>
        </div>
      </article>
    </div>
  );
}

/**
 * 저장하면 공개 화면에 어떻게 보이는지.
 *
 * 소식·언론보도는 공개 화면(app/news/[id]/page.tsx)이 쓰는 조각과 클래스를
 * 그대로 씁니다. 예전에는 이 자리에서 흉내만 내다 보니 실제와 세 군데가
 * 어긋났습니다.
 *
 * - 머리줄이 늘 "SHAPE CONTENT" 였습니다. 실제로는 `분류 · 발행일` 입니다.
 * - 대표 이미지가 아예 나오지 않았습니다. 실제로는 본문 앞의 가장 큰 요소입니다.
 * - 외부 링크 자리에 "저장하면 미리보기가 만들어집니다" 라는 안내만 있었습니다.
 *   실제로는 유튜브·인스타그램이면 화면 안에서 재생되고, 기사면 썸네일이 담긴
 *   카드가 나옵니다. 그 미리보기는 주소를 붙여 넣는 순간 이미 읽어 두므로
 *   (`/admin/link-preview`), 저장하기 전에도 진짜 모습을 보여 줄 수 있습니다.
 */
function ContentPreview({
  title,
  body,
  summary,
  externalUrl,
  showLinkPreview,
  news = false,
  press = false,
  category,
  publishedAt = "",
  coverImage = "",
  preview,
}: {
  title: string;
  body: string;
  summary?: string;
  externalUrl?: string;
  showLinkPreview?: boolean;
  /** 소식·언론보도면 공개 화면과 같은 머리줄·대표 이미지·링크 블록을 그립니다. */
  news?: boolean;
  press?: boolean;
  category?: string;
  publishedAt?: string;
  coverImage?: string;
  preview?: LinkPreview;
}) {
  const when = publishedAt ? longDate(`${publishedAt}T09:00:00+09:00`) : "";
  return (
    <section className="admin-live-preview">
      <div className="preview-label">
        <Eye size={15} /> 공개 화면 미리보기
      </div>
      {news && (
        <>
          <p className="preview-caption">{press ? "언론보도 목록" : "소식 목록"}에서 이렇게 보입니다</p>
          <ListRowPreview press={press} title={title} summary={summary ?? ""} coverImage={coverImage} publishedAt={publishedAt} />
          <p className="preview-caption">눌러서 들어가면 이렇게 보입니다</p>
        </>
      )}
      <article className="preview-sheet">
        <p className="article-meta">{news ? `${category ?? "활동"}${when ? ` · ${when}` : ""}` : "SHAPE CONTENT"}</p>
        <h3>{title || "제목을 입력해 주세요"}</h3>
        {/* 한 줄 요약은 상세 화면에 나오지 않습니다. 목록 미리보기에만 둡니다. */}
        {!news && summary && <p className="preview-summary">{summary}</p>}
        {news && coverImage && (
          <Image
            className="news-detail-cover"
            src={media(coverImage, 1400, "high")}
            alt=""
            width={1400}
            height={800}
            unoptimized={!optimizable(coverImage)}
          />
        )}
        {body ? (
          <div className="rich-content" dangerouslySetInnerHTML={{ __html: body }} />
        ) : (
          <p>본문을 작성하면 이곳에서 실제 공개 화면과 비슷하게 확인할 수 있습니다.</p>
        )}
        {externalUrl && showLinkPreview && (
          news ? (
            <ExternalLinkBlock url={externalUrl} preview={preview} />
          ) : (
            <a className="external-preview" href={externalUrl} target="_blank" rel="noreferrer">
              <small>EXTERNAL LINK</small>
              <strong>{externalUrl}</strong>
              <span>저장하면 이 링크의 영상 또는 기사 미리보기가 만들어집니다</span>
            </a>
          )
        )}
      </article>
    </section>
  );
}

/**
 * 글 편집 폼이 들고 있는, 사람이 고치는 값 전부.
 *
 * 저장하지 않은 변경을 가려낼 때 이 꾸러미를 통째로 견줍니다. 읽어 온 링크
 * 미리보기처럼 사람이 고치지 않는 값은 여기 넣지 않습니다. 넣으면 주소를
 * 붙여 넣은 순간 원문을 읽어 오는 것만으로 '고쳤다' 가 되어 버립니다.
 */
type ContentDraft = {
  title: string;
  summary: string;
  body: string;
  externalUrl: string;
  coverImage: string;
  noticeCategory: string;
  pinned: boolean;
  linkPreview: boolean;
  publishedAt: string;
  published: boolean;
};

function blankDraft(title: string, body: string): ContentDraft {
  // 칸의 차례는 위 `ContentDraft` 와 아래 `draft` 에 맞춰 둡니다.
  return {
    title, summary: "", body, externalUrl: "", coverImage: "",
    noticeCategory: "공지", pinned: false, linkPreview: true,
    publishedAt: today(), published: true,
  };
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
  /**
   * 마지막으로 저장(또는 불러온) 상태. 지금 값과 견주어 '저장하지 않은 변경'
   * 을 가려냅니다. 값이 바뀔 때마다 깃발을 세우는 대신 기준값과 견주는 이유는,
   * 고쳤다가 되돌려 놓은 경우까지 '고쳤다' 로 잡히지 않게 하기 위해서입니다.
   */
  const [baseline, setBaseline] = useState<ContentDraft>(() => blankDraft(method === "PUT" ? tab : "", ""));
  // 주소를 붙여 넣는 순간 읽어 둔 원문 미리보기. 저장하기 전에도 공개 화면과
  // 똑같은 모습(영상 재생기 또는 기사 카드)을 보여 주는 데 씁니다.
  const [preview, setPreview] = useState<LinkPreview | undefined>(undefined);
  // 소식이 실제로 있었던 날. 기본은 오늘이고, 언론보도는 주소를 붙여 넣으면
  // 원문의 발행일로 바뀝니다.
  const [publishedAt, setPublishedAt] = useState(today);
  const [linkChecking, setLinkChecking] = useState(false);
  const [published, setPublished] = useState(true);
  const { say, node: saveNotice } = useNotice();
  const [selectedId, setSelectedId] = useState("");
  const { ask, dialogNode } = useAsk();
  const { rows: allRows, reload } = useAdminRows(news ? "/admin/news" : notice ? "/admin/notices" : "");
  // A news tab must only list its own category, otherwise 언론보도 and SHAPE 뉴스
  // show each other's articles and editing one silently moves it.
  const rows = news ? allRows.filter((row) => String(row.category ?? "활동") === newsCategory) : allRows;

  const draft: ContentDraft = { title, summary, body, externalUrl, coverImage, noticeCategory, pinned, linkPreview, publishedAt, published };
  const dirty = changed(draft, baseline);
  /**
   * 저장하고 나갈 수 있는 화면인지.
   *
   * 이미 있는 글을 고치는 중이면(수정 또는 인사말처럼 한 쪽을 통째로 고치는
   * 탭) 저장까지 해 주고 보냅니다. **새 글을 쓰는 중이면 주지 않습니다.**
   * 쓰다 만 글이 실제로 등록되면 지우러 가야 하고, 공개로 두었다면 그사이
   * 알림까지 나갑니다.
   */
  const savable = method === "PUT" || Boolean(selectedId);
  useUnsaved(dirty, tab, savable ? submit : undefined);

  /** 여러 칸을 한 번에 갈아 끼우고, 그 값을 곧 기준으로 삼습니다. */
  function apply(next: ContentDraft) {
    setTitle(next.title);
    setSummary(next.summary);
    setBody(next.body);
    setExternalUrl(next.externalUrl);
    setCoverImage(next.coverImage);
    setNoticeCategory(next.noticeCategory);
    setPinned(next.pinned);
    setLinkPreview(next.linkPreview);
    setPublishedAt(next.publishedAt);
    setPublished(next.published);
    setBaseline(next);
  }

  useEffect(() => {
    if (method !== "PUT") return;
    const slug = endpoint.split("/").pop();
    void adminFetch(`/pages/${slug}`).then(async (response) => {
      if (!response.ok) return;
      const page = (await response.json()) as { title?: string; contentHtml?: string };
      apply(blankDraft(page.title ?? tab, page.contentHtml ?? ""));
    });
    // 탭을 바꿀 때만 다시 읽습니다. `apply` 는 그릴 때마다 새로 만들어지지만
    // 하는 일이 같으므로 여기서 다시 도는 것은 의미가 없습니다.
  }, [endpoint, method, tab]);

  function reset() {
    setSelectedId("");
    setPreview(undefined);
    apply(blankDraft(method === "PUT" ? title : "", method === "PUT" ? body : ""));
  }

  /**
   * 붙여 넣은 주소의 원문을 한 번 읽어 발행일을 채웁니다.
   *
   * 언론보도는 기사·인스타그램·유튜브가 나간 날이 곧 발행일입니다. 손으로 옮겨
   * 적으면 틀리기 쉬워서, 주소 칸에서 손을 떼는 순간 원문에서 읽어 옵니다.
   * 날짜를 못 찾으면 오늘 날짜를 그대로 둡니다.
   */
  async function readLink(url: string) {
    if (!news) return;
    if (!url.trim()) {
      // 주소를 지웠으면 읽어 둔 미리보기도 함께 버립니다. 남겨 두면 링크 없는
      // 글의 미리보기 자리에 옛 기사 카드가 그대로 붙어 있습니다.
      setPreview(undefined);
      return;
    }
    setLinkChecking(true);
    const response = await adminSend("/admin/link-preview", "POST", { url: url.trim() });
    setLinkChecking(false);
    if (!response.ok) {
      setPreview(undefined);
      say("링크를 읽지 못했습니다. 발행일은 직접 입력해 주세요.", false);
      return;
    }
    const read = (await response.json()) as LinkPreview & { publishedAt?: string };
    // 발행일을 못 찾더라도 미리보기 자체는 쓸 수 있습니다. 먼저 챙겨 둡니다.
    setPreview(read);
    const found = dateOnly(read.publishedAt);
    if (!found) {
      say("원문에서 발행일을 찾지 못했습니다. 날짜를 확인해 주세요.", false);
      return;
    }
    setPublishedAt(found);
    say(`${read.siteName || "원문"} 발행일 ${found} 을(를) 넣었습니다.`);
  }

  /** 저장합니다. 저장에 성공했는지 돌려줍니다(나가기 전 저장에 쓰입니다). */
  async function submit(): Promise<boolean> {
    if (!title.trim()) {
      say("제목을 입력해 주세요.", false);
      return false;
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
          // 날짜만 고르므로 그 날 09시(한국 시간)로 보냅니다. 목록은 날짜만 씁니다.
          publishedAt: publishedAt ? `${publishedAt}T09:00:00+09:00` : null,
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
      say(
        response.status === 0
          ? "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : response.status === 403
            ? "이 항목을 저장할 권한이 없습니다. 운영진에게 권한을 요청해 주세요."
            : "저장하지 못했습니다. 입력한 내용을 확인해 주세요.",
        false,
      );
      return false;
    }
    say(published ? `${tab}을(를) 저장하고 공개했습니다.` : `${tab}을(를) 임시 저장했습니다.`);
    reset();
    await reload();
    return true;
  }

  function edit(row: AdminRow) {
    setSelectedId(String(row.id));
    const json = row.contentJson;
    const stored = json && typeof json === "object" ? (json as { linkPreview?: boolean }) : {};
    apply({
      title: String(row.title ?? ""),
      summary: String(row.summary ?? ""),
      body: String(row.contentHtml ?? ""),
      externalUrl: String(row.externalUrl ?? ""),
      coverImage: String(row.coverImage ?? ""),
      noticeCategory: String(row.category ?? "공지"),
      pinned: Boolean(row.isPinned),
      linkPreview: stored.linkPreview ?? true,
      publishedAt: dateOnly(row.publishedAt) || today(),
      published: row.isPublished !== false,
    });
    if (json && typeof json === "object") {
      // 저장할 때 백엔드가 읽어 둔 미리보기입니다. 공개 화면이 쓰는 바로 그 값이라
      // 수정 화면에서도 실제와 똑같은 모습이 나옵니다. 미리보기는 사람이 고치는
      // 값이 아니므로 기준값(baseline)에는 넣지 않습니다.
      setPreview((json as { preview?: LinkPreview }).preview);
    } else {
      setPreview(undefined);
    }
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
      say("먼저 저장한 뒤 미리보기를 새로 만들 수 있습니다.", false);
      return;
    }
    const response = await adminSend(`/admin/news/${selectedId}/preview`, "POST");
    say(response.ok ? "링크 미리보기를 다시 가져왔습니다." : "링크에서 미리보기를 가져오지 못했습니다.", response.ok);
    if (response.ok) {
      setPreview((await response.json()) as LinkPreview);
      await reload();
    }
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
          <div className="admin-form-row">
            <label>
              발행일
              <input
                type="date"
                value={publishedAt}
                onChange={(event) => setPublishedAt(event.target.value)}
              />
            </label>
            <label>
              외부 링크 (기사 · YouTube · Instagram)
              <input
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
                onBlur={(event) => void readLink(event.target.value)}
                type="url"
                placeholder="https://"
              />
            </label>
          </div>
          <p className="form-note">
            {press
              ? "발행일은 기본으로 오늘이고, 위 주소를 넣으면 원문이 나간 날로 바뀝니다."
              : "발행일은 기본으로 오늘입니다. 지난 소식을 올릴 때는 실제 날짜로 바꿔 주세요."}
            {linkChecking && " 원문을 읽고 있습니다…"}
            {news && externalUrl.trim() && !linkChecking && (
              <button type="button" className="text-button" onClick={() => void readLink(externalUrl)}>
                <RefreshCw size={14} /> 원문에서 발행일 다시 읽기
              </button>
            )}
          </p>
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
      <div className="field-block">
        <span className="field-label">본문</span>
        {/* 편집기를 <label> 로 감싸면 안 됩니다. label 을 누르면 브라우저가 그 안의
            첫 입력 요소를 대신 눌러 주는데, 글상자를 누르는 순간 그 동작이 일어나
            **도구 막대의 첫 단추로 초점이 끌려갔습니다.** 글을 쓰려고 눌렀는데
            '문단 모양' 이 잡히는 문제가 여기서 났습니다. */}
        <RichTextEditor value={body} onChange={setBody} />
      </div>
      <PublishChoice value={published} onChange={setPublished} />
      <div className="admin-actions">
        <button type="button" className="button" onClick={() => void submit()}>
          {selectedId ? "수정 내용 저장" : published ? "저장하고 공개" : "임시 저장"}
        </button>
        <UnsavedMark dirty={dirty} />
        {selectedId && (
          <button type="button" className="button secondary" onClick={reset}>
            취소
          </button>
        )}
        {saveNotice}
      </div>
      <ContentPreview
        title={title}
        body={body}
        externalUrl={externalUrl}
        showLinkPreview={linkPreview}
        summary={summary}
        news={news}
        press={press}
        category={newsCategory}
        publishedAt={publishedAt}
        coverImage={coverImage}
        preview={preview}
      />
      <AdminItems rows={rows} onEdit={edit} onDelete={remove} selectedId={selectedId} />
      {dialogNode}
    </div>
  );
}

/* ------------------------------------------------------------------ 홈 화면 */

/**
 * 홈 화면 편집.
 *
 * 홈은 한 화면씩 스크롤로 넘어가므로 그 장을 그대로 탭으로 나눴습니다.
 * 다섯 탭이 모두 같은 저장본(`content_pages/home`)의 서로 다른 칸을 고칩니다.
 * 그래서 각 탭은 **전체를 읽어 자기 칸만 바꾼 뒤 전체를 저장합니다.** 자기 칸만
 * 보내면 다른 장의 내용이 지워집니다.
 *
 * 화면에서 고칠 수 없는 것은 일부러 넣지 않았습니다. 3D 로봇 무대, 스크롤
 * 애니메이션, 칸 배치는 코드와 CSS 가 정합니다. 칸 수가 정해진 목록(단계 3칸,
 * 숫자 4칸, 요일 3칸)은 늘리고 줄이면 배치가 무너지므로 글자만 고칩니다.
 */
function HomeText({ label, value, hint, onChange, rows = 0 }: {
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label>
      {label}
      {rows > 0 ? (
        <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function HomeForm({ section }: { section: "히어로" | "인트로" | "단계" | "현황" | "일정" }) {
  const [content, setContent] = useState<HomeContent | null>(null);
  // 마지막으로 저장(또는 불러온) 내용. 지금 값과 견주어 저장하지 않은 변경을
  // 가려냅니다. 홈은 다섯 탭이 한 덩어리를 나눠 고치므로, 어느 탭에서 고쳤든
  // 저장하지 않고 나가면 그 덩어리째 사라집니다.
  const [baseline, setBaseline] = useState<HomeContent | null>(null);
  const [saving, setSaving] = useState(false);
  const { say, node } = useNotice();
  const dirty = Boolean(content) && changed(content, baseline);
  useUnsaved(dirty, `홈 ${section}`, submit);

  useEffect(() => {
    void fetch(`${apiUrl}/pages/home`, PUBLIC_READ)
      .then(async (response) => {
        // 아직 한 번도 저장하지 않았으면 페이지가 없습니다. 그때는 기본값으로 엽니다.
        const page = response.ok ? await response.json() : null;
        const merged = mergeHome(page?.contentJson);
        setContent(merged);
        setBaseline(merged);
      })
      .catch(() => { setContent(mergeHome(null)); setBaseline(mergeHome(null)); });
  }, []);

  async function submit(): Promise<boolean> {
    if (!content) return false;
    setSaving(true);
    const response = await adminSend("/admin/pages/home", "PUT", {
      title: "홈",
      contentHtml: "",
      contentJson: content,
      isPublished: true,
    });
    setSaving(false);
    say(
      response.ok
        ? "홈 화면을 저장했습니다. 공개 화면에 바로 반영됩니다."
        : response.status === 403
          ? "저장할 권한이 없습니다. 콘텐츠 관리 권한을 확인해 주세요."
          : "저장하지 못했습니다.",
      response.ok,
    );
    if (response.ok) setBaseline(content);
    return response.ok;
  }

  if (!content) return <p className="form-note">홈 화면 내용을 불러오는 중입니다.</p>;

  /** 한 칸만 바꿔 전체를 새로 만듭니다. 다른 장은 그대로 둡니다. */
  const patch = <K extends keyof HomeContent>(key: K, value: HomeContent[K]) =>
    setContent((current) => (current ? { ...current, [key]: value } : current));
  const patchIn = <K extends "hero" | "intro" | "numbers" | "next">(key: K, part: Partial<HomeContent[K]>) =>
    setContent((current) => (current ? { ...current, [key]: { ...current[key], ...part } } : current));
  /** 목록 안의 한 줄만 바꿉니다. */
  const editRow = <T,>(rows: T[], index: number, part: Partial<T>): T[] =>
    rows.map((row, i) => (i === index ? { ...row, ...part } : row));

  return (
    <div className="admin-form home-form">
      {section === "히어로" && (
        <>
          <p className="form-note">
            홈을 열었을 때 처음 보이는 화면입니다. 오른쪽 3D 로봇은 모델 파일로 그려지므로 여기서 고칠 수 없습니다.
          </p>
          <HomeText label="도는 글자띠" value={content.hero.wordmark} onChange={(value) => patchIn("hero", { wordmark: value })} />
          <div className="field-row">
            <HomeText label="큰 제목 첫 줄" value={content.hero.titleTop} onChange={(value) => patchIn("hero", { titleTop: value })} />
            <HomeText label="큰 제목 둘째 줄 (기울임)" value={content.hero.titleAccent} onChange={(value) => patchIn("hero", { titleAccent: value })} />
          </div>
          <HomeText
            label="한 줄 소개"
            rows={2}
            hint="Enter 로 나눈 줄이 화면에서도 그대로 줄바꿈이 됩니다."
            value={content.hero.tagline}
            onChange={(value) => patchIn("hero", { tagline: value })}
          />
          <div className="field-row">
            <HomeText label="단추 글자" value={content.hero.ctaLabel} onChange={(value) => patchIn("hero", { ctaLabel: value })} />
            <HomeText label="단추 주소" value={content.hero.ctaHref} onChange={(value) => patchIn("hero", { ctaHref: value })} />
          </div>
          <HomeText label="아래로 안내하는 글자" value={content.hero.scrollLabel} onChange={(value) => patchIn("hero", { scrollLabel: value })} />
        </>
      )}

      {section === "인트로" && (
        <>
          <HomeText label="작은 머리글" value={content.intro.eyebrow} onChange={(value) => patchIn("intro", { eyebrow: value })} />
          <HomeText label="제목" rows={2} hint="Enter 로 줄을 나눕니다." value={content.intro.heading} onChange={(value) => patchIn("intro", { heading: value })} />
          <HomeText label="표어" rows={2} value={content.intro.slogan} onChange={(value) => patchIn("intro", { slogan: value })} />
          <HomeText label="소개 문단" rows={4} value={content.intro.body} onChange={(value) => patchIn("intro", { body: value })} />
          <div className="field-block">
            <div className="field-block-head">
              <span className="field-label">다루는 분야 {content.intro.fields.length}개</span>
              <button
                type="button"
                className="text-button"
                onClick={() => patchIn("intro", { fields: [...content.intro.fields, { title: "", topics: "" }] })}
              >
                분야 추가
              </button>
            </div>
            <p className="form-note">두 칸씩 나란히 놓입니다. 짝수로 맞추면 아래가 비지 않습니다.</p>
            {content.intro.fields.map((field, index) => (
              <div className="home-row" key={index}>
                <HomeText label={`${index + 1}. 이름`} value={field.title} onChange={(value) => patchIn("intro", { fields: editRow(content.intro.fields, index, { title: value }) })} />
                <HomeText label="주제" value={field.topics} onChange={(value) => patchIn("intro", { fields: editRow(content.intro.fields, index, { topics: value }) })} />
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => patchIn("intro", { fields: content.intro.fields.filter((_, i) => i !== index) })}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <div className="field-row">
            <HomeText label="단추 글자" value={content.intro.ctaLabel} onChange={(value) => patchIn("intro", { ctaLabel: value })} />
            <HomeText label="단추 주소" value={content.intro.ctaHref} onChange={(value) => patchIn("intro", { ctaHref: value })} />
          </div>
        </>
      )}

      {section === "단계" && (
        <>
          <p className="form-note">
            세 칸이 나란히 놓이는 자리라 칸을 늘리거나 줄이면 배치가 무너집니다. 글과 주소만 고칩니다.
          </p>
          {content.stages.map((stage, index) => (
            <fieldset key={index} className="home-card">
              <legend>{stage.number} · {stage.title || "이름 없음"}</legend>
              <div className="field-row">
                <HomeText label="번호" value={stage.number} onChange={(value) => patch("stages", editRow(content.stages, index, { number: value }))} />
                <HomeText label="영문 이름" value={stage.label} onChange={(value) => patch("stages", editRow(content.stages, index, { label: value }))} />
                <HomeText label="제목" value={stage.title} onChange={(value) => patch("stages", editRow(content.stages, index, { title: value }))} />
              </div>
              <HomeText label="설명" rows={3} value={stage.body} onChange={(value) => patch("stages", editRow(content.stages, index, { body: value }))} />
              <HomeText label="연결 주소" value={stage.href} onChange={(value) => patch("stages", editRow(content.stages, index, { href: value }))} />
              {/* 사진은 세 칸 모두 같은 크기의 둥근 사각형으로 놓입니다.
                  비워 두면 그 칸만 글로 나옵니다. */}
              <ImageUploadField
                purpose="news"
                label="카드 사진 (선택)"
                value={stage.imageUrl ?? ""}
                onChange={(value) => patch("stages", editRow(content.stages, index, { imageUrl: value || undefined }))}
              />
            </fieldset>
          ))}
        </>
      )}

      {section === "현황" && (
        <>
          <HomeText label="작은 머리글" value={content.numbers.eyebrow} onChange={(value) => patchIn("numbers", { eyebrow: value })} />
          <HomeText label="제목" rows={2} hint="Enter 로 줄을 나눕니다." value={content.numbers.heading} onChange={(value) => patchIn("numbers", { heading: value })} />
          <div className="field-block">
            <span className="field-label">숫자 네 칸</span>
            <p className="form-note">네 칸이 나란히 놓입니다. 칸 수는 고정이고 글자만 고칩니다.</p>
            {content.numbers.facts.map((fact, index) => (
              <div className="home-row" key={index}>
                <HomeText label="항목" value={fact.label} onChange={(value) => patchIn("numbers", { facts: editRow(content.numbers.facts, index, { label: value }) })} />
                <HomeText label="숫자" value={fact.value} onChange={(value) => patchIn("numbers", { facts: editRow(content.numbers.facts, index, { value }) })} />
                <HomeText label="단위" value={fact.unit} onChange={(value) => patchIn("numbers", { facts: editRow(content.numbers.facts, index, { unit: value }) })} />
                <HomeText label="설명" value={fact.note} onChange={(value) => patchIn("numbers", { facts: editRow(content.numbers.facts, index, { note: value }) })} />
              </div>
            ))}
          </div>
          <div className="field-block">
            <span className="field-label">정기 활동 요일</span>
            {content.numbers.week.map((slot, index) => (
              <div className="home-row" key={index}>
                <HomeText label="요일" value={slot.day} onChange={(value) => patchIn("numbers", { week: editRow(content.numbers.week, index, { day: value }) })} />
                <HomeText label="트랙" value={slot.track} onChange={(value) => patchIn("numbers", { week: editRow(content.numbers.week, index, { track: value }) })} />
                <HomeText label="대상" value={slot.who} onChange={(value) => patchIn("numbers", { week: editRow(content.numbers.week, index, { who: value }) })} />
                <HomeText label="시간" value={slot.when} onChange={(value) => patchIn("numbers", { week: editRow(content.numbers.week, index, { when: value }) })} />
              </div>
            ))}
          </div>
          <HomeText label="맨 아래 한 줄" rows={2} value={content.numbers.footnote} onChange={(value) => patchIn("numbers", { footnote: value })} />
        </>
      )}

      {section === "일정" && (
        <>
          <HomeText label="작은 머리글" value={content.next.eyebrow} onChange={(value) => patchIn("next", { eyebrow: value })} />
          <HomeText label="제목" rows={2} value={content.next.heading} onChange={(value) => patchIn("next", { heading: value })} />
          <HomeText label="플랫폼 칸 제목" value={content.next.platformsHeading} onChange={(value) => patchIn("next", { platformsHeading: value })} />
          <HomeText
            label="운용 플랫폼"
            rows={5}
            hint="한 줄에 하나씩 적습니다. 적은 순서대로 이름표가 놓입니다."
            value={content.next.platforms.join("\n")}
            onChange={(value) => patchIn("next", { platforms: value.split("\n").map((name) => name.trim()).filter(Boolean) })}
          />
          <HomeText label="플랫폼 설명" rows={2} value={content.next.platformsNote} onChange={(value) => patchIn("next", { platformsNote: value })} />
          <div className="field-row">
            <HomeText label="단추 글자" value={content.next.platformsCtaLabel} onChange={(value) => patchIn("next", { platformsCtaLabel: value })} />
            <HomeText label="단추 주소" value={content.next.platformsCtaHref} onChange={(value) => patchIn("next", { platformsCtaHref: value })} />
          </div>
          <div className="field-block">
            <div className="field-block-head">
              <span className="field-label">준비 중인 대회 {content.next.contests.length}개</span>
              <button
                type="button"
                className="text-button"
                onClick={() => patchIn("next", { contests: [...content.next.contests, { name: "", when: "", where: "" }] })}
              >
                대회 추가
              </button>
            </div>
            {content.next.contests.map((contest, index) => (
              <div className="home-row" key={index}>
                <HomeText label="대회 이름" value={contest.name} onChange={(value) => patchIn("next", { contests: editRow(content.next.contests, index, { name: value }) })} />
                <HomeText label="일정" value={contest.when} onChange={(value) => patchIn("next", { contests: editRow(content.next.contests, index, { when: value }) })} />
                <HomeText label="장소" value={contest.where} onChange={(value) => patchIn("next", { contests: editRow(content.next.contests, index, { where: value }) })} />
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => patchIn("next", { contests: content.next.contests.filter((_, i) => i !== index) })}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <HomeText label="로드맵으로 가는 단추 글자" value={content.next.timelineCtaLabel} onChange={(value) => patchIn("next", { timelineCtaLabel: value })} />
          <p className="form-note">
            아래에 놓이는 <b>다가오는 일정 목록은 로드맵을 그대로 가져옵니다.</b> 일정 자체는 관리자 › 로드맵에서 고칩니다.
          </p>
        </>
      )}

      <div className="admin-actions">
        <button className="button" type="button" disabled={saving} onClick={() => void submit()}>
          {saving ? "저장 중…" : "저장"}
        </button>
        <UnsavedMark dirty={dirty} />
      </div>
      {node}
      <section className="admin-live-preview">
        <div className="preview-label">
          <Eye size={15} /> 공개 화면 미리보기
        </div>
        {/*
          공개 홈과 같은 조각을 그립니다. 다만 홈에서는 한 장이 화면 전체를
          차지하고 스크롤로 넘어가므로, 미리보기 안에서는 높이를 내용에 맞춰
          줄입니다(.home-preview). 3D 로봇 무대는 모델 파일을 내려받아야 해서
          미리보기에서는 끕니다.
        */}
        {/* `shape-home` 은 붙이지 않습니다. 그 클래스는 한 장이 화면 높이를
            차지하고 스크롤로 스냅되게 하는 규칙이라, 관리자 화면 안에 넣으면
            미리보기가 화면 높이를 통째로 먹고 좌측 바까지 밀어냅니다. */}
        <div className="home-preview">
          {section === "히어로" && <HomeHero home={content} stage={false} />}
          {section === "인트로" && <HomeIntro home={content} />}
          {section === "단계" && <HomePillars home={content} />}
          {section === "현황" && <HomeNumbers home={content} />}
          {section === "일정" && <HomeNext home={content} schedule={[]} />}
        </div>
        {section === "일정" && (
          <p className="form-note">아래 일정 목록은 로드맵에서 가져오므로 미리보기에는 나오지 않습니다.</p>
        )}
      </section>
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
  // 불러온 뒤 아직 아무것도 안 고쳤으면 기준값과 같습니다. 불러오기 전에는
  // 처음 값이 곧 기준이라 '고쳤다' 로 잡히지 않습니다.
  const [baseline, setBaseline] = useState(() => ({ title: "동아리 소개", body: "", facts }));
  const draft = { title, body, facts };
  const dirty = changed(draft, baseline);
  useUnsaved(dirty, "동아리 소개", submit);
  useEffect(() => {
    void fetch(`${apiUrl}/pages/club-introduction`, PUBLIC_READ)
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json();
        const loaded = {
          title: page.title || "동아리 소개",
          body: (page.contentHtml ?? "") as string,
          facts: Array.isArray(page.contentJson?.facts) ? page.contentJson.facts : facts,
        };
        setTitle(loaded.title);
        setBody(loaded.body);
        setFacts(loaded.facts);
        setBaseline(loaded);
      })
      .catch(() => undefined);
    // 처음 한 번만 읽습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(): Promise<boolean> {
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
    }).catch(() => null);
    const ok = Boolean(response?.ok);
    setMessage(ok ? "동아리 소개를 저장했습니다." : "저장하지 못했습니다.");
    if (ok) setBaseline(draft);
    return ok;
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
      <div className="field-block">
        <span className="field-label">소개 본문</span>
        <RichTextEditor value={body} onChange={setBody} />
      </div>
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
      <div className="admin-actions">
        <button className="button" type="button" onClick={() => void submit()}>
          동아리 소개 저장 및 공개
        </button>
        <UnsavedMark dirty={dirty} />
      </div>
      {message && <p className="save-notice">{message}</p>}
      <ContentPreview title={title} body={body} />
    </div>
  );
}

function MembersForm() {
  const [members, setMembers] = useState<ShapeMember[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const { say, node: notice } = useNotice();
  // 부원 카드도 마지막에 한 번 저장하는 화면이라 같은 함정이 있습니다.
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty, "부원", submit);
  useEffect(() => {
    void adminFetch("/admin/directory").then(async (response) => {
      if (response.ok) setDirectory((await response.json()) as DirectoryUser[]);
    });
  }, []);
  useEffect(() => {
    void fetch(`${apiUrl}/pages/members`, PUBLIC_READ)
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json();
        const stored = page.contentJson?.members ?? page.content_json?.members;
        if (Array.isArray(stored) && stored.length) setMembers(stored);
      })
      .catch(() => undefined);
  }, []);
  /** 아직 구글 계정이 붙지 않은 카드. 아직 로그인하지 않은 부원입니다. */
  const unlinked = members.filter((member) => !member.userId).map((member) => member.name);
  /** 카드에 붙은 계정을 이름·사진과 함께 보여 주기 위한 표. */
  const accounts = new Map(directory.map((person) => [person.id, person]));
  const update = (index: number, patch: Partial<ShapeMember>) => {
    setDirty(true);
    setMembers((current) =>
      current.map((member, i) =>
        i === index ? { ...member, ...patch } : member,
      ),
    );
  };
  async function submit(): Promise<boolean> {
    // 예전에 저장된 카드에는 기술 팀(Reasoning·Navigation 같은) 값이 남아 있습니다.
    // 부원을 팀으로 나누지 않기로 했으므로, 저장할 때 그 값을 실제로 지웁니다.
    // 화면에서 안 보이게만 하면 값은 그대로 남아 나중에 다시 새어 나옵니다.
    const clean = members.map((member) => {
      const { team: _dropped, ...rest } = member as ShapeMember & { team?: string };
      return rest;
    });
    try {
      const response = await fetch(`${apiUrl}/admin/pages/members`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "부원",
          contentHtml: "",
          contentJson: { members: clean },
          isPublished: true,
        }),
      });
      if (response.ok) setDirty(false);
      say(
        response.ok ? "부원 카드를 저장했습니다." : "저장하지 못했습니다. 콘텐츠 관리 권한을 확인해 주세요.",
        response.ok,
      );
      return response.ok;
    } catch {
      say("저장하지 못했습니다. 서버에 연결할 수 없습니다.", false);
      return false;
    }
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        부원 한 명을 카드 하나로 관리합니다. 회원 구분(준회원·정회원·알럼·멤버)은 공개 페이지의 필터에 그대로 쓰입니다.
      </p>
      <div className="link-summary">
        <span>
          구글 계정 연결 <b>{members.filter((member) => member.userId).length}</b> / {members.length}명
          {unlinked.length > 0 && <i> · 미연결 {unlinked.slice(0, 6).join(", ")}{unlinked.length > 6 ? ` 외 ${unlinked.length - 6}명` : ""}</i>}
        </span>
      </div>
      <p className="form-note">
        <b>계정 연결은 부원 본인이 마이페이지에서 합니다.</b> 로그인하면 이름이 같은 카드가 후보로 뜨고, 본인이
        고르면 연결됩니다. 운영진이 마흔 장을 하나씩 맞출 일이 아니고, 본인이 고르는 편이 정확합니다. 여기서는
        연결 상태를 확인하고, 잘못 연결된 카드만 풀어 줍니다. 공개 페이지에 나가는 사진은 <b>여기 이 카드에
        올린 사진이 먼저</b>이고, 카드에 사진이 없을 때만 연결된 계정의 사진을 씁니다. 부원이 마이페이지에서
        사진을 바꾸면 그 카드의 사진까지 함께 바뀌므로, 본인이 고친 사진도 그대로 반영됩니다. 소개말은
        본인이 마이페이지에서 쓴 것만 나갑니다.
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
              <span className="field-label">구글 계정</span>
              {member.userId ? (
                <div className="card-account">
                  <Avatar name={accounts.get(member.userId)?.name ?? "?"} imageUrl={accounts.get(member.userId)?.imageUrl} />
                  <div>
                    <strong>{accounts.get(member.userId)?.name ?? "연결됨"}</strong>
                    <span>{accounts.get(member.userId)?.email ?? "회원 목록에 없는 계정입니다."}</span>
                  </div>
                  <button type="button" className="text-button danger" onClick={() => update(index, { userId: undefined })}>
                    연결 해제
                  </button>
                </div>
              ) : (
                <p className="empty-inline">본인이 로그인해 마이페이지에서 연결하면 여기에 표시됩니다.</p>
              )}
            </div>
            <button
              type="button"
              className="text-button danger"
              onClick={() =>
                { setDirty(true); setMembers((current) => current.filter((_, i) => i !== index)); }
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
        onClick={() => {
          setDirty(true);
          setMembers((current) => [
            ...current,
            {
              id: `member-${Date.now()}`,
              name: "",
              role: "팀원",
              affiliation: "서울대학교",
              membership: "준회원",
            },
          ]);
        }}
      >
        <Plus size={16} /> 부원 추가
      </button>
      <div className="save-row">
        <button className="button" type="button" onClick={() => void submit()}>
          부원 카드 저장 및 공개
        </button>
        <UnsavedMark dirty={dirty} />
      </div>
      {notice}
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
              people={members.filter((member) => !(team.memberIds ?? []).includes(member.id)).map((member) => ({ id: member.id, name: member.name, detail: `${member.membership ?? "정회원"} · ${member.role}` }))}
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
  // 부원을 연결해 놓고 저장을 누르지 않아 연결이 사라지는 일이 있었습니다.
  // 고친 것이 있으면 화면에 표시하고, 탭을 떠날 때 한 번 물어봅니다.
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty, "조직도", submit);
  /** 고칠 때마다 '저장 안 함' 으로 표시합니다. */
  const edit = (next: OrganizationData) => { setData(next); setDirty(true); setMessage(""); };
  useEffect(() => {
    void fetch(`${apiUrl}/pages/organization`, PUBLIC_READ)
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json();
        const json = page.contentJson ?? page.content_json;
        if (json?.operationTeams) setData(json);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    void fetch(`${apiUrl}/pages/members`, PUBLIC_READ).then(async (response) => {
      if (!response.ok) return;
      const page = await response.json();
      const stored = page.contentJson?.members ?? page.content_json?.members;
      if (Array.isArray(stored)) setMembers(stored);
    }).catch(() => undefined);
  }, []);
  async function submit(): Promise<boolean> {
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
      response.ok
        ? "조직도를 저장했습니다."
        : response.status === 403
          ? "저장할 권한이 없습니다. 콘텐츠 관리 권한을 확인해 주세요."
          : "조직도를 저장하지 못했습니다.",
    );
    if (response.ok) setDirty(false);
    return response.ok;
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
              edit({ ...data, advisor: event.target.value })
            }
          />
        </label>
        <label>
          회장단 표기
          <input
            value={data.leadership}
            onChange={(event) =>
              edit({ ...data, leadership: event.target.value })
            }
          />
        </label>
      </div>
      <TeamEditor title="조직 팀" value={[...data.operationTeams, ...(data.projectTeams ?? [])]} onChange={(operationTeams) => edit({ ...data, operationTeams, projectTeams: [] })} members={members} />
      <div className="save-row">
        <button className="button" type="button" onClick={() => void submit()}>
          조직도 저장 및 공개
        </button>
        <UnsavedMark dirty={dirty} />
      </div>
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

/** 호기 상태 고르기에 쓰는 이름. 알림 문구와 드롭다운이 같은 말을 쓰도록 모아 둡니다. */
const unitStatusLabel: Record<string, string> = {
  ACTIVE: "예약 가능",
  MAINTENANCE: "점검 중",
  INACTIVE: "운영 중지",
};

function UnitEditor({ equipment, onChanged }: { equipment: AdminEquipmentItem; onChanged: () => void }) {
  const { ask, dialogNode } = useAsk();
  const [label, setLabel] = useState("");
  const { say, node: notice } = useNotice();
  async function add() {
    if (!label.trim()) {
      say("호기 이름을 입력해 주세요.", false);
      return;
    }
    const wanted = label.trim();
    const response = await adminSend(`/admin/equipment/${equipment.id}/units`, "POST", { label: wanted, status: "ACTIVE" });
    if (!response.ok) {
      say("호기를 추가하지 못했습니다.", false);
      return;
    }
    // 성공했을 때 알림을 비워 두면 눌렸는지 아닌지 알 수 없습니다.
    say(`‘${wanted}’ 호기를 추가했습니다.`);
    setLabel("");
    onChanged();
  }
  async function setStatus(unitId: string, unitLabel: string, status: string) {
    const response = await adminSend(`/admin/equipment/units/${unitId}`, "PATCH", { label: unitLabel, status });
    if (!response.ok) {
      // 예전에는 실패해도 아무 말이 없어서 바뀐 줄 알고 지나쳤습니다.
      say(`‘${unitLabel}’ 상태를 바꾸지 못했습니다.`, false);
      return;
    }
    say(`‘${unitLabel}’ 상태를 ${unitStatusLabel[status] ?? status}(으)로 바꿨습니다.`);
    onChanged();
  }
  async function remove(unitId: string) {
    const confirmed = await ask({ title: "이 호기를 삭제할까요?", description: "예약 이력이 있으면 삭제가 거절됩니다. 그럴 때는 상태를 '점검 중'으로 바꿔 주세요.", confirmLabel: "삭제", tone: "danger" });
    if (confirmed === null) return;
    const response = await adminFetch(`/admin/equipment/units/${unitId}`, { method: "DELETE" });
    if (!response.ok) {
      say("예약 이력이 있는 호기는 삭제할 수 없습니다. 점검 중으로 바꿔 주세요.", false);
      return;
    }
    say("호기를 삭제했습니다.");
    onChanged();
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
                {Object.entries(unitStatusLabel).map(([value, text]) => (
                  <option value={value} key={value}>{text}</option>
                ))}
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
      {notice}
      {dialogNode}
    </div>
  );
}

function EquipmentForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [unit, setUnit] = useState(60);
  const [status, setStatus] = useState("ACTIVE");
  // 차례는 목록에서 끌어다 놓아 정합니다. 새 장비는 맨 뒤에 붙고, 수정할 때는
  // 지금 차례를 그대로 지킵니다.
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
    setSortOrder(items.length);
    setName("");
    setCategory("");
    setDescription("");
    setImageUrl("");
    setUnit(60);
    setStatus("ACTIVE");
    setSortOrder(0);
    setLicenseIds([]);
  }
  /**
   * 목록에서 끌어다 놓은 차례를 저장합니다.
   *
   * 화면을 먼저 옮기고(끌어 놓은 자리에 그대로 있어야 자연스럽습니다) 서버에
   * 알립니다. 실패하면 서버 값을 다시 읽어 되돌립니다.
   */
  async function reorder(ids: string[]) {
    const byId = new Map(items.map((item) => [String(item.id), item]));
    setRows(ids.map((id) => byId.get(id)).filter(Boolean) as unknown as AdminRow[]);
    const response = await adminSend("/admin/equipment/order", "PUT", { ids });
    if (!response.ok) {
      setMessage("차례를 저장하지 못했습니다.");
      await reload();
      return;
    }
    setMessage("장비 차례를 저장했습니다. 공개 화면에 바로 반영됩니다.");
  }

  /**
   * 지금 폼의 값과, 지금 고치고 있는 대상의 원래 값.
   *
   * 저장하지 않은 변경을 '고칠 때마다 깃발을 세우는' 방식으로 잡지 않고 두 값을
   * 견주어 잡습니다. 그래야 고쳤다가 되돌려 놓은 경우에 헛물음이 뜨지 않고,
   * 저장 뒤 목록을 다시 읽으면 기준값이 저절로 새 값이 됩니다.
   *
   * 라이선스는 켰다 끄면 차례가 달라질 수 있어 정렬해서 견줍니다.
   */
  const draft = { name, category, description, imageUrl, unit, status, sortOrder, licenseIds: [...licenseIds].sort() };
  const editingRow = selectedId ? (items.find((item) => String(item.id) === selectedId) as AdminEquipmentItem | undefined) : undefined;
  const baseline = editingRow
    ? {
        name: editingRow.name ?? "", category: editingRow.category ?? "", description: editingRow.description ?? "",
        imageUrl: editingRow.imageUrl ?? "", unit: Number(editingRow.reservationUnitMinutes ?? 30),
        status: editingRow.status ?? "ACTIVE", sortOrder: Number(editingRow.sortOrder ?? 0),
        licenseIds: (editingRow.requiredLicenseIds ?? []).map(String).sort(),
      }
    : { name: "", category: "", description: "", imageUrl: "", unit: 60, status: "ACTIVE", sortOrder: 0, licenseIds: [] };
  const dirty = changed(draft, baseline);
  // 새 장비를 등록하는 중에는 '저장하고 이동' 을 주지 않습니다. 반쯤 쓰다 만
  // 장비가 실제로 등록되면 회원 화면에 그대로 뜹니다.
  useUnsaved(dirty, "보유 장비", selectedId ? submit : undefined);

  async function submit(): Promise<boolean> {
    if (!name.trim() || !category.trim()) {
      setMessage("장비명과 분류를 입력해 주세요.");
      return false;
    }
    const target = selectedId ? `/admin/equipment/${selectedId}` : "/admin/equipment";
    const payload = { name, category, description, imageUrl: imageUrl || null, status, reservationUnitMinutes: unit, sortOrder };
    const response = await adminSend(target, selectedId ? "PATCH" : "POST", payload).catch(() => null);
    if (!response?.ok) {
      setMessage(response?.status === 409 ? "같은 이름의 장비가 이미 있습니다." : "저장하지 못했습니다. 로그인과 권한을 확인해 주세요.");
      return false;
    }
    // The licence requirement is a separate resource, so it is written right
    // after the equipment row exists.
    const id = selectedId || String(((await response.json()) as { id: string }).id);
    await adminSend(`/admin/equipment/${id}/licenses`, "PUT", { licenseIds });
    setMessage(`장비를 ${selectedId ? "수정" : "등록"}했습니다.`);
    reset();
    await reload();
    return true;
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
      {/* 어떤 파일을 올려야 하는지 올리는 자리에서 알려 줍니다. 배경을 지운 PNG 가
          아니면 카드의 옅은 바탕이 가려져, 흰 로봇·흰 로봇 손 사진이 흰 네모 안에서
          다시 안 보이게 됩니다. 실제로 그 때문에 사진이 안 올라온 것처럼 보였습니다. */}
      <p className="form-note">
        사진은 <b>배경을 지운 PNG</b> 로 올려 주세요. 여백은 저희가 알아서 떼고 크기를 맞추므로 잘라 두실 필요는 없습니다.
        배경이 흰색으로 채워진 파일(JPG 등)을 올리면 카드에 흰 네모로 얹혀, 흰 로봇처럼 밝은 장비는 잘 보이지 않습니다.
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
      </div>
      {/* 노출 순서를 숫자로 적는 칸은 없앴습니다. 같은 숫자를 두 장비에 적으면
          이름순으로 갈려서 "바꿨는데 그대로" 로 보였습니다. 아래 목록을 끌어다
          놓으면 차례가 0부터 다시 매겨지므로 겹칠 일이 없습니다. */}
      <fieldset className="license-picker">
        <legend>예약에 필요한 라이선스</legend>
        {/*
          아무것도 고르지 않은 상태가 곧 '라이선스 필요 없음' 입니다. 그런데 빈
          목록만 보면 아직 안 고른 것인지 필요 없다는 뜻인지 알 수 없어, 뜻을
          눈에 보이게 적어 둡니다. 이 칸을 켜면 고른 라이선스가 모두 풀립니다.
        */}
        <label className="toggle-field license-free">
          <input
            type="checkbox"
            checked={licenseIds.length === 0}
            onChange={(event) => { if (event.target.checked) setLicenseIds([]); }}
          />
          <span><b>라이선스 필요 없음</b> — 승인된 회원이면 누구나 예약할 수 있습니다.</span>
        </label>
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
        <button className="button" type="button" onClick={() => void submit()}>
          {selectedId ? "장비 수정" : "장비 등록"}
        </button>
        <UnsavedMark dirty={dirty} />
        {selectedId && (
          <button className="button secondary" type="button" onClick={reset}>
            취소
          </button>
        )}
        {message && <p className="save-notice" role="status">{message}</p>}
      </div>
      {selected && <UnitEditor equipment={selected} onChanged={reload} />}
      <ContentPreview title={name} body={`<p>${description || "장비 설명이 여기에 표시됩니다."}</p>`} />
      <AdminItems
        rows={rows}
        onEdit={edit}
        onDelete={remove}
        onReorder={reorder}
        selectedId={selectedId}
        emptyLabel="등록된 장비가 없습니다. 첫 장비를 등록해 주세요."
      />
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
  const inputDate = (value: unknown) =>
    value ? new Date(String(value)).toISOString().slice(0, 16) : "";
  // 지금 폼의 값과, 고치고 있는 일정의 원래 값(EquipmentForm 의 설명 참고).
  const draft = { title, category, startsAt, endsAt, description, published, memberIds: [...memberIds].sort() };
  const editingRow = selectedId ? allRows.find((row) => String(row.id) === selectedId) : undefined;
  const baseline = editingRow
    ? {
        title: String(editingRow.title ?? ""),
        category: String(editingRow.category ?? fixedCategory ?? "SHAPE-UP"),
        startsAt: inputDate(editingRow.starts_at ?? editingRow.startsAt),
        endsAt: inputDate(editingRow.ends_at ?? editingRow.endsAt),
        description: String(editingRow.description ?? ""),
        published: editingRow.isPublished !== false,
        memberIds: ((editingRow as unknown as AdminRoadmapItem).memberIds ?? []).map(String).sort(),
      }
    : { title: "", category: fixedCategory ?? "SHAPE-UP", startsAt: "", endsAt: "", description: "", published: true, memberIds: [] };
  const dirty = changed(draft, baseline);
  useUnsaved(dirty, fixedCategory ?? "전체 로드맵", selectedId ? submit : undefined);

  async function submit(): Promise<boolean> {
    if (!startsAt) {
      setMessage("시작 날짜를 입력해 주세요.");
      return false;
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
      return response.ok;
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
      return true;
    }
  }
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
                    <ScrollingName name={directory.find((person) => person.id === id)?.name ?? id} className="chip-name" />
                    <i aria-hidden="true">×</i>
                  </button>
                ))}
              </div>
            )}
            <FilterBox value={memberQuery} onChange={setMemberQuery} placeholder="이름이나 이메일로 검색" count={memberIds.length} />
            <div className="permission-grid">
              {directory
                .filter((person) => !memberQuery.trim() || matches(`${person.name} ${person.email}`, memberQuery))
                .map((person) => (
                  <label className="toggle-field with-face" key={person.id}>
                    <input
                      type="checkbox"
                      checked={memberIds.includes(person.id)}
                      onChange={(event) =>
                        setMemberIds((current) =>
                          event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                        )
                      }
                    />
                    <Avatar name={person.name} imageUrl={person.imageUrl} />
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
        <button className="button" type="button" onClick={() => void submit()}>
          {selectedId ? "일정 수정" : published ? "일정 등록하고 공개" : "일정 임시 저장"}
        </button>
        <UnsavedMark dirty={dirty} />
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
  const [visibility, setVisibility] = useState<LinkScope>("PUBLIC");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const { ask, dialogNode } = useAsk();
  const { rows, reload } = useAdminRows("/admin/links");
  // 지금 폼의 값과, 고치고 있는 링크의 원래 값(EquipmentForm 의 설명 참고).
  const draft = { title, url, description, sortOrder, published, visibility };
  const editingRow = selectedId ? rows.find((row) => String(row.id) === selectedId) : undefined;
  const baseline = editingRow
    ? {
        title: String(editingRow.title ?? ""),
        url: String(editingRow.url ?? ""),
        description: String(editingRow.description ?? ""),
        sortOrder: Number(editingRow.sortOrder ?? 0),
        published: editingRow.isPublished !== false,
        visibility: (["PUBLIC", "MEMBER", "STAFF"] as const).find((scope) => scope === editingRow.visibility) ?? "PUBLIC",
      }
    : { title: "", url: "", description: "", sortOrder: 0, published: true, visibility: "PUBLIC" as LinkScope };
  const dirty = changed(draft, baseline);
  useUnsaved(dirty, "관련 링크", selectedId ? submit : undefined);
  function reset() {
    setSelectedId(""); setTitle(""); setUrl(""); setDescription(""); setSortOrder(0); setPublished(true); setVisibility("PUBLIC");
  }
  async function submit(): Promise<boolean> {
    if (!title.trim() || !/^https?:\/\//.test(url.trim())) {
      setMessage("링크 이름과 http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.");
      return false;
    }
    const target = selectedId ? `/admin/links/${selectedId}` : "/admin/links";
    const response = await adminSend(target, selectedId ? "PATCH" : "POST", {
      title: title.trim(), url: url.trim(), description, sortOrder, isPublished: published, visibility,
    });
    setMessage(response.ok ? "링크를 저장했습니다." : "저장하지 못했습니다. 주소 형식과 권한을 확인해 주세요.");
    if (response.ok) {
      reset();
      await reload();
    }
    return response.ok;
  }
  function edit(row: AdminRow) {
    setSelectedId(String(row.id));
    setTitle(String(row.title ?? ""));
    setUrl(String(row.url ?? ""));
    setDescription(String(row.description ?? ""));
    setSortOrder(Number(row.sortOrder ?? 0));
    setPublished(row.isPublished !== false);
    // 예전에 만든 링크에는 이 칸이 없습니다. 없으면 지금까지의 동작대로 전체 공개입니다.
    setVisibility((["PUBLIC", "MEMBER", "STAFF"] as const).find((scope) => scope === row.visibility) ?? "PUBLIC");
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
      <VisibilityChoice value={visibility} onChange={setVisibility} />
      <div className="admin-actions">
        <button className="button" type="button" onClick={() => void submit()}>
          {selectedId ? "링크 수정" : published ? "링크 등록하고 공개" : "링크 임시 저장"}
        </button>
        <UnsavedMark dirty={dirty} />
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
  APPROVED: "활동 회원",
  // 보기 전용. 로그인해서 읽기만 하고 글쓰기·예약은 하지 않습니다.
  VIEWER: "보기 전용",
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
  // 지금 폼의 값과, 고치고 있는 라이선스의 원래 값(EquipmentForm 의 설명 참고).
  const editingLicense = selectedId ? licenses.find((license) => license.id === selectedId) : undefined;
  const dirty = changed(
    { name, description },
    editingLicense ? { name: editingLicense.name, description: editingLicense.description ?? "" } : { name: "", description: "" },
  );
  useUnsaved(dirty, "라이선스", selectedId ? submit : undefined);
  async function submit(): Promise<boolean> {
    if (!name.trim()) {
      setMessage("라이선스 이름을 입력해 주세요.");
      return false;
    }
    const target = selectedId ? `/admin/licenses/${selectedId}` : "/admin/licenses";
    const response = await adminSend(target, selectedId ? "PATCH" : "POST", { name: name.trim(), description: description || null, isActive: true }).catch(() => null);
    if (!response?.ok) {
      setMessage(response?.status === 409 ? "같은 이름의 라이선스가 이미 있습니다." : "저장하지 못했습니다.");
      return false;
    }
    setMessage(selectedId ? "라이선스를 수정했습니다." : "라이선스를 등록했습니다.");
    setSelectedId("");
    setName("");
    setDescription("");
    await reload();
    return true;
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
        <button className="button" type="button" onClick={() => void submit()}>
          {selectedId ? "라이선스 수정" : "라이선스 등록"}
        </button>
        <UnsavedMark dirty={dirty} />
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
  const { say, node: notice } = useNotice();
  const reload = useCallback(async () => {
    const query = filter === "ALL" ? "" : `?status=${filter}`;
    const response = await adminFetch(`/admin/reservations${query}`).catch(() => null);
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
  }, [filter, say]);
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
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "처리하지 못했습니다. 같은 시간에 확정된 예약이 있는지 확인해 주세요.", false);
      return;
    }
    say(approve
      ? `${row.userName} 님의 ${row.equipmentName} 예약을 승인했습니다.`
      : `${row.userName} 님의 ${row.equipmentName} 예약을 반려했습니다.`);
    await reload();
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
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "취소하지 못했습니다.", false);
      return;
    }
    say("예약을 취소하고 시간을 다시 열었습니다.");
    await reload();
  }
  return (
    <div className="admin-form">
      <p className="form-note">
        승인하면 해당 시간이 다른 회원에게 확정 예약으로 표시되고, 데이터베이스가 중복 슬롯을 차단합니다. 사용 전후 사진은 회원이 올린 그대로 확인할 수 있습니다.
      </p>
      {/* 승인 단추가 사이트 밖에도 무언가를 남긴다는 것을 운영진이 알아야 합니다.
          그 캘린더는 SHAPE 만 보는 곳이 아니라 장비를 함께 쓰는 다른 분들도 봅니다. */}
      <p className="form-note">
        <strong>AI Worker</strong> 예약은 승인하는 순간 동아리 공유 캘린더 ‘휴머노이드 운용’ 에도 일정이 올라가고, 취소하면 그 일정이 지워집니다.
        반려한 예약은 캘린더에 올라간 적이 없으므로 지울 것도 없습니다.
      </p>
      <div className="board-filter" aria-label="예약 상태 필터">
        {["PENDING", "APPROVED", "IN_USE", "COMPLETED", "ALL"].map((value) => (
          <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {value === "ALL" ? "전체" : reservationStatusLabel[value]}
          </button>
        ))}
      </div>
      {notice}
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
  const [query, setQuery] = useState("");
  const { say, node: notice } = useNotice();
  const { ask, dialogNode } = useAsk();
  const reload = useCallback(async () => {
    const response = await adminFetch("/admin/users").catch(() => null);
    if (!response?.ok) {
      say(response ? "회원 관리는 Owner만 수행할 수 있습니다." : "백엔드 서버에 연결하지 못했습니다.", false);
      setRows([]);
      return;
    }
    setRows((await response.json()) as AdminUserItem[]);
  }, [say]);
  useEffect(() => {
    const load = async () => { await reload(); };
    void load();
    void adminFetch("/admin/licenses")
      .then(async (response) => {
        if (response.ok) setLicenses((await response.json()) as LicenseItem[]);
      })
      .catch(() => undefined);
  }, [reload]);
  /**
   * 화면을 먼저 바꾸고 서버에 보냅니다.
   *
   * 예전에는 응답을 기다렸다가 회원 목록 **전체**를 다시 읽었습니다. 그동안
   * 체크 상자는 누르기 전 상태 그대로였다가 목록이 통째로 갈릴 때 한 번에
   * 바뀌어서, 누를 때마다 화면이 튕기는 것처럼 보였습니다. 실패하면 되돌리고
   * 이유를 알립니다.
   */
  const patch = useCallback((id: string, change: (row: AdminUserItem) => Partial<AdminUserItem>) => {
    setRows((current) => current?.map((row) => (row.id === id ? { ...row, ...change(row) } : row)) ?? current);
  }, []);

  async function setStatus(user: AdminUserItem, status: MemberStatus) {
    const before = user.status;
    patch(user.id, () => ({ status }));
    const response = await adminSend(`/admin/users/${user.id}/status`, "PATCH", { status });
    if (response.ok) {
      say(`${user.name} 회원 상태를 ${memberStatusLabel[status]}(으)로 바꿨습니다.`);
      return;
    }
    patch(user.id, () => ({ status: before }));
    // 자기 계정을 스스로 정지시키려 한 경우처럼 서버가 이유를 돌려줍니다.
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    say(detail?.detail ?? "상태를 바꾸지 못했습니다.", false);
  }

  async function togglePermission(user: AdminUserItem, permission: string, granted: boolean) {
    const wanted = !granted;
    const label = permissionLabels.find(([key]) => key === permission)?.[1] ?? permission;
    const write = (has: boolean) => patch(user.id, (row) => ({
      permissions: has
        ? [...new Set([...row.permissions, permission])]
        : row.permissions.filter((each) => each !== permission),
    }));
    write(wanted);
    const response = granted
      ? await adminFetch(`/admin/users/${user.id}/permissions/${encodeURIComponent(permission)}`, { method: "DELETE" })
      : await adminSend(`/admin/users/${user.id}/permissions`, "POST", { permission });
    if (response.ok) {
      say(`${user.name} 님의 ‘${label}’ 권한을 ${wanted ? "부여" : "회수"}했습니다.`);
      return;
    }
    write(!wanted);
    say("권한을 변경하지 못했습니다. 로그인과 Owner 권한을 확인해 주세요.", false);
  }

  /**
   * 권한이나 교육을 한 번에 맞춥니다.
   *
   * 한 칸씩 보내면 권한 일곱 개에 요청이 일곱 번 나갑니다. 분당 쓰기가 20회로
   * 묶여 있어 두 사람만 연달아 처리해도 한도에 걸리므로, 전체를 다룰 때는
   * 목록을 통째로 보내는 창구를 씁니다.
   */
  async function setAll(user: AdminUserItem, what: "permissions" | "licenses", full: boolean) {
    const wanted = full
      ? what === "permissions" ? permissionLabels.map(([key]) => key) : licenses.map((license) => license.id)
      : [];
    const before = what === "permissions" ? user.permissions : user.licenseIds;
    const field = what === "permissions" ? "permissions" : "licenseIds";
    patch(user.id, () => ({ [field]: wanted }) as Partial<AdminUserItem>);
    const body = what === "permissions" ? { permissions: wanted } : { licenseIds: wanted };
    const response = await adminSend(`/admin/users/${user.id}/${what}`, "PUT", body);
    if (response.ok) {
      const label = what === "permissions" ? "관리 권한" : "장비 라이선스";
      say(`${user.name} 님의 ${label}을 ${full ? `전체 부여(${wanted.length}개)` : "전체 해제"}했습니다.`);
      return;
    }
    patch(user.id, () => ({ [field]: before }) as Partial<AdminUserItem>);
    say(full ? "전체 부여에 실패했습니다." : "전체 해제에 실패했습니다.", false);
  }

  /** owner 로 올리거나 내립니다. 올리면 관리 권한도 함께 채워집니다. */
  async function setOwner(user: AdminUserItem, next: boolean) {
    const confirmed = await ask(next ? {
      title: `${user.name} 님을 owner 로 지명할까요?`,
      description: "owner 는 모든 관리 기능과 회원 관리를 쓸 수 있습니다. 지명하면 관리 권한도 함께 채워지고, 승인 대기 상태였다면 승인됩니다.",
      confirmLabel: "owner 로 지명",
    } : {
      title: `${user.name} 님의 owner 를 내릴까요?`,
      description: "회원 관리 권한이 사라집니다. 이미 가진 관리 권한은 그대로 남으니, 필요하면 아래에서 개별로 해제해 주세요.",
      confirmLabel: "owner 내리기",
      tone: "danger" as const,
    });
    if (confirmed === null) return;
    const response = await adminSend(`/admin/users/${user.id}/owner`, "PATCH", { isOwner: next });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "owner 를 바꾸지 못했습니다.", false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { permissions?: string[] };
    patch(user.id, (existing) => ({
      isOwner: next,
      status: next ? "APPROVED" : existing.status,
      permissions: result.permissions ?? existing.permissions,
    }));
    say(next
      ? `${user.name} 님을 owner 로 지명하고 관리 권한을 모두 부여했습니다.`
      : `${user.name} 님의 owner 를 내렸습니다. 관리 권한은 그대로 남아 있습니다.`);
  }

  async function toggleLicense(user: AdminUserItem, licenseId: string, granted: boolean) {
    const wanted = !granted;
    const name = licenses.find((license) => license.id === licenseId)?.name ?? "라이선스";
    const write = (has: boolean) => patch(user.id, (row) => ({
      licenseIds: has
        ? [...new Set([...row.licenseIds, licenseId])]
        : row.licenseIds.filter((each) => each !== licenseId),
    }));
    write(wanted);
    const response = granted
      ? await adminFetch(`/admin/users/${user.id}/licenses/${licenseId}`, { method: "DELETE" })
      : await adminSend(`/admin/users/${user.id}/licenses`, "POST", { licenseId });
    if (response.ok) {
      say(`${user.name} 님의 ‘${name}’ 이수를 ${wanted ? "등록" : "취소"}했습니다.`);
      return;
    }
    write(!wanted);
    say("라이선스를 변경하지 못했습니다.", false);
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
      {notice}
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
                {/* owner 는 여러 명일 수 있습니다. 기존 owner 가 새 owner 를 지명합니다. */}
                <button
                  type="button"
                  className={row.isOwner ? "text-button danger" : "text-button"}
                  onClick={() => void setOwner(row, !row.isOwner)}
                >
                  {row.isOwner ? "owner 내리기" : "owner 로 지명"}
                </button>
              </div>
              <div className="grant-head">
                <p className="form-note">관리 권한</p>
                {!row.isOwner && (
                  <span className="grant-bulk">
                    <button type="button" className="text-button" onClick={() => void setAll(row, "permissions", true)}>전체 부여</button>
                    <button type="button" className="text-button" onClick={() => void setAll(row, "permissions", false)}>전체 해제</button>
                  </span>
                )}
              </div>
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
              <div className="grant-head">
                <p className="form-note">장비 라이선스</p>
                {licenses.length > 0 && (
                  <span className="grant-bulk">
                    <button type="button" className="text-button" onClick={() => void setAll(row, "licenses", true)}>전체 부여</button>
                    <button type="button" className="text-button" onClick={() => void setAll(row, "licenses", false)}>전체 해제</button>
                  </span>
                )}
              </div>
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
      {dialogNode}
    </div>
  );
}

/* ------------------------------------------------------------------ 서버 사용량 */

type UsageMetric = {
  key: string;
  label: string;
  used: number | string | null;
  limit: number | null;
  unit: string | null;
  ratio: number | null;
  projected: number | null;
  projectedRatio: number | null;
  monthly: number | null;
  monthlyRatio: number | null;
  exhaustsOn: string | null;
  exhaustsInDays: number | null;
  exhaustsBeforeReset: boolean;
  basis: "calendar" | "rolling" | "point" | null;
  level: "ok" | "warn" | "crit" | "over" | "info" | "unknown";
  hint: string | null;
};
type UsageCycle = {
  kind: "calendar" | "rolling" | "point";
  label: string;
  resets: string | null;
  start: string | null;
  end: string | null;
  daysElapsed: number | null;
  daysTotal: number;
  daysLeft: number | null;
  note: string;
};
type UsageService = {
  service: string;
  role: string;
  plan: string;
  cycle: UsageCycle;
  metrics: UsageMetric[];
  unavailable?: string;
};
type UsageSnapshot = {
  collectedAt: string;
  services: UsageService[];
  problems: Record<string, string>;
  cached?: boolean;
};

/** 소수점을 값의 크기에 맞춘다. 0.03 GB 를 "0 GB" 로 보여 주면 읽을 수 없다. */
function amount(value: number | string | null, unit: string | null) {
  if (value === null) return "—";
  if (typeof value === "string") return unit ? `${value} ${unit}` : value;
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`;
}

function percent(ratio: number | null) {
  if (ratio === null) return "—";
  return `${(ratio * 100).toLocaleString("ko-KR", { maximumFractionDigits: ratio < 0.1 ? 1 : 0 })}%`;
}

/** 소진 예정일은 '몇 월 며칠' 까지만 있으면 됩니다. 시각은 읽는 데 방해됩니다. */
function shortDate(when: string) {
  return new Date(when).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function collectedAgo(when: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(when).getTime()) / 60000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
}

const dayText = (days: number | null) =>
  days === null ? "" : `${days.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}일`;

/**
 * 계기 한 줄.
 *
 * 막대는 **한도를 가득 채운 상태가 100%** 입니다. 예상치는 막대 위에 겹치지
 * 않고 아래 글로 따로 적습니다 — 예상치가 한도를 넘으면 막대 안에 그릴 자리가
 * 없어지고, 억지로 줄여 그리면 지금 값과 예상치의 크기 비교가 망가집니다.
 */
function UsageBar({ metric }: { metric: UsageMetric }) {
  if (metric.limit === null)
    return (
      <div className="usage-row">
        <div className="usage-row-head">
          <span className="usage-name">{metric.label}</span>
          <b className="usage-value">{amount(metric.used, metric.unit)}</b>
        </div>
        {metric.hint && <p className="usage-hint">{metric.hint}</p>}
      </div>
    );
  const filled = Math.min(Math.max(metric.ratio ?? 0, 0), 1) * 100;
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span className="usage-name">{metric.label}</span>
        <b className="usage-value">
          {amount(metric.used, null)}
          <i> / {amount(metric.limit, metric.unit)}</i>
        </b>
      </div>
      <div className={`usage-track level-${metric.level}`}>
        <span style={{ width: `${filled}%` }} />
      </div>
      <div className="usage-figures">
        <span className={`usage-now level-${metric.level}`}>지금 {percent(metric.ratio)}</span>
        {metric.basis === "calendar" && metric.projected !== null && (
          <>
            <span className={(metric.projectedRatio ?? 0) >= 1 ? "over" : undefined}>
              기간 말 {amount(metric.projected, null)} ({percent(metric.projectedRatio)})
            </span>
            <span className={(metric.monthlyRatio ?? 0) >= 1 ? "over" : undefined}>
              30일 환산 {amount(metric.monthly, null)} ({percent(metric.monthlyRatio)})
            </span>
          </>
        )}
        {metric.basis === "rolling" && <span>이 값이 이미 최근 30일 합계입니다</span>}
        {metric.basis === "point" && <span>지금 이 순간의 값이라 쌓이지 않습니다</span>}
      </div>
      {metric.exhaustsBeforeReset && metric.exhaustsOn && (
        <p className="usage-deadline">
          이 속도면 <b>{shortDate(metric.exhaustsOn)}</b>에 바닥납니다 — 초기화되기 전입니다.
        </p>
      )}
      {metric.hint && <p className="usage-hint">{metric.hint}</p>}
    </div>
  );
}

/** 서비스마다 '한 달' 이 다르므로, 주기를 카드 머리에 먼저 밝힌다. */
function CycleBadge({ cycle }: { cycle: UsageCycle }) {
  const progress =
    cycle.kind === "calendar" && cycle.daysElapsed !== null && cycle.daysTotal
      ? Math.min(cycle.daysElapsed / cycle.daysTotal, 1) * 100
      : null;
  return (
    <div className="usage-cycle">
      <div className="usage-cycle-head">
        <span className={`usage-chip ${cycle.kind}`}>{cycle.label}</span>
        {cycle.kind === "calendar" && cycle.start && cycle.end ? (
          <span>
            {cycle.start.slice(5, 10).replace("-", "/")} ~ {cycle.end.slice(5, 10).replace("-", "/")}
            {" · "}
            {dayText(cycle.daysElapsed)} 지남, <b>{dayText(cycle.daysLeft)} 남음</b>
          </span>
        ) : (
          <span>초기화되는 날 없음</span>
        )}
      </div>
      {progress !== null && (
        <div className="usage-track period">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      <p>{cycle.note}</p>
    </div>
  );
}

/**
 * 무료 한도를 얼마나 썼는지 보는 화면. owner 만 볼 수 있습니다.
 *
 * **탭을 열 때만 모읍니다.** 주기적으로 모으는 시계를 두면 아무도 안 볼 때도
 * 서버가 깨어 있어야 하고, 그 깨어 있는 시간이 곧 Neon 한도에서 가장 먼저 닳는
 * 항목입니다. 백엔드도 여섯 시간 동안 값을 들고 있으므로, 이 탭을 하루에 몇 번
 * 열든 바깥으로 나가는 요청은 그대로입니다.
 */
function ServerUsage() {
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState(false);

  /**
   * 처음 한 번은 화면이 뜰 때 읽습니다. 다 읽기 전에 다른 탭으로 옮겨 가면
   * 사라진 화면에 값을 넣게 되므로, `active` 로 막습니다.
   */
  useEffect(() => {
    let active = true;
    void adminFetch("/admin/usage").then(async (response) => {
      if (!active) return;
      if (!response.ok) return setState("failed");
      const body = (await response.json()) as UsageSnapshot;
      if (!active) return;
      setData(body);
      setState("ready");
    });
    return () => {
      active = false;
    };
  }, []);

  /** '다시 모으기'. 백엔드가 들고 있던 값을 버리고 지금 값을 새로 모읍니다. */
  const refresh = useCallback(async () => {
    setBusy(true);
    const response = await adminFetch("/admin/usage?refresh=true");
    if (response.ok) {
      setData((await response.json()) as UsageSnapshot);
      setState("ready");
    }
    setBusy(false);
  }, []);

  if (state === "loading") return <p className="usage-note">사용량을 모으는 중입니다…</p>;
  if (state === "failed" || !data)
    return <p className="usage-note">사용량을 읽지 못했습니다. 잠시 후 다시 열어 주세요.</p>;

  const worst = data.services
    .flatMap((service) => service.metrics)
    .filter((metric) => metric.limit !== null)
    .sort((a, b) => (b.monthlyRatio ?? b.ratio ?? 0) - (a.monthlyRatio ?? a.ratio ?? 0))[0];

  return (
    <div className="usage-panel">
      <div className="usage-top">
        <div>
          <p className="usage-note">
            {collectedAgo(data.collectedAt)}에 모은 값입니다.
            {data.cached ? " 여섯 시간마다 한 번만 새로 모읍니다." : " 방금 새로 모았습니다."}
          </p>
          {worst && (worst.monthlyRatio ?? worst.ratio ?? 0) >= 0.7 && (
            <p className="usage-alarm">
              가장 빨리 차는 항목은 <b>{worst.label}</b> 입니다. 이 속도면 한 달에{" "}
              {percent(worst.monthlyRatio ?? worst.ratio)} 까지 갑니다.
              {worst.exhaustsBeforeReset && worst.exhaustsOn && ` 초기화 전인 ${shortDate(worst.exhaustsOn)}에 바닥납니다.`}
            </p>
          )}
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw size={14} /> {busy ? "모으는 중…" : "다시 모으기"}
        </button>
      </div>

      <div className="usage-services">
        {data.services.map((service) => (
          <section className="usage-card" key={service.service}>
            <header>
              <div>
                <strong>{service.service}</strong>
                <span>{service.role}</span>
              </div>
              <em>{service.plan}</em>
            </header>
            <CycleBadge cycle={service.cycle} />
            {service.unavailable && <p className="usage-blocked">{service.unavailable}</p>}
            <div className="usage-rows">
              {service.metrics.map((metric) => (
                <UsageBar key={metric.key} metric={metric} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {Object.keys(data.problems).length > 0 && (
        <div className="usage-problems">
          <h3>읽지 못한 서비스</h3>
          {Object.entries(data.problems).map(([name, why]) => (
            <p key={name}>
              <b>{name}</b> — {why}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 수정 내역 */

type AuditRow = {
  id: string;
  // 백엔드 스키마가 camelCase 로 내보냅니다(`schemas.ORMModel` 의 alias_generator).
  createdAt: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  action: string;
  area: string;
  target: string;
  detail: string;
  method: string;
  path: string;
};
type AuditPage = { items: AuditRow[]; actors: { id: string | null; name: string }[]; areas: string[] };

/**
 * 동작 이름을 한글로. 백엔드는 주소와 방식에서 기계적으로 뽑으므로, 사람이 읽을
 * 말로 옮기는 일은 화면이 맡습니다.
 */
const auditAction: Record<string, { label: string; tone: "make" | "edit" | "drop" }> = {
  create: { label: "만듦", tone: "make" },
  update: { label: "고침", tone: "edit" },
  replace: { label: "바꿈", tone: "edit" },
  delete: { label: "지움", tone: "drop" },
  order: { label: "순서 바꿈", tone: "edit" },
  decision: { label: "승인·반려", tone: "edit" },
  cancel: { label: "취소", tone: "drop" },
  status: { label: "상태 바꿈", tone: "edit" },
  owner: { label: "owner 바꿈", tone: "drop" },
  permissions: { label: "권한 설정", tone: "edit" },
  licenses: { label: "라이선스 설정", tone: "edit" },
};

/**
 * 시각은 24시간으로 씁니다. "오후 07:17" 은 좁은 화면에서 두 줄로 깨지고,
 * 기록을 훑을 때는 오전·오후를 읽는 것보다 숫자가 나란히 서는 편이 낫습니다.
 */
function auditTime(value: string) {
  return new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 같은 날의 기록을 한 덩어리로 묶는다. 날짜가 매 줄 반복되면 읽기 어렵다. */
function byDay(rows: AuditRow[]) {
  const days: { day: string; rows: AuditRow[] }[] = [];
  for (const row of rows) {
    const day = longDate(row.createdAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return days;
}

/**
 * 운영진의 수정 내역. owner 만 볼 수 있습니다.
 *
 * 기록은 쌓이기만 하므로 최신 50건씩 끊어 받고 '더 보기' 로 이어받습니다.
 * 거르개(사람·영역) 목록은 첫 쪽에만 실려 오므로 그대로 들고 씁니다.
 */
function AuditTrail() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filters, setFilters] = useState<{ actors: AuditPage["actors"]; areas: string[] }>({ actors: [], areas: [] });
  const [actor, setActor] = useState("");
  const [area, setArea] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useCallback(
    (before?: string) => {
      const search = new URLSearchParams();
      if (before) search.set("before", before);
      if (actor) search.set("actor", actor);
      if (area) search.set("area", area);
      return `/admin/audit${search.size ? `?${search}` : ""}`;
    },
    [actor, area],
  );

  // 거르개를 바꾸면 처음부터 다시 받습니다.
  useEffect(() => {
    let active = true;
    void adminFetch(query()).then(async (response) => {
      if (!active) return;
      if (!response.ok) return setState("failed");
      const page = (await response.json()) as AuditPage;
      if (!active) return;
      setRows(page.items);
      setMore(page.items.length >= 50);
      // 목록은 첫 쪽에서만 오므로, 거른 뒤에 비어 오면 앞서 받은 것을 지키세요.
      if (page.actors.length || page.areas.length) setFilters({ actors: page.actors, areas: page.areas });
      setState("ready");
    });
    return () => {
      active = false;
    };
  }, [query]);

  const loadMore = useCallback(async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setBusy(true);
    const response = await adminFetch(query(last.createdAt));
    if (response.ok) {
      const page = (await response.json()) as AuditPage;
      setRows((current) => [...current, ...page.items]);
      setMore(page.items.length >= 50);
    }
    setBusy(false);
  }, [query, rows]);

  if (state === "failed") return <p className="usage-note">수정 내역을 읽지 못했습니다.</p>;

  return (
    <div className="audit-panel">
      <div className="audit-filters">
        <label>
          <span>고친 사람</span>
          <select value={actor} onChange={(event) => { setState("loading"); setActor(event.target.value); }}>
            <option value="">모두</option>
            {filters.actors.map((person) => (
              <option key={person.id ?? "gone"} value={person.id ?? ""}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>영역</span>
          <select value={area} onChange={(event) => { setState("loading"); setArea(event.target.value); }}>
            <option value="">모두</option>
            {filters.areas.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state === "loading" ? (
        <p className="usage-note">불러오는 중입니다…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <h2>아직 기록이 없습니다</h2>
          <p>운영진이 관리자 화면에서 무언가를 저장하면 여기에 쌓입니다.</p>
        </div>
      ) : (
        <div className="audit-days">
          {byDay(rows).map((group) => (
            <section key={group.day}>
              <h3>{group.day}</h3>
              <ul>
                {group.rows.map((row) => {
                  const kind = auditAction[row.action] ?? { label: row.action, tone: "edit" as const };
                  return (
                    <li key={row.id}>
                      <time>{auditTime(row.createdAt)}</time>
                      <span className={`audit-badge ${kind.tone}`}>{kind.label}</span>
                      <div className="audit-what">
                        <strong>
                          {row.area}
                          {row.target && <em>{row.target}</em>}
                        </strong>
                        {row.detail && <span className="audit-detail">{row.detail}</span>}
                      </div>
                      <span className="audit-who" title={row.actorEmail}>
                        {row.actorName || "알 수 없음"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {more && rows.length > 0 && (
        <button type="button" className="audit-more" onClick={() => void loadMore()} disabled={busy}>
          {busy ? "불러오는 중…" : "더 보기"}
        </button>
      )}
    </div>
  );
}
