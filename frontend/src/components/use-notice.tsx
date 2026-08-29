"use client";

import { useCallback, useState } from "react";

/**
 * 관리자 화면의 한 줄 알림. 저장·삭제 결과를 그 자리에 남깁니다.
 *
 * `admin-console.tsx` 에 있던 것을 옮겼습니다. 탭을 따로 떼어낸 파일들이 같은
 * 것을 써야 하는데, 거기서 `admin-console` 을 부르면 import 가 둥글게 돕니다.
 */
export function useNotice() {
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const say = useCallback((text: string, ok = true) => setNotice(text ? { text, ok } : null), []);
  const node = notice
    ? <p className={`save-notice${notice.ok ? "" : " danger"}`} role="status">{notice.text}</p>
    : null;
  return { say, node };
}
