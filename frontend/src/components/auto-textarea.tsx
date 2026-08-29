"use client";

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows with its content instead of scrolling inside a fixed
 * box. Comments and replies are often a single line but sometimes a long one,
 * and a three-row box hides the rest of what someone just typed.
 */
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
