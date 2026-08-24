import { Extension, Node } from "@tiptap/core";

/**
 * 글쓰기 도구에 더 붙이는 것들.
 *
 * TipTap 이 기본으로 주지 않는 두 가지입니다. 줄 간격은 문단에 style 로 붙이고,
 * 수식은 LaTeX 원문만 담아 두고 화면에서 KaTeX 로 그립니다. 둘 다 저장되는 값이
 * 단순한 HTML 이라, 공개 화면에서 다시 읽어 그릴 수 있습니다.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
    mathBlock: {
      insertMath: (latex: string) => ReturnType;
    };
  }
}

/** 줄 간격을 조절할 수 있는 블록. 문단과 제목에만 답니다. */
const LINE_HEIGHT_TARGETS = ["paragraph", "heading"];

export const LineHeight = Extension.create({
  name: "lineHeight",

  addGlobalAttributes() {
    return [
      {
        types: LINE_HEIGHT_TARGETS,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value: string) =>
        ({ commands }) =>
          LINE_HEIGHT_TARGETS.every((type) => commands.updateAttributes(type, { lineHeight: value })),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          LINE_HEIGHT_TARGETS.every((type) => commands.resetAttributes(type, "lineHeight")),
    };
  },
});

/**
 * 수식 한 덩이.
 *
 * 저장되는 것은 `<div data-math="x^2">x^2</div>` 뿐입니다. 화면에 그리는 일은
 * KaTeX 가 맡습니다. 그린 결과(span 수십 개)를 그대로 저장하면 본문이 몇 배로
 * 불어나고, 지우개(sanitizer)에 허용할 태그도 한없이 늘어납니다. 원문만 남겨
 * 두면 나중에 그리는 방법을 바꿔도 글은 그대로입니다.
 */
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-math") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-math": attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-math]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // 수식을 못 그리는 곳(메일, 검색 로봇)에서도 원문은 읽히도록 안에 그대로 둡니다.
    return ["div", { ...HTMLAttributes, class: "math-block" }, node.attrs.latex as string];
  },

  addCommands() {
    return {
      insertMath:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});
