"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

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
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  maxRows?: number;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows">) {
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
      ref={ref}
      value={value}
      rows={minRows}
      onChange={(event) => onChange(event.target.value)}
      onInput={resize}
    />
  );
}
