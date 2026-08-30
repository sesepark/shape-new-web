"use client";

import Link from "next/link";
import { ArrowLeft, GripVertical, Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AutoTextarea } from "@/components/auto-textarea";
import { ImageUploadField } from "@/components/image-upload-field";
import { board, boardError, boardSend } from "@/lib/board";
import { youtubeId } from "@/lib/youtube";
import type { ShapeUpBlock, ShapeUpDetail } from "@/lib/types";

/** 방법·결과 각각 담을 수 있는 덩이 수. 백엔드 `ShapeUpWrite` 와 같아야 합니다. */
const MAX_BLOCKS = 12;

type Draft = ShapeUpBlock & { key: number };
let nextKey = 1;
const blank = (): Draft => ({ key: nextKey++, image: "", video: "", caption: "" });
const toDraft = (blocks: ShapeUpBlock[]): Draft[] =>
  blocks.length
    ? blocks.map((block) => ({ key: nextKey++, image: block.image ?? "", video: block.video ?? "", caption: block.caption }))
    : [blank()];

/**
 * 방법·결과에 쌓는 덩이 편집기.
 *
 * 한 덩이는 그림 하나 **또는** 영상 하나에 설명 한 토막입니다. 둘을 함께 넣으면
 * 화면은 영상을 그리므로, 그 사실을 여기서 미리 알려 줍니다 — 그림을 올려 놓고
 * 안 보인다고 여기는 일이 없어야 합니다.
 */
function BlockEditor({
  label,
  hint,
  blocks,
  onChange,
}: {
  label: string;
  hint: string;
  blocks: Draft[];
  onChange: (next: Draft[]) => void;
}) {
  const set = (key: number, patch: Partial<ShapeUpBlock>) =>
    onChange(blocks.map((block) => (block.key === key ? { ...block, ...patch } : block)));
  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="paper-editor-group">
      <legend>{label}</legend>
      <p className="field-hint">{hint}</p>
      {blocks.map((block, index) => {
        const video = (block.video ?? "").trim();
        const badVideo = video.length > 0 && !youtubeId(video);
        return (
          <div className="paper-editor-block" key={block.key}>
            <div className="paper-editor-block-head">
              <span className="paper-editor-block-no"><GripVertical size={14} aria-hidden="true" />{index + 1}</span>
              <div className="inline-actions">
                <button type="button" className="text-button" disabled={index === 0} onClick={() => move(index, -1)}>위로</button>
                <button type="button" className="text-button" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}>아래로</button>
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => onChange(blocks.length > 1 ? blocks.filter((item) => item.key !== block.key) : [blank()])}
                >
                  <X size={14} /> 지우기
                </button>
              </div>
            </div>
            <ImageUploadField
              value={block.image ?? ""}
              onChange={(value) => set(block.key, { image: value })}
              purpose="news"
              label="그림"
            />
            {/* 그림 올리기에도 '또는 이미지 URL' 칸이 있어서, 바로 아래 영상 칸과
                헷갈려 유튜브 주소를 여기 넣는 일이 생깁니다. 거절하지 않고
                서버가 영상 칸으로 옮기므로, 그 사실만 알려 줍니다. */}
            {youtubeId(block.image ?? "") && (
              <p className="field-hint">유튜브 주소네요 — <b>저장하면 아래 영상 칸으로 옮겨집니다.</b></p>
            )}
            <label>
              영상 (유튜브 주소, 선택)
              <input
                type="url"
                value={video}
                placeholder="https://youtu.be/..."
                onChange={(event) => set(block.key, { video: event.target.value })}
              />
              {badVideo ? (
                <small className="field-hint danger">유튜브 주소만 넣을 수 있습니다.</small>
              ) : video && block.image ? (
                <small className="field-hint">영상과 그림을 함께 넣으면 <b>영상이 보입니다.</b></small>
              ) : null}
            </label>
            <label>
              설명
              <AutoTextarea
                value={block.caption}
                maxLength={2000}
                minRows={2}
                placeholder="이 그림·영상이 무엇을 보여 주는지 적어 주세요."
                onChange={(value) => set(block.key, { caption: value })}
              />
            </label>
          </div>
        );
      })}
      {blocks.length < MAX_BLOCKS ? (
        <button type="button" className="text-button" onClick={() => onChange([...blocks, blank()])}>
          <Plus size={15} /> {label} 블록 추가
        </button>
      ) : (
        <p className="field-hint">한 칸에 {MAX_BLOCKS}개까지 넣을 수 있습니다.</p>
      )}
    </fieldset>
  );
}

