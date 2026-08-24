"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { API_URL } from "@/lib/api";
import { redirectUri, stateMatches } from "@/lib/google-login";
import { loadSession } from "@/lib/session";

/**
 * 구글에서 돌아오는 자리.
 *
 * **이 화면이 우리 주소에 있다는 것이 핵심입니다.** 홈 화면에 추가해 앱처럼 쓰는
 * 경우, 돌아오는 곳이 앱 영역 안이어야 앱이 그대로 유지됩니다. 백엔드 주소로
 * 돌아오면 브라우저 창이 열린 채 남습니다.
 */
function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const done = useRef(false);
  const [message, setMessage] = useState("로그인하고 있습니다…");

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const code = params.get("code");
    const failed = params.get("error");
    if (failed || !code) {
      // 구글이 이유를 알려 주면 그대로 넘겨, 로그인 화면에서 무엇이 문제인지 보이게 합니다.
      router.replace(`/login?error=${encodeURIComponent(failed || "oauth")}`);
      return;
    }
    if (!stateMatches(params.get("state"))) {
      router.replace("/login?error=state");
      return;
    }
    void (async () => {
      const response = await fetch(`${API_URL}/auth/google/exchange`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirectUri: redirectUri() }),
      }).catch(() => null);
      if (!response?.ok) {
        setMessage("로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        router.replace("/login?error=oauth");
        return;
      }
      // 세션을 다시 읽어 머리글과 마이페이지가 곧바로 로그인 상태로 보이게 합니다.
      await loadSession(true);
      router.replace("/mypage");
    })();
  }, [params, router]);

  return (
    <PageShell eyebrow="MEMBER ACCESS" title="SHAPE 로그인">
      <div className="empty-state"><h2>{message}</h2><p>잠시만 기다려 주세요.</p></div>
    </PageShell>
  );
}

export default function GoogleCallbackPage() {
  return <Suspense fallback={null}><CallbackInner /></Suspense>;
}
