"use client";

import { LogIn } from "lucide-react";
import { sameOriginLoginReady, startGoogleLogin } from "@/lib/google-login";

/**
 * 구글 로그인 단추.
 *
 * 화면 쪽에 구글 클라이언트 ID 가 설정되어 있으면 **우리 주소로 돌아오는 흐름**으로
 * 갑니다(홈 화면에 추가한 앱이 그대로 유지됩니다). 설정 전에는 예전처럼 서버가
 * 시작하는 흐름으로 갑니다 — 설정을 옮기는 동안에도 로그인이 끊기지 않게 합니다.
 */
export function GoogleLoginButton() {
  if (!sameOriginLoginReady()) {
    return <a className="button google-login" href="/login/google"><LogIn size={16} />Google 로그인</a>;
  }
  return (
    <button className="button google-login" type="button" onClick={startGoogleLogin}>
      <LogIn size={16} />Google 로그인
    </button>
  );
}
