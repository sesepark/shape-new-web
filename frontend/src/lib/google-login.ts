"use client";

/**
 * 구글 로그인을 **우리 주소 안에서** 시작하고 끝냅니다.
 *
 * 예전에는 구글이 백엔드 주소(api.snu-shape.com)로 돌아왔습니다. 그런데 홈 화면에
 * 추가해서 앱처럼 쓰는 경우, 앱의 영역(www.snu-shape.com) 밖으로 나가는 순간
 * 브라우저 창이 열리고 **위에 주소 막대가 남습니다.** 로그인해도 앱으로 돌아오지
 * 못합니다.
 *
 * 그래서 구글이 우리 화면(`/login/google/callback`)으로 돌아오게 합니다. 그 화면은
 * 앱 영역 안이므로 앱이 그대로 유지됩니다. 받은 코드는 서버로 넘겨 세션으로
 * 바꿉니다 — 비밀 열쇠는 브라우저에 내려오지 않습니다.
 *
 * 구글 클라이언트 ID 가 화면 쪽에 설정되어 있지 않으면 예전 방식(서버가 시작하는
 * 흐름)으로 갑니다. 설정을 옮기는 동안에도 로그인이 끊기지 않게 하기 위한 것입니다.
 */

const CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
const STATE_KEY = "shape-oauth-state";
/**
 * 구글에 알려 줄 '돌아올 주소' 의 기준.
 *
 * 지금 열려 있는 주소(`window.location.origin`)를 그대로 쓰면 안 됩니다. 같은
 * 사이트라도 `snu-shape.com`(www 없이)이나 Vercel 미리보기 주소로 들어와 있으면
 * 구글 콘솔에 등록해 둔 주소와 글자가 달라지고, 구글은 그 요청을 **잘못된 요청
 * (400)** 으로 거절합니다. 실제로 휴대폰에서 그 오류가 났습니다.
 *
 * 그래서 사이트 기준 주소 하나만 씁니다. 로컬 개발처럼 기준 주소가 지금 열린 곳과
 * 다를 때만 지금 주소를 씁니다.
 */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.snu-shape.com").replace(/\/+$/, "");

export function sameOriginLoginReady() {
  return Boolean(CLIENT_ID);
}

export function redirectUri() {
  const here = window.location.origin;
  // 로컬 개발(localhost)에서는 지금 주소를 씁니다. 그 밖에는 늘 사이트 기준 주소로
  // 보내야 구글 콘솔에 등록한 주소와 정확히 같습니다.
  const base = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(here) ? here : SITE;
  return `${base}/login/google/callback`;
}

/** 되돌아왔을 때 견줄 임의의 값. 남이 만든 로그인 요청을 가려냅니다. */
function makeState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startGoogleLogin() {
  const state = makeState();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 확인을 건너뜁니다.
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** 돌아온 state 가 내가 보낸 것인지. 저장이 막혀 있었다면 통과시킵니다. */
export function stateMatches(returned: string | null) {
  try {
    const saved = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    if (!saved) return true;
    return saved === returned;
  } catch {
    return true;
  }
}
