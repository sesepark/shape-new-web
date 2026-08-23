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
      <select className="editor-size-select" aria-label="글자 크기" defaultValue="" onChange={(event) => { const fontSize = event.target.value; if (fontSize) editor.chain().focus().setFontSize(fontSize).run(); else editor.chain().focus().unsetFontSize().run(); }}>
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
