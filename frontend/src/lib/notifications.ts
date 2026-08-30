"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

/**
 * 안 읽은 알림 수.
 *
 * 예약이 확정되고, 반려되고, 사용 후 사진을 올려 달라는 말이 전부 알림으로
 * 갑니다. 그런데 그 수가 보이는 곳이 **마이페이지 안쪽 한 곳뿐**이었습니다.
 * 브라우저 알림을 켠 사람만 제때 알았고, 아이폰은 홈 화면에 추가까지 해야
 * 하므로 실제 구독률이 낮습니다. 머리글에 점 하나를 띄웁니다.
 *
 * 목록을 받아 세지 않고 전용 창구를 쓰는 이유는 두 가지입니다. 배지 하나
 * 때문에 알림 오십 건을 실어 보낼 이유가 없고, 목록은 한 쪽씩 끊어 주므로
 * 거기서 세면 51건째부터 영영 50이라고 말하게 됩니다.
 */
const CACHE_KEY = "shape:unread";
/**
 * 얼마나 자주 다시 물을지.
 *
 * 이 값이 곧 무료 티어의 요청 수입니다. 쪽을 옮길 때마다 물으면 회원 한 명이
 * 한 번 둘러보는 동안 열 번 넘게 나갑니다. 알림은 급히 바뀌는 값이 아니고
 * 배지가 몇 분 늦어도 아무 일도 일어나지 않으므로, 탭이 살아 있는 동안
 * 잠시 재사용합니다. 마이페이지에서 '모두 읽음' 을 누르면 그 자리에서
 * `clearUnread()` 로 지우므로 배지가 남아 있지 않습니다.
 */
const CACHE_MS = 3 * 60_000;

function cached(): number | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: number; unread: number };
    return Date.now() - saved.at < CACHE_MS ? saved.unread : null;
  } catch {
    return null;
  }
}

function remember(unread: number) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), unread }));
  } catch {
    // 시크릿 창처럼 저장이 막힌 곳에서는 그냥 매번 물어봅니다.
  }
}

/** 읽음 처리를 한 직후에 부릅니다. 배지가 다음 창까지 남아 있지 않게 합니다. */
export function clearUnread() {
  remember(0);
  window.dispatchEvent(new CustomEvent("shape:unread", { detail: 0 }));
}

export function useUnreadCount(session: SessionUser | null | undefined) {
  const [unread, setUnread] = useState(0);
  // 보기 전용 회원에게는 공지 알림이 가지 않지만 예약 알림은 갑니다.
  // 로그인하지 않은 방문자에게는 요청조차 보내지 않습니다.
  const signedIn = Boolean(session);

  /**
   * 값을 **돌려주기만** 합니다. 여기서 곧바로 setState 를 하면 캐시가 맞았을 때
   * 효과 안에서 동기적으로 상태가 바뀌어(그리기를 한 번 더 합니다) 린트가
   * 막습니다. 저장된 값을 첫 상태로 삼는 길도 안 됩니다 — 서버는 0 으로
   * 그리는데 브라우저가 3 으로 그리면 하이드레이션이 어긋납니다.
   */
  const read = useCallback(async (signal?: AbortSignal): Promise<number | null> => {
    const saved = cached();
    if (saved !== null) return saved;
    const response = await fetch(`${API_URL}/notifications/unread`, {
      credentials: "include", cache: "no-store", signal,
    }).catch(() => null);
    if (!response?.ok) return null;
    const { unread: count } = (await response.json()) as { unread: number };
    remember(count);
    return count;
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    let alive = true;
    void read(controller.signal).then((count) => {
      if (alive && count !== null) setUnread(count);
    });
    const listen = (event: Event) => setUnread((event as CustomEvent<number>).detail);
    window.addEventListener("shape:unread", listen);
    return () => {
      alive = false;
      controller.abort();
      window.removeEventListener("shape:unread", listen);
    };
  }, [signedIn, read]);

  // 로그아웃한 순간은 상태를 되돌리지 않고 여기서 걸러 냅니다. 효과 안에서
  // setState 를 부르면 그리기를 한 번 더 하게 되고, 그 사이 한 프레임 동안
  // 남의 알림 수가 그대로 떠 있습니다.
  return signedIn ? unread : 0;
}
