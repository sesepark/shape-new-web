"use client";

import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AutoTextarea } from "@/components/auto-textarea";
import { ImageUploadField } from "@/components/image-upload-field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { board, boardError, boardSend } from "@/lib/board";
import type { ShapeUpDetail } from "@/lib/types";

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
  const [body, setBody] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
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
      setBody(item.contentHtml);
      setGithubUrl(item.githubUrl ?? "");
      setVideoUrl(item.videoUrl ?? "");
      setReady(true);
    });
    return () => { active = false; };
  }, [postId]);

  async function submit() {
    if (!title.trim()) { setMessage("결과물 제목을 입력해 주세요."); return; }
    setBusy(true);
    const payload = {
      title: title.trim(),
      summary: summary.trim(),
      cohort: cohort.trim(),
      teamName: teamName.trim(),
      teamMembers: members.map((name) => name.trim()).filter(Boolean),
      coverImage: coverImage || null,
      contentHtml: body,
      contentJson: {},
      githubUrl: githubUrl.trim() || null,
      videoUrl: videoUrl.trim() || null,
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
      <div className="admin-form">
        <p className="form-note">
          한 학기 동안 만든 결과물을 남깁니다. 여기에 올린 글은 <b>로그인하지 않은 사람에게도 공개</b>되니, 팀 밖의 사람이 읽어도 이해할 수 있게 적어 주세요.
        </p>
        <label>
          결과물 제목
          <input value={title} maxLength={200} placeholder="예: 보행 정책 sim-to-real 이전" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          한 줄 요약
          <AutoTextarea value={summary} maxLength={2000} minRows={2} placeholder="무엇을 만들었고 무엇을 확인했는지 두세 줄로 적어 주세요. 목록 카드에 그대로 보입니다." onChange={setSummary} />
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
        <ImageUploadField value={coverImage} onChange={setCoverImage} purpose="news" label="대표 이미지" />
        <div className="admin-form-row">
          <label>
            GitHub Project Page
            <input type="url" value={githubUrl} placeholder="https://github.com/..." onChange={(event) => setGithubUrl(event.target.value)} />
          </label>
          <label>
            데모 영상 링크
            <input type="url" value={videoUrl} placeholder="https://youtu.be/..." onChange={(event) => setVideoUrl(event.target.value)} />
          </label>
        </div>
        <label>
          본문
          <RichTextEditor value={body} onChange={setBody} purpose="news" placeholder="문제를 어떻게 정했고, 어떤 방법으로 접근했고, 무엇을 확인했는지 적어 주세요. 막힌 지점과 남은 과제도 함께 남기면 다음 기수에 큰 도움이 됩니다." />
        </label>
        <div className="admin-actions">
          <button type="button" className="button" disabled={busy} onClick={submit}>
            {busy ? "저장 중" : postId ? "수정 내용 저장" : "결과물 공개"}
          </button>
          <Link className="button secondary" href={postId ? `/shape-up/${postId}` : "/shape-up"}>취소</Link>
          {message && <p className="save-notice" role="status">{message}</p>}
        </div>
      </div>
    </div>
  );
}
