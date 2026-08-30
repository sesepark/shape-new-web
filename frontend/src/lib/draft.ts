"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 쓰다 만 글을 브라우저에 임시로 담아 둡니다.
 *
 * ## 왜 필요한가
 *
 * SHAPE-UP 결과물은 한 학기를 정리한 글이라 한 시간 넘게 걸립니다. 게시판 글도
 * 짧지 않습니다. 그런데 사이트 어디에도 임시 저장이 없었고, **나가기 전 경고는
 * 관리자 화면에만** 있었습니다. 뒤로 가기를 잘못 누르거나 탭이 닫히면 적은 것이
 * 통째로 사라졌고, 사라진다는 사실조차 알려 주지 않았습니다.
 *
 * ## 서버가 아니라 브라우저에 담는 이유
 *
 * 서버에 임시 저장하면 글자를 칠 때마다 요청이 나가고, 그것이 무료 티어에서
 * 가장 자주 불리는 쓰기가 됩니다. 아직 남에게 보일 것도 아닌 글에 그 값을 치를
 * 이유가 없습니다. `localStorage` 는 새로 고침·탭 닫기·브라우저 종료를 모두
 * 견디고, 값이 들지 않습니다.
 *
 * 대가는 **기기를 옮기면 따라오지 않는다**는 것입니다. 집 컴퓨터에서 쓰다 만
 * 글이 휴대폰에 나타나지는 않습니다. 임시 저장의 목적은 '잃지 않는 것' 이지
 * '옮겨 다니는 것' 이 아니므로 이 대가를 받아들입니다.
 *
 * ## 언제 지우는가
 *
 * 저장에 성공하면 곧바로 지웁니다(`clear`). 남겨 두면 다음에 글을 새로 쓸 때
 * 이미 올린 글이 되살아나 두 번 올리게 됩니다. 그리고 오래된 것은 열 때
 * 스스로 버립니다 — 한 달 전에 쓰다 만 글을 복구하겠냐고 묻는 것은 도움이
 * 되기보다 방해가 됩니다.
 */
const PREFIX = "shape:draft:";
/** 이보다 오래된 임시 저장은 없는 셈 칩니다. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 글자를 칠 때마다 저장하지 않고 잠시 기다립니다.
 *
 * `localStorage` 쓰기는 동기라 큰 글에서 매 글자마다 하면 입력이 끊깁니다.
 */
const SAVE_AFTER = 800;

type Saved<T> = { at: number; value: T };

function read<T>(key: string): Saved<T> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved<T>;
    if (!saved || typeof saved.at !== "number") return null;
    if (Date.now() - saved.at > KEEP_MS) {
      window.localStorage.removeItem(PREFIX + key);
      return null;
    }
    return saved;
  } catch {
    // 시크릿 창처럼 저장이 막힌 곳, 또는 모양이 바뀐 옛 값.
    return null;
  }
}

/** 언제 저장했는지 사람이 읽는 말로. "방금", "3분 전", "어제 14:20". */
export function draftAge(at: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (sameDay) return `${clock.format(at)}`;
  const day = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
  return `${day.format(at)} ${clock.format(at)}`;
}

export interface DraftBox<T> {
  /** 열었을 때 남아 있던 임시 저장. 없으면 `null`. */
  found: { value: T; at: number } | null;
  /** 되살렸거나 버려서 더는 물어보지 않아도 되는 상태. */
  dismiss: () => void;
  /** 저장에 성공했을 때 부릅니다. 담아 둔 것을 지웁니다. */
  clear: () => void;
  /** 마지막으로 담아 둔 시각. 화면에 "방금 임시 저장됨" 을 적는 데 씁니다. */
  savedAt: number | null;
}

/**
 * 값이 바뀌면 잠시 뒤 담아 두고, 처음 열 때 남아 있던 것을 알려 줍니다.
 *
 * `dirty` 가 참인 동안에는 새로 고침·탭 닫기에 브라우저 확인창을 띄웁니다.
 * 임시 저장이 있어도 확인창은 답니다 — 되살릴 수 있다는 것을 모르는 사람에게는
 * 사라지는 것과 같기 때문입니다.
 */
export function useDraft<T>(key: string, value: T, dirty: boolean): DraftBox<T> {
  const [found, setFound] = useState<{ value: T; at: number } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * 남아 있던 임시 저장을 찾습니다.
   *
   * **첫 그림을 그린 뒤에 읽습니다.** 효과 안에서 곧바로 상태를 바꾸면 그리기를
   * 한 번 더 하게 되고, 무엇보다 서버는 "없음" 으로 그리는데 브라우저가 "있음"
   * 으로 그려 하이드레이션이 어긋납니다. 첫 상태로 삼는 길(`useState` 의 게으른
   * 초기값)도 같은 이유로 안 됩니다 — `localStorage` 는 서버에 없습니다.
   *
   * 되살리거나 버린 뒤에 다시 묻지 않는 것은 `found` 를 비우는 것으로 충분합니다.
   * `key` 가 그대로면 이 효과가 다시 돌지 않기 때문입니다.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = read<T>(key);
      if (saved) setFound({ value: saved.value, at: saved.at });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      try {
        const at = Date.now();
        window.localStorage.setItem(PREFIX + key, JSON.stringify({ at, value }));
        setSavedAt(at);
      } catch {
        // 저장 공간이 꽉 찼거나 막힌 곳. 글쓰기를 막을 이유는 없습니다.
      }
    }, SAVE_AFTER);
    return () => window.clearTimeout(timer);
  }, [key, value, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 최신 브라우저는 문구를 무시하고 자기 문장을 씁니다. 값을 넣는 것 자체가
      // "물어봐 달라" 는 뜻입니다.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const forget = useCallback(() => {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // 지우지 못해도 이레 뒤에는 스스로 사라집니다.
    }
  }, [key]);

  return {
    found,
    dismiss: useCallback(() => setFound(null), []),
    clear: useCallback(() => { setFound(null); setSavedAt(null); forget(); }, [forget]),
    savedAt,
  };
}
