"use client";

import { AlertTriangle, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * 한 줄이면 글자만 주면 되고, 목록이나 굵은 글씨가 필요하면 그대로 넘겨도
   * 됩니다. 글자일 때만 `<p>` 로 감쌉니다 — `<p>` 안에 `<ul>` 을 넣으면
   * 브라우저가 문단을 조용히 닫아 버려 뒤쪽이 밖으로 새어 나옵니다.
   */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 주면 취소와 확인 사이에 단추가 하나 더 생기고, 누르면 `ASK_ALT` 가 옵니다. */
  altLabel?: string;
  /**
   * 가운데 단추의 무게. 기본은 붉은 계열입니다 — "저장하지 않고 이동" 처럼
   * 되돌릴 수 없는 선택이 그 자리에 오는 경우가 많기 때문입니다. 그저 다른 곳으로
   * 가는 것뿐인 단추에는 `plain` 을 주어 경고처럼 보이지 않게 합니다.
   */
  altTone?: "warn" | "plain";
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
          {pending.description !== undefined && pending.description !== null && (
            typeof pending.description === "string"
              ? <p>{pending.description}</p>
              : <div className="ask-body">{pending.description}</div>
          )}
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
          {/*
            단추가 셋이면 가로로 늘어놓을 수 없습니다. 상자 안쪽 폭이 370px 인데
            "저장하고 이동 / 저장하지 않고 이동 / 여기 머무르기" 세 개를 나란히
            놓으면 460px 가 넘어, 맨 왼쪽 단추가 상자 밖으로 밀려 잘렸습니다.
            그래서 셋일 때는 세로로 쌓고 폭을 채웁니다.

            쌓을 때는 화면에 보이는 차례대로 씁니다(권하는 것부터 아래로).
            둘일 때 쓰는 가로 배치는 반대로 취소가 먼저 와야 해서, 두 경우의
            마크업을 나눴습니다. 이렇게 두면 눈에 보이는 차례와 탭 키로 옮겨
            가는 차례가 어긋나지 않습니다.
          */}
          {pending.altLabel ? (
            <div className="ask-actions stacked">
              <button type="submit" className="button">{pending.confirmLabel ?? "확인"}</button>
              <button
                type="button"
                className={`button secondary ask-alt${pending.altTone === "plain" ? " plain" : ""}`}
                onClick={() => settle(ASK_ALT)}
              >
                {pending.altLabel}
              </button>
              <button type="button" className="button secondary" onClick={() => settle(null)}>
                {pending.cancelLabel ?? "취소"}
              </button>
            </div>
          ) : (
            <div className="ask-actions">
              <button type="button" className="button secondary" onClick={() => settle(null)}>
                {pending.cancelLabel ?? "취소"}
              </button>
              <button type="submit" className="button">{pending.confirmLabel ?? "확인"}</button>
            </div>
          )}
        </form>
      )}
    </dialog>
  );

  return { ask, dialogNode };
}
