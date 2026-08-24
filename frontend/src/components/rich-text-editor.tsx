"use client";

import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Columns3, Highlighter,
  Image as ImageIcon, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, Rows3,
  Sigma, Strikethrough, Table2, Trash2, Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAsk } from "@/components/ask-dialog";
import { LineHeight, MathBlock } from "@/components/editor-extensions";
import { uploadImage, type UploadPurpose } from "@/lib/upload";

/** 글자 색. 마지막 흰색은 어두운 바탕 위에 쓰라고 둡니다. */
const colors = ["#111827", "#2855f3", "#e24b72", "#11a884", "#d97706", "#ffffff"];
const sizes = [
  { label: "기본", value: "" },
  { label: "작게", value: "14px" },
  { label: "크게", value: "18px" },
  { label: "제목", value: "24px" },
];
const lineHeights = [
  { label: "줄 간격", value: "" },
  { label: "좁게", value: "1.4" },
  { label: "보통", value: "1.8" },
  { label: "넓게", value: "2.2" },
];
/** 문단 모양. 이 줄이 어떤 종류인지 한곳에서 고르게 모았습니다. */
const blocks = [
  { label: "본문", value: "paragraph" },
  { label: "제목 1", value: "h1" },
  { label: "제목 2", value: "h2" },
  { label: "제목 3", value: "h3" },
  { label: "인용문", value: "quote" },
  { label: "코드 블록", value: "code" },
];

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
      LineHeight,
      Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({ allowBase64: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // 표는 네 조각이 한 벌입니다. 첫 줄은 제목 칸으로 넣습니다.
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      MathBlock,
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
   * 줄이 이미 큰 것인지 아닌지 알 수 없었습니다.
   */
  const activeSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  const pickedSize = sizes.some((size) => size.value === activeSize) ? activeSize : "";
  const activeHeight = (editor.getAttributes("paragraph").lineHeight as string | undefined)
    ?? (editor.getAttributes("heading").lineHeight as string | undefined) ?? "";
  const pickedHeight = lineHeights.some((row) => row.value === activeHeight) ? activeHeight : "";
  const pickedBlock =
    editor.isActive("heading", { level: 1 }) ? "h1"
    : editor.isActive("heading", { level: 2 }) ? "h2"
    : editor.isActive("heading", { level: 3 }) ? "h3"
    : editor.isActive("blockquote") ? "quote"
    : editor.isActive("codeBlock") ? "code"
    : "paragraph";

  /**
   * 고른 글자가 없으면 커서가 있는 줄 전체를 고릅니다.
   *
   * 예전에는 이럴 때 ProseMirror 가 '다음에 입력할 글자' 에만 걸어 두었습니다.
   * 화면에는 아무 변화가 없다가 이어 쓰는 글자마다 바뀌어서, 고르지도 않은
   * 곳이 점점 바뀌는 것처럼 보였습니다. 어디에 걸리는지 눈에 보이는 쪽이 낫습니다.
   */
  function chainOnLine() {
    const chain = editor!.chain().focus();
    if (editor!.state.selection.empty) {
      const { $from } = editor!.state.selection;
      chain.setTextSelection({ from: $from.start(), to: $from.end() });
    }
    return chain;
  }

  function applySize(fontSize: string) {
    const chain = chainOnLine();
    if (fontSize) chain.setFontSize(fontSize).run();
    else chain.unsetFontSize().run();
  }

  function applyLineHeight(height: string) {
    const chain = editor!.chain().focus();
    if (height) chain.setLineHeight(height).run();
    else chain.unsetLineHeight().run();
  }

  function applyBlock(kind: string) {
    const chain = editor!.chain().focus();
    // 인용문·코드 블록에서 다른 모양으로 옮길 때는 먼저 그 껍질을 벗깁니다.
    if (editor!.isActive("blockquote") && kind !== "quote") chain.lift("blockquote");
    if (editor!.isActive("codeBlock") && kind !== "code") chain.setParagraph();
    if (kind === "h1") chain.setHeading({ level: 1 }).run();
    else if (kind === "h2") chain.setHeading({ level: 2 }).run();
    else if (kind === "h3") chain.setHeading({ level: 3 }).run();
    else if (kind === "quote") chain.setParagraph().setBlockquote().run();
    else if (kind === "code") chain.setCodeBlock().run();
    else chain.setParagraph().run();
  }

  /** 도구 단추 하나. 아이콘과 설명은 짝을 이뤄야 눌러 보지 않고도 압니다. */
  const tool = (icon: ReactNode, title: string, run: () => void, active = false, disabled = false) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={`editor-button${active ? " active" : ""}`}
      onClick={run}
    >
      {icon}
    </button>
  );

  async function setLink() {
    const url = await ask({
      title: "링크 넣기",
      description: "선택한 글자에 연결할 주소를 입력해 주세요. 비워 두면 링크가 해제됩니다.",
      confirmLabel: "적용",
      field: { label: "링크 주소", placeholder: "https://", defaultValue: editor!.getAttributes("link").href ?? "https://" },
    });
    if (url === null) return;
    if (!url.trim()) editor!.chain().focus().unsetLink().run();
    else editor!.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  async function addImageByUrl() {
    const src = await ask({
      title: "이미지 주소로 넣기",
      description: "이미 인터넷에 올라와 있는 이미지 주소를 붙여 넣습니다. 내 컴퓨터 파일은 사진 단추를 쓰세요.",
      confirmLabel: "넣기",
      field: { label: "이미지 주소", placeholder: "https://", defaultValue: "https://", required: true },
    });
    if (src?.trim()) editor!.chain().focus().setImage({ src: src.trim(), alt: "" }).run();
  }

  async function addImageFile(file: File) {
    setBusy(true);
    setMessage("");
    const result = await uploadImage(file, purpose);
    setBusy(false);
    if (!result.url) { setMessage(result.error ?? "이미지를 올리지 못했습니다."); return; }
    editor!.chain().focus().setImage({ src: result.url, alt: "" }).run();
  }

  async function addMath() {
    const latex = await ask({
      title: "수식 넣기",
      description: "LaTeX 로 씁니다. 예: x^2 + y^2 = r^2 · \\frac{1}{2}mv^2",
      confirmLabel: "넣기",
      field: { label: "수식", placeholder: "x^2 + y^2 = r^2", defaultValue: "", required: true },
    });
    if (latex?.trim()) editor!.chain().focus().insertMath(latex.trim()).run();
  }

  const inTable = editor.isActive("table");

  return <div className="rich-editor">
    <div className="editor-toolbar" role="toolbar" aria-label="글쓰기 도구">
      <span className="editor-tool-group">
        <select className="editor-select" aria-label="문단 모양" title="문단 모양" value={pickedBlock} onChange={(event) => applyBlock(event.target.value)}>
          {blocks.map((block) => <option key={block.value} value={block.value}>{block.label}</option>)}
        </select>
        <select
          className="editor-select"
          aria-label="글자 크기"
          title="글자 크기 — 고른 글자에 적용됩니다. 고른 글자가 없으면 커서가 있는 줄 전체에 적용됩니다."
          value={pickedSize}
          onChange={(event) => applySize(event.target.value)}
        >
          {sizes.map((size) => <option key={size.label} value={size.value}>{size.label}</option>)}
        </select>
        <select className="editor-select" aria-label="줄 간격" title="줄 간격" value={pickedHeight} onChange={(event) => applyLineHeight(event.target.value)}>
          {lineHeights.map((row) => <option key={row.label} value={row.value}>{row.label}</option>)}
        </select>
      </span>

      <span className="editor-tool-group">
        {tool(<Bold size={16} />, "굵게", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {tool(<Italic size={16} />, "기울임", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {tool(<UnderlineIcon size={16} />, "밑줄", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
        {tool(<Strikethrough size={16} />, "취소선", () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
        {tool(<Highlighter size={16} />, "형광펜", () => editor.chain().focus().toggleHighlight({ color: "#fff1a8" }).run(), editor.isActive("highlight"))}
      </span>

      <span className="editor-tool-group editor-color-group" aria-label="글자 색상">
        {colors.map((color) => (
          <button
            type="button"
            className="editor-color"
            title={`${color} 색상`}
            aria-label={`${color} 색상`}
            key={color}
            style={{ backgroundColor: color }}
            onClick={() => chainOnLine().setColor(color).run()}
          />
        ))}
      </span>

      <span className="editor-tool-group">
        {tool(<AlignLeft size={16} />, "왼쪽 정렬", () => editor.chain().focus().setTextAlign("left").run(), editor.isActive({ textAlign: "left" }))}
        {tool(<AlignCenter size={16} />, "가운데 정렬", () => editor.chain().focus().setTextAlign("center").run(), editor.isActive({ textAlign: "center" }))}
        {tool(<AlignRight size={16} />, "오른쪽 정렬", () => editor.chain().focus().setTextAlign("right").run(), editor.isActive({ textAlign: "right" }))}
        {tool(<AlignJustify size={16} />, "양쪽 맞춤", () => editor.chain().focus().setTextAlign("justify").run(), editor.isActive({ textAlign: "justify" }))}
      </span>

      <span className="editor-tool-group">
        {tool(<List size={16} />, "글머리 목록", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {tool(<ListOrdered size={16} />, "번호 목록", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {tool(<Quote size={16} />, "인용문", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {tool(<Code2 size={16} />, "코드 블록", () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
        {tool(<Minus size={16} />, "구분선", () => editor.chain().focus().setHorizontalRule().run())}
      </span>

      <span className="editor-tool-group">
        {tool(<Link2 size={16} />, "링크", setLink, editor.isActive("link"))}
        <label className={`editor-button${busy ? " active" : ""}`} title="사진 첨부">
          <ImageIcon size={16} />
          <span className="sr-only">사진 첨부</span>
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void addImageFile(file); event.target.value = ""; }}
          />
        </label>
        {tool(<Table2 size={16} />, "표 넣기 (3×3)", () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        {tool(<Sigma size={16} />, "수식 넣기", addMath)}
      </span>

      {/* 표 안에 커서가 있을 때만 나옵니다. 늘 띄워 두면 쓰지도 않는 단추가 자리를 먹습니다. */}
      {inTable && (
        <span className="editor-tool-group editor-table-tools">
          {tool(<Rows3 size={16} />, "행 추가", () => editor.chain().focus().addRowAfter().run())}
          {tool(<Columns3 size={16} />, "열 추가", () => editor.chain().focus().addColumnAfter().run())}
          {tool(<Trash2 size={16} />, "행 삭제", () => editor.chain().focus().deleteRow().run())}
          {tool(<Columns3 size={16} />, "열 삭제", () => editor.chain().focus().deleteColumn().run())}
          {tool(<Table2 size={16} />, "표 삭제", () => editor.chain().focus().deleteTable().run())}
        </span>
      )}

      <span className="editor-tool-group editor-tool-end">
        {tool(<Undo2 size={16} />, "실행 취소", () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {tool(<Redo2 size={16} />, "다시 실행", () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </span>
    </div>
    <EditorContent editor={editor} className="editor-content" />
    <div className="editor-status">
      <span>
        Enter 새 문단 · Shift+Enter 줄바꿈 · 글자를 선택한 뒤 도구를 누르면 적용됩니다
        <button type="button" className="text-button" onClick={addImageByUrl}>이미지 주소로 넣기</button>
      </span>
      <b>{editor.storage.characterCount.characters().toLocaleString()}자</b>
    </div>
    {message && <p className="editor-message" role="status">{message}</p>}
    {dialogNode}
  </div>;
}
