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
  ChevronDown, Sigma, Strikethrough, Table2, Trash2, Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAsk } from "@/components/ask-dialog";
import { LineHeight, MathBlock } from "@/components/editor-extensions";
import { uploadImage, type UploadPurpose } from "@/lib/upload";

/** 글자 색. 마지막 흰색은 어두운 바탕 위에 쓰라고 둡니다. */
const colors = ["#111827", "#2855f3", "#e24b72", "#11a884", "#d97706", "#ffffff"];
/**
 * 글자 크기. **본문 크기에 견준 배율(em)로 둡니다.**
 *
 * 예전에는 14px·18px·24px 라는 고정 크기였는데, 본문이 19px 이라 '크게'(18px)
 * 가 기본보다 오히려 작았습니다. 좁은 화면에서는 본문이 17px 로 줄어 '작게'
 * (14px)와의 차이도 사라집니다. 두 곳의 값이 서로를 모르는 채 따로 정해져
 * 있었던 것이 원인입니다.
 *
 * em 은 본문 크기를 따라가므로 어느 화면에서도 작게<기본<크게<제목 차례가
 * 지켜집니다(19px 기준 16/19/23/29px, 17px 기준 14/17/20/26px). 저장되는 값도
 * 공개 화면의 `.rich-content` 안에서 같은 기준으로 풀립니다.
 */
const sizes = [
  { label: "기본", value: "" },
  { label: "작게", value: "0.85em" },
  { label: "크게", value: "1.2em" },
  { label: "제목", value: "1.5em" },
];
/**
 * 예전에 저장된 고정 크기. 상자에 이름이 뜨도록 짝만 지어 둡니다.
 *
 * 이미 올라간 글의 크기를 바꾸지는 않습니다. 글쓴이가 그때 고른 크기가 맞고,
 * 지난 글을 건드리는 것이 더 놀라운 일입니다.
 */
const legacySizes: Record<string, string> = { "14px": "0.85em", "18px": "1.2em", "24px": "1.5em" };
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

/**
 * 도구 막대의 고르기 단추.
 *
 * 처음에는 평범한 `<select>` 를 썼는데, **글상자를 누르는 순간 초점이 이 상자로
 * 끌려갔습니다.** 글을 쓰려고 눌렀는데 '문단 모양' 이 잡히는 치명적인 문제였습니다.
 * 도구 막대를 통째로 빼면 멀쩡했고, 단추 하나만 두면 역시 멀쩡했고, `<select>`
 * 하나만 두면 다시 문제가 났습니다. 값을 React 가 쥐든(controlled) 우리가 직접
 * 넣든(ref) 마찬가지였습니다. 브라우저가 그리는 native select 자체가 편집기의
 * 초점과 부딪힙니다.
 *
 * 그래서 단추와 작은 목록으로 직접 만듭니다. 고른 뒤에는 편집기로 초점을
 * 돌려주므로 이어서 바로 쓸 수 있습니다.
 *
 * ## 목록은 `<body>` 에 붙여 띄웁니다
 *
 * 펼친 목록이 아래 본문에 가려 보이지 않는 일이 있었습니다. z-index 를 올려도
 * 소용이 없었는데, 가려진 것이 아니라 **잘려 나가고** 있었기 때문입니다. 목록을
 * 감싼 상자 둘이 각각 목록을 자릅니다.
 *
 * - `.editor-toolbar` 는 좁은 화면에서 도구를 좌우로 밀어 쓰려고
 *   `overflow-x:auto; overflow-y:hidden` 입니다. 스크롤 상자가 된 이상 그 안의
 *   `position:absolute` 는 상자 밖으로 나가지 못합니다.
 * - `.rich-editor` 는 둥근 모서리를 살리려고 `overflow:clip` 입니다.
 *
 * 둘 다 그 자리에 있어야 하는 규칙이라, 목록만 부모 밖으로 꺼냅니다. 포털로
 * `<body>` 에 붙이고 단추의 화면 좌표에 `position:fixed` 로 띄우면 어떤
 * `overflow` 도 어떤 쌓임 맥락(stacking context)도 지나갈 일이 없습니다.
 */
