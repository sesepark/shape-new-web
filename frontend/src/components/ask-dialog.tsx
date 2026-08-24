"use client";

import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AutoTextarea } from "@/components/auto-textarea";

type Field = {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
};

/**
 * 세 번째 단추를 눌렀을 때 `ask` 가 돌려주는 값.
 *
 * "저장하고 나가기 / 저장하지 않고 나가기 / 취소" 처럼 갈 곳이 셋인 물음이
 * 있습니다. 예/아니오 두 갈래만으로는 "저장하지 않고" 를 확인으로 둘지
 * 취소로 둘지 정할 수 없어서, 중간 답을 따로 만들었습니다. 사람이 입력창에
 * 칠 수 없는 글자로 두어 프롬프트의 답과 겹치지 않습니다.
 */
export const ASK_ALT = "\u0000alt";

export type AskOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 주면 취소와 확인 사이에 단추가 하나 더 생기고, 누르면 `ASK_ALT` 가 옵니다. */
  altLabel?: string;
  tone?: "default" | "danger";
  field?: Field;
};

type Pending = AskOptions & { resolve: (value: string | null) => void };

/**
 * Replaces `window.confirm` / `window.prompt`, which the browser renders in its
 * own chrome, ignores the site's typography and blocks the whole tab. Returns
 * the typed text (or an empty string for a plain confirm), or null on cancel.
 */
export function useAsk() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const ask = useCallback((options: AskOptions) => {
    setValue(options.field?.defaultValue ?? "");
    setTouched(false);
    return new Promise<string | null>((resolve) => setPending({ ...options, resolve }));
  }, []);

  useEffect(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [pending]);

  const settle = useCallback((answer: string | null) => {
    pending?.resolve(answer);
    dialog.current?.close();
    setPending(null);
  }, [pending]);

  const missing = Boolean(pending?.field?.required && !value.trim());

  const dialogNode = (
    <dialog
      ref={dialog}
      className={`ask-dialog${pending?.tone === "danger" ? " danger" : ""}`}
      onCancel={(event) => { event.preventDefault(); settle(null); }}
      onClick={(event) => { if (event.target === dialog.current) settle(null); }}
    >
      {pending && (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (missing) return;
            settle(value);
          }}
        >
          <button type="button" className="dialog-close" onClick={() => settle(null)} aria-label="닫기"><X /></button>
          <h3>
            {pending.tone === "danger" && <AlertTriangle size={19} aria-hidden="true" />}
            {pending.title}
          </h3>
          {pending.description && <p>{pending.description}</p>}
          {pending.field && (
            <label>
              {pending.field.label}
              {pending.field.multiline ? (
                <AutoTextarea
                  value={value}
                  onChange={setValue}
                  minRows={3}
                  maxLength={pending.field.maxLength ?? 1000}
                  placeholder={pending.field.placeholder}
                  autoFocus
                />
              ) : (
                <input
                  value={value}
                  maxLength={pending.field.maxLength ?? 1000}
                  placeholder={pending.field.placeholder}
                  onChange={(event) => setValue(event.target.value)}
                  autoFocus
                />
              )}
              {touched && missing && <small className="ask-error">내용을 입력해 주세요.</small>}
            </label>
          )}
          <div className="ask-actions">
            <button type="button" className="button secondary" onClick={() => settle(null)}>
              {pending.cancelLabel ?? "취소"}
            </button>
            {pending.altLabel && (
              <button type="button" className="button secondary ask-alt" onClick={() => settle(ASK_ALT)}>
                {pending.altLabel}
              </button>
            )}
            <button type="submit" className="button">{pending.confirmLabel ?? "확인"}</button>
          </div>
        </form>
      )}
    </dialog>
  );

  return { ask, dialogNode };
}
