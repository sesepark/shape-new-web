"use client";

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

/**
 * 내용만큼 자라는 글 상자.
 *
 * 댓글은 대개 한 줄이지만 가끔 길어집니다. 세 줄짜리 고정 상자는 방금 친 글의
 * 나머지를 가립니다.
 *
 * ## 상한(`maxRows`)을 언제 풀어야 하는가
 *
 * 기본 16줄은 **댓글과 한두 문단짜리 칸**에 맞춘 값입니다. 거기서 멈추면 안쪽
 * 스크롤로 바뀌는데, 짧은 글에서는 화면이 끝없이 길어지지 않아 오히려 낫습니다.
 *
 * 하지만 **장문이 들어오는 칸**은 다릅니다. SHAPE-UP 결과물의 초록·문제 설정·
 * 한계에 마흔 줄을 적어 보니 내용은 1,946px 인데 보이는 높이가 412px 에서
 * 멈춰, 적은 글의 5분의 1만 보이는 창에 대고 쓰게 됩니다. 같은 사이트의 게시판
 * 본문(TipTap)은 1,728px 까지 그대로 자라므로 기준이 둘로 갈리기도 합니다.
 *
 * 그런 칸에는 `maxRows={LONG_FORM_ROWS}` 를 주세요. 아주 큰 값이라 사실상
 * 상한이 없지만, 붙여넣기 사고로 화면이 수만 픽셀이 되는 것은 막아 줍니다.
 */
export const LONG_FORM_ROWS = 200;

export function AutoTextarea({
  value,
  onChange,
  minRows = 3,
  maxRows = 16,
  textareaRef,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  maxRows?: number;
  /**
   * 밖에서 이 칸으로 화면을 옮기거나 커서를 두어야 할 때 씁니다. 예약 화면에서
   * "왜 이 시간이어야 하는지 적기" 를 누르면 이 칸으로 내려갑니다. 안쪽 ref 는
   * 높이를 재는 데 이미 쓰고 있으므로 하나 더 받아 같이 채웁니다.
   */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows" | "ref">) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const style = window.getComputedStyle(node);
    const line = parseFloat(style.lineHeight) || 22;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    node.style.height = "auto";
    const wanted = node.scrollHeight + border;
    const min = line * minRows + padding + border;
    const max = line * maxRows + padding + border;
    node.style.height = `${Math.min(Math.max(wanted, min), max)}px`;
    node.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [minRows, maxRows]);

  useLayoutEffect(resize, [resize, value]);

  return (
    <textarea
      {...rest}
      ref={(node) => {
        ref.current = node;
        if (textareaRef) textareaRef.current = node;
      }}
      value={value}
      rows={minRows}
      onChange={(event) => onChange(event.target.value)}
      onInput={resize}
    />
  );
}