/**
 * SHAPE-UP 결과물 제출 화면.
 *
 * 예전에는 본문이 자유 편집기 하나여서 팀마다 글의 모양이 달랐습니다. 지금은
 * 논문 프로젝트 페이지의 칸으로 나눠 받고 **그리는 일은 서버가 합니다.** 팀은
 * 채우기만 하면 되고, 채우지 않은 칸은 화면에 아예 나타나지 않습니다.
 */
export function ShapeUpEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const postId = search.get("id");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [cohort, setCohort] = useState("2026-2");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState<string[]>([""]);
  const [coverImage, setCoverImage] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [slidesUrl, setSlidesUrl] = useState("");
  const [abstract, setAbstract] = useState("");
  const [problem, setProblem] = useState("");
  const [limitations, setLimitations] = useState("");
  const [methodBlocks, setMethodBlocks] = useState<Draft[]>([blank()]);
  const [resultBlocks, setResultBlocks] = useState<Draft[]>([blank()]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!postId);

  useEffect(() => {
    if (!postId) return;
    let active = true;
    void board(`/shape-up/${postId}`).then(async (response) => {
      if (!active) return;
      if (!response.ok) { setMessage("결과물을 불러오지 못했습니다."); setReady(true); return; }
      const item = (await response.json()) as ShapeUpDetail;
      setTitle(item.title);
      setSummary(item.summary);
      setCohort(item.cohort);
      setTeamName(item.teamName);
      setMembers(item.teamMembers.length ? item.teamMembers : [""]);
      setCoverImage(item.coverImage ?? "");
      setGithubUrl(item.githubUrl ?? "");
      setVideoUrl(item.videoUrl ?? "");
      setSlidesUrl(item.slidesUrl ?? "");
      setAbstract(item.abstract);
      setProblem(item.problem);
      setLimitations(item.limitations);
      setMethodBlocks(toDraft(item.methodBlocks));
      setResultBlocks(toDraft(item.resultBlocks));
      setReady(true);
    });
    return () => { active = false; };
  }, [postId]);

  /** 저장할 모양으로. 아무것도 안 채운 덩이는 여기서 버립니다(서버도 같은 일을 합니다). */
  const packed = (blocks: Draft[]) =>
    blocks
      .map((block) => ({
        image: (block.image ?? "").trim() || null,
        video: (block.video ?? "").trim() || null,
        caption: block.caption.trim(),
      }))
      .filter((block) => block.image || block.video || block.caption);

  const badVideo = [videoUrl, ...methodBlocks.map((b) => b.video), ...resultBlocks.map((b) => b.video)]
    .some((url) => (url ?? "").trim() && !youtubeId((url ?? "").trim()));

  async function submit() {
    if (!title.trim()) { setMessage("결과물 제목을 입력해 주세요."); return; }
    if (badVideo) { setMessage("영상은 유튜브 주소만 넣을 수 있습니다. 빨간 글씨가 붙은 칸을 확인해 주세요."); return; }
    setBusy(true);
    const payload = {
      title: title.trim(),
      summary: summary.trim(),
      cohort: cohort.trim(),
      teamName: teamName.trim(),
      teamMembers: members.map((name) => name.trim()).filter(Boolean),
      coverImage: coverImage || null,
      githubUrl: githubUrl.trim() || null,
      videoUrl: videoUrl.trim() || null,
      slidesUrl: slidesUrl.trim() || null,
      abstract: abstract.trim(),
      problem: problem.trim(),
      limitations: limitations.trim(),
      methodBlocks: packed(methodBlocks),
      resultBlocks: packed(resultBlocks),
    };
    const response = postId
      ? await boardSend(`/shape-up/${postId}`, "PATCH", payload)
      : await boardSend("/shape-up", "POST", payload);
    setBusy(false);
    if (!response.ok) { setMessage(boardError(response.status)); return; }
    const saved = (await response.json()) as ShapeUpDetail;
    router.push(`/shape-up/${saved.id}`);
    router.refresh();
  }

  if (!ready) return <p className="form-note">결과물을 불러오고 있습니다.</p>;

  return (
    <div className="board-editor">
      <Link className="detail-back" href={postId ? `/shape-up/${postId}` : "/shape-up"}>
        <ArrowLeft size={16} /> {postId ? "결과물로 돌아가기" : "SHAPE-UP 결과물"}
      </Link>
      <div className="admin-form paper-editor">
        <p className="form-note">
          한 학기 동안 만든 결과물을 남깁니다. 여기에 올린 글은 <b>로그인하지 않은 사람에게도 공개</b>되니,
          팀 밖의 사람이 읽어도 이해할 수 있게 적어 주세요. <b>칸을 채우기만 하면 형식은 알아서 맞춰집니다.</b>
          채우지 않은 칸은 화면에 나타나지 않습니다.
        </p>

        <label>
          결과물 제목
          <input value={title} maxLength={200} placeholder="예: 보행 정책 sim-to-real 이전" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          한 줄 요약
          <AutoTextarea value={summary} maxLength={2000} minRows={2} placeholder="무엇을 만들었고 무엇을 확인했는지 두세 줄로. 목록 카드와 검색 결과에 그대로 보입니다." onChange={setSummary} />
        </label>
        <div className="admin-form-row">
          <label>
            기수
            <input value={cohort} maxLength={20} placeholder="예: 2026-2" onChange={(event) => setCohort(event.target.value)} />
          </label>
          <label>
            팀 이름
            <input value={teamName} maxLength={120} placeholder="예: 워크온" onChange={(event) => setTeamName(event.target.value)} />
          </label>
        </div>
        <fieldset className="member-picker">
          <legend>팀원</legend>
          {members.map((name, index) => (
            <div className="member-row" key={index}>
              <input
                value={name}
                maxLength={40}
                placeholder="이름"
                onChange={(event) => setMembers((current) => current.map((item, i) => (i === index ? event.target.value : item)))}
              />
              <button type="button" aria-label="팀원 삭제" onClick={() => setMembers((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : [""]))}>
                <X size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="text-button" onClick={() => setMembers((current) => [...current, ""])}>
            <Plus size={15} /> 팀원 추가
          </button>
        </fieldset>

        <fieldset className="paper-editor-group">
          <legend>링크 줄</legend>
          <p className="field-hint">낸 것만 결과물 맨 위에 단추로 나옵니다.</p>
          <div className="admin-form-row">
            <label>
              코드 (GitHub)
              <input type="url" value={githubUrl} placeholder="https://github.com/..." onChange={(event) => setGithubUrl(event.target.value)} />
            </label>
            <label>
              발표자료
              <input type="url" value={slidesUrl} placeholder="https://drive.google.com/..." onChange={(event) => setSlidesUrl(event.target.value)} />
            </label>
          </div>
          <label>
            대표 영상 (유튜브)
            <input type="url" value={videoUrl} placeholder="https://youtu.be/..." onChange={(event) => setVideoUrl(event.target.value)} />
            {videoUrl.trim() && !youtubeId(videoUrl.trim()) ? (
              <small className="field-hint danger">유튜브 주소만 넣을 수 있습니다.</small>
            ) : (
              <small className="field-hint">
                영상은 <b>유튜브에만</b> 올립니다. 넣으면 결과물 맨 위에 영상이 바로 재생되고,
                표지 그림을 안 올려도 목록 카드에 미리보기가 뜹니다.
              </small>
            )}
          </label>
        </fieldset>

        <ImageUploadField value={coverImage} onChange={setCoverImage} purpose="news" label="대표 그림 (영상이 없을 때 맨 위에 보입니다)" />
        {youtubeId(coverImage) && (
          <p className="field-hint">유튜브 주소네요 — <b>저장하면 위의 대표 영상으로 옮겨집니다.</b></p>
        )}

        <label>
          초록
          <AutoTextarea value={abstract} maxLength={4000} minRows={4} placeholder="이 결과물을 한 문단으로. 무엇을 목표로 했고, 어떻게 했고, 무엇을 얻었는지." onChange={setAbstract} />
        </label>
        <label>
          문제 설정
          <AutoTextarea value={problem} maxLength={4000} minRows={4} placeholder="왜 이 문제를 골랐고, 무엇이 어려운 점이었는지." onChange={setProblem} />
        </label>

        <BlockEditor
          label="방법"
          hint="어떻게 접근했는지를 그림과 설명으로 나눠 담습니다. 구조도·실험 설정처럼 보여 줄 것이 있으면 블록을 늘려 주세요."
          blocks={methodBlocks}
          onChange={setMethodBlocks}
        />
        <BlockEditor
          label="결과"
          hint="무엇을 확인했는지. 표나 그래프는 그림으로, 로봇이 움직이는 장면은 유튜브 영상으로 넣으면 됩니다."
          blocks={resultBlocks}
          onChange={setResultBlocks}
        />

        <label>
          한계와 다음 과제
          <AutoTextarea value={limitations} maxLength={4000} minRows={4} placeholder="아직 안 되는 것과 다음 기수가 이어서 할 만한 것. 여기가 다음 팀에게 가장 도움이 됩니다." onChange={setLimitations} />
        </label>

        <div className="admin-actions">
          <button type="button" className="button" disabled={busy} onClick={submit}>
            {busy ? "저장 중" : postId ? "수정 내용 저장" : "결과물 공개"}
          </button>
          <Link className="button secondary" href={postId ? `/shape-up/${postId}` : "/shape-up"}>취소</Link>
          {message && <p className="save-notice danger" role="status">{message}</p>}
        </div>
      </div>
    </div>
  );
}
