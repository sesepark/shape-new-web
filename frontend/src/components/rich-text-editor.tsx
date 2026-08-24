"use client";

import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import { useAsk } from "@/components/ask-dialog";
import { uploadImage, type UploadPurpose } from "@/lib/upload";

const colors = ["#111827", "#2855f3", "#e24b72", "#11a884", "#d97706", "#ffffff"];
const sizes = [{ label: "기본", value: "" }, { label: "작게", value: "14px" }, { label: "크게", value: "18px" }, { label: "제목", value: "24px" }];

export function RichTextEditor({
  value,
  onChange,
  purpose = "notice",
  placeholder = "여기에 내용을 쓰세요. 줄을 바꿀 때는 Enter, 같은 문단 안에서 줄만 내릴 때는 Shift+Enter 입니다.",
}: {
  value: string;
  onChange: (value: string) => void;
  /** 본문에 넣는 이미지가 저장될 폴더. 화면마다 다르지만 도구는 동일합니다. */
  purpose?: UploadPurpose;
  placeholder?: string;
}) {
  const { ask, dialogNode } = useAsk();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    // 커서를 옮길 때마다 도구 막대를 다시 그립니다. TipTap 3 부터는 이 값이
    // 꺼져 있어서, 굵게·기울임 같은 단추의 눌림 표시와 글자 크기 상자가 커서를
    // 따라오지 못했습니다. 다른 줄로 가도 상자에는 앞서 고른 크기가 그대로 떠
    // 있어, 지금 이 줄이 이미 큰 것인지 알 수 없었습니다.
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } } }),
      TextStyle,
      // 예전에는 textStyle 마크에 직접 fontSize 를 넣으려 해서 글자 크기가
      // 조용히 무시됐습니다. 전용 확장을 써야 style 로 나갑니다.
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: value,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    editorProps: { attributes: { "aria-label": "본문 편집기", class: "tiptap" } },
  });
  useEffect(() => { if (editor && editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false }); }, [editor, value]);
  if (!editor) return <div className="editor-loading">편집기를 준비하고 있습니다.</div>;

  /**
   * 지금 커서가 놓인 글자의 크기. 고른 글자가 있으면 그 크기입니다.
   *
   * 예전에는 이 상자가 고른 곳과 아무 상관 없이 마지막으로 누른 값을 계속
   * 보여 줬습니다. 그래서 다른 줄을 골라도 상자에는 '크게' 가 떠 있어, 지금 이
   * 줄이 이미 큰 것인지 아닌지 알 수 없었습니다. 같은 값을 다시 고르면 아무 일도
   * 일어나지 않는 것도 같은 이유였습니다.
   */
  const activeSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  const pickedSize = sizes.some((size) => size.value === activeSize) ? activeSize : "";

  /**
   * 글자 크기를 적용합니다.
   *
   * **고른 글자가 없으면 커서가 있는 줄 전체에 겁니다.** 예전에는 이럴 때
   * ProseMirror 가 '다음에 입력할 글자' 에만 크기를 걸어 두었습니다. 화면에는
   * 아무 변화가 없다가 이어 쓰는 글자마다 커져서, 고르지도 않은 곳이 점점
   * 커지는 것처럼 보였습니다. 어디에 걸리는지 눈에 보이는 쪽이 낫습니다.
   */
  function applySize(fontSize: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) {
      const { $from } = editor.state.selection;
      chain.setTextSelection({ from: $from.start(), to: $from.end() });
    }
    if (fontSize) chain.setFontSize(fontSize).run();
    else chain.unsetFontSize().run();
  }

  const action = (label: string, run: () => void, active = false, title = label) => <button type="button" title={title} aria-label={title} aria-pressed={active} className={`editor-button${active ? " active" : ""}`} onClick={run}>{label}</button>;
  async function setLink() {
    if (!editor) return;
    const url = await ask({
      title: "링크 넣기",
      description: "선택한 글자에 연결할 주소를 입력해 주세요. 비워 두면 링크가 해제됩니다.",
      confirmLabel: "적용",
      field: { label: "링크 주소", placeholder: "https://", defaultValue: editor.getAttributes("link").href ?? "https://" },
    });
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }
  async function addImageByUrl() {
    if (!editor) return;
    const src = await ask({
      title: "이미지 주소로 넣기",
      description: "이미 인터넷에 올라와 있는 이미지 주소를 붙여 넣습니다. 내 컴퓨터 파일은 '사진' 버튼을 쓰세요.",
      confirmLabel: "넣기",
      field: { label: "이미지 주소", placeholder: "https://", defaultValue: "https://", required: true },
    });
    if (src?.trim()) editor.chain().focus().setImage({ src: src.trim(), alt: "" }).run();
  }
  async function addImageFile(file: File) {
    if (!editor) return;
    setBusy(true);
    setMessage("");
    const result = await uploadImage(file, purpose);
    setBusy(false);
    if (!result.url) { setMessage(result.error ?? "이미지를 올리지 못했습니다."); return; }
    editor.chain().focus().setImage({ src: result.url, alt: "" }).run();
  }

  return <div className="rich-editor">
    <div className="editor-toolbar" role="toolbar" aria-label="글쓰기 도구">
      <span className="editor-tool-group">{action("본문", () => editor.chain().focus().setParagraph().run(), editor.isActive("paragraph"))}{action("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }), "큰 제목")}{action("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }), "중간 제목")}</span>
      <span className="editor-tool-group">{action("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), "굵게")}{action("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), "기울임")}{action("U", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"), "밑줄")}{action("형광", () => editor.chain().focus().toggleHighlight({ color: "#fff1a8" }).run(), editor.isActive("highlight"), "형광펜")}</span>
      <span className="editor-tool-group editor-color-group" aria-label="글자 색상">{colors.map((color) => <button type="button" className="editor-color" title={`${color} 색상`} aria-label={`${color} 색상`} key={color} style={{ backgroundColor: color }} onClick={() => editor.chain().focus().setColor(color).run()} />)}</span>
      <select
        className="editor-size-select"
        aria-label="글자 크기"
        title="글자 크기 — 고른 글자에 적용됩니다. 고른 글자가 없으면 커서가 있는 줄 전체에 적용됩니다."
        value={pickedSize}
        onChange={(event) => applySize(event.target.value)}
      >
        {sizes.map((size) => <option key={size.label} value={size.value}>{size.label}</option>)}
      </select>
      <span className="editor-tool-group">{action("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), "글머리 목록")}{action("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), "번호 목록")}{action("인용", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), "인용문")}</span>
      <span className="editor-tool-group">{action("링크", setLink, editor.isActive("link"))}<label className="editor-button" title="사진 첨부">
        {busy ? "올리는 중" : "사진"}
        <input
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void addImageFile(file); event.target.value = ""; }}
        />
      </label>{action("이미지 주소", addImageByUrl, false, "이미지 주소로 넣기")}{action("↶", () => editor.chain().focus().undo().run(), false, "실행 취소")}{action("↷", () => editor.chain().focus().redo().run(), false, "다시 실행")}</span>
    </div>
    <EditorContent editor={editor} className="editor-content" />
    <div className="editor-status">
      <span>Enter 새 문단 · Shift+Enter 줄바꿈 · 글자를 선택한 뒤 도구를 누르면 적용됩니다</span>
      <b>{editor.storage.characterCount.characters().toLocaleString()}자</b>
    </div>
    {message && <p className="editor-message" role="status">{message}</p>}
    {dialogNode}
  </div>;
}
