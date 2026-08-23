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

export type AskOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
            <button type="submit" className="button">{pending.confirmLabel ?? "확인"}</button>
          </div>
        </form>
      )}
    </dialog>
  );

  return { ask, dialogNode };
}