type MenuSpot = { top: number; left: number; width: number; drop: "down" | "up" };
/** 목록과 화면 가장자리 사이에 남겨 두는 여백. */
const MENU_EDGE = 8;

function ToolMenu({ label, value, options, onPick, title }: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onPick: (value: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<MenuSpot | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  /** 단추가 지금 화면 어디에 있는지 재어 목록을 그 아래(또는 위)에 놓습니다. */
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    if (!anchor) return;
    // 목록 높이는 한 줄 높이 + 위아래 여백으로 어림잡습니다. 실제 높이를 재려면
    // 먼저 그려야 하고, 그러면 한 프레임 동안 엉뚱한 자리에 보입니다. 좁은
    // 화면에서는 한 줄을 손가락 크기로 키우므로(site-polish.css) 함께 맞춥니다.
    const row = window.innerWidth <= 620 ? 44 : 34;
    const cap = window.innerWidth <= 620 ? Math.min(320, window.innerHeight * 0.5) : Math.min(320, window.innerHeight * 0.6);
    const height = Math.min(options.length * row + 10, cap);
    const below = window.innerHeight - anchor.bottom - MENU_EDGE;
    const drop: "down" | "up" = below < height && anchor.top > below ? "up" : "down";
    setSpot({
      top: drop === "down" ? anchor.bottom + 4 : anchor.top - 4 - height,
      // 좁은 화면에서 오른쪽 끝 도구를 누르면 목록이 화면 밖으로 나갑니다.
      left: Math.max(MENU_EDGE, Math.min(anchor.left, window.innerWidth - anchor.width - MENU_EDGE)),
      width: anchor.width,
      drop,
    });
  }, [options.length]);

  // 열자마자, 그리고 그리기 전에 자리를 잡습니다. `useEffect` 로 두면 목록이
  // 좌표 없이 한 번 그려졌다가 옮겨 가서 깜빡입니다.
  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      // 목록은 이제 `<body>` 밑에 있으므로 감싼 상자만 보면 안 됩니다. 목록을
      // 빼먹으면 항목을 누르는 순간 목록이 사라져 click 이 오지 않습니다.
      if (trigger.current?.contains(target) || list.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    // 화면에 고정해 띄웠으므로 무엇이든 굴러가면 따라가야 합니다. capture 로
    // 들어야 도구줄 자신의 가로 스크롤까지 잡힙니다.
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <div className="editor-menu">
      <button
        type="button"
        ref={trigger}
        className={`editor-select${open ? " open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title ?? label}
        onClick={() => setOpen((was) => !was)}
      >
        {current.label}
        <ChevronDown size={14} />
      </button>
      {open && spot && createPortal(
        <ul
          ref={list}
          className={`editor-menu-list ${spot.drop}`}
          role="listbox"
          aria-label={label}
          style={{ top: spot.top, left: spot.left, minWidth: spot.width }}
        >
          {options.map((option) => (
            <li key={option.label}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? "picked" : ""}
                onClick={() => { setOpen(false); onPick(option.value); }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

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
  /**
   * 바깥에서 온 글을 편집기에 실어 줍니다(글 수정 화면이 저장된 글을 열 때).
   *
   * **빈 글을 조심해야 합니다.** 새 글을 쓸 때 바깥이 들고 있는 값은 빈 문자열인데
   * 편집기가 돌려주는 값은 `<p></p>` 입니다. 둘을 그냥 견주면 늘 다르므로, 화면이
   * 다시 그려질 때마다 `setContent` 가 돌면서 문서를 통째로 갈아 끼웁니다. 그러면
   * 글상자를 누른 순간 커서가 있던 자리가 사라지고 **초점이 도구 막대의 첫 상자로
   * 옮겨 갑니다.** 실제로 글을 쓰려고 누르면 '문단 모양' 상자가 잡히는 문제가
   * 여기서 나왔습니다.
   *
   * 그래서 양쪽이 모두 비어 있으면 같은 것으로 봅니다.
   */
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    if (!value.trim() && editor.isEmpty) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return <div className="editor-loading">편집기를 준비하고 있습니다.</div>;

  /**
   * 지금 커서가 놓인 글자의 크기. 고른 글자가 있으면 그 크기입니다.
   *
   * 예전에는 이 상자가 고른 곳과 아무 상관 없이 마지막으로 누른 값을 계속
   * 보여 줬습니다. 그래서 다른 줄을 골라도 상자에는 '크게' 가 떠 있어, 지금 이
   * 줄이 이미 큰 것인지 아닌지 알 수 없었습니다.
   */
  const rawSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  // 예전 글의 고정 크기(14px 등)도 이름이 뜨도록 지금 값으로 옮겨 봅니다.
  const activeSize = legacySizes[rawSize] ?? rawSize;
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

  /**
   * 문단 모양을 바꾸기 전에, **고른 줄만 따로 떼어 냅니다.**
   *
   * Shift+Enter 로 줄을 내리면 한 문단 안에 줄바꿈(`<br>`)이 들어갈 뿐 문단은
   * 하나 그대로입니다. 편집기 안내문이 그 방법을 알려 주기까지 하므로, 글
   * 전체가 문단 하나인 경우가 흔합니다. 그 상태에서 가운데 몇 글자를 골라
   * '제목 1' 을 누르면 **고르지도 않은 글 전체가 제목이 됩니다.** 문단 모양은
   * 원래 문단 단위로 걸리는 것이라 ProseMirror 로서는 정직한 동작이지만,
   * 사용하는 쪽에서는 그냥 고장입니다.
   *
   * 그래서 고른 곳을 감싸는 줄바꿈 두 개를 찾아 그 자리에서 문단을 끊습니다.
   * 앞뒤 줄은 원래 문단에 그대로 남고(줄 간격도 그대로), 고른 줄만 새 문단이
   * 되어 거기에만 모양이 걸립니다. 고를 때 줄바꿈을 걸치지 않았거나 문단
   * 전체를 골랐으면 끊을 것이 없으므로 아무 일도 하지 않습니다.
   */
  function isolateSoftLines() {
    const { state } = editor!;
    const { $from, $to } = state.selection;
    // 여러 문단에 걸쳐 골랐으면 그 문단들이 곧 대상입니다. 손대지 않습니다.
    if ($from.parent !== $to.parent || $from.parent.type.name !== "paragraph") return;
    const start = $from.start();
    const breaks: number[] = [];
    $from.parent.forEach((child, offset) => {
      if (child.type.name === "hardBreak") breaks.push(start + offset);
    });
    if (!breaks.length) return;
    const before = breaks.filter((pos) => pos <= $from.pos).pop();
    const after = breaks.find((pos) => pos >= $to.pos);
    if (before === undefined && after === undefined) return;
    const tr = state.tr;
    // 뒤쪽부터 손대야 앞쪽 자리가 밀리지 않습니다. 줄바꿈을 지운 자리에서
    // 문단을 끊으므로 글자는 하나도 늘거나 줄지 않습니다.
    if (after !== undefined) { tr.delete(after, after + 1); tr.split(after); }
    if (before !== undefined) { tr.delete(before, before + 1); tr.split(before); }
    editor!.view.dispatch(tr);
  }

  function applyBlock(kind: string) {
    isolateSoftLines();
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
        <ToolMenu label="문단 모양" value={pickedBlock} options={blocks} onPick={applyBlock} />
        <ToolMenu
          label="글자 크기"
          title="글자 크기 — 고른 글자에 적용됩니다. 고른 글자가 없으면 커서가 있는 줄 전체에 적용됩니다."
          value={pickedSize}
          options={sizes}
          onPick={applySize}
        />
        <ToolMenu label="줄 간격" value={pickedHeight} options={lineHeights} onPick={applyLineHeight} />
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
      </span>
      <b>{editor.storage.characterCount.characters().toLocaleString()}자</b>
    </div>
    {message && <p className="editor-message" role="status">{message}</p>}
    {dialogNode}
  </div>;
}
