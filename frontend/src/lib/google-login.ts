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
/** 로그인 한 번에 넉넉한 시간. 이보다 오래 남아 있을 이유가 없습니다. */
const STATE_TTL_SECONDS = 600;
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

/**
 * 되돌아왔을 때 견줄 임의의 값. **남이 만든 로그인 요청을 가려냅니다.**
 *
 * 이것이 없으면, 공격자가 자기 구글 계정의 인가 코드를 담은 주소를 부원에게 열게
 * 하는 것만으로 그 부원의 브라우저가 **공격자의 계정으로** 로그인됩니다. 그다음
 * 부원이 올리는 사진과 글이 남의 계정에 들어갑니다.
 *
 * 세 곳에 적어 둡니다. 한 곳만 쓰면 "저장된 값이 없다" 가 흔해지고, 흔해지면
 * 결국 없을 때도 통과시키게 되어 검사 자체가 없는 것과 같아집니다.
 *
 *   sessionStorage  같은 탭 안에서 가장 정확합니다. 기본입니다.
 *   localStorage    돌아오는 곳이 다른 탭이어도 남아 있습니다.
 *   쿠키            홈 화면에 추가한 앱처럼 **저장 공간이 갈리는** 경우까지 덮습니다.
 *                   앱 안 브라우저는 저장 공간을 따로 쓰더라도 쿠키는 나눠 씁니다.
 */
function remember(state: string) {
  try { sessionStorage.setItem(STATE_KEY, state); } catch { /* 저장이 막힌 브라우저 */ }
  try { localStorage.setItem(STATE_KEY, state); } catch { /* 위와 같음 */ }
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${STATE_KEY}=${state}; Max-Age=${STATE_TTL_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch { /* 위와 같음 */ }
}

/**
 * 세 곳에서 값을 거두고 지웁니다.
 *
 * **"못 읽었다" 와 "읽었더니 비어 있다" 를 반드시 구별합니다.** 둘을 뭉뚱그리면
 * 저장소가 멀쩡한데 값만 없는 경우 — 곧 여기서 시작하지 않은 로그인 — 까지
 * 통과하게 되어, 검사를 넣은 이유가 사라집니다.
 */
function collect(): { read: boolean; value: string | null }[] {
  const found: { read: boolean; value: string | null }[] = [];
  const fromStore = (store: Storage) => {
    try {
      const value = store.getItem(STATE_KEY);
      store.removeItem(STATE_KEY);
      found.push({ read: true, value });
    } catch {
      found.push({ read: false, value: null });
    }
  };
  fromStore(sessionStorage);
  fromStore(localStorage);
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${STATE_KEY}=([^;]*)`));
    found.push({ read: true, value: match ? decodeURIComponent(match[1]) : null });
    document.cookie = `${STATE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {
    found.push({ read: false, value: null });
  }
  return found;
}

function makeState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startGoogleLogin() {
  const state = makeState();
  remember(state);
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

/**
 * 돌아온 state 가 내가 보낸 것인지.
 *
 * 적어 둔 값이 **한 곳이라도** 있으면 반드시 일치해야 합니다. 하나도 없다는 것은
 * 이 브라우저에서 로그인을 시작한 적이 없다는 뜻이고, 그것이 바로 막으려는
 * 상황입니다.
 *
 * 예외는 하나입니다. 세 곳 **모두 읽지 못한** 경우에는 통과시킵니다. 저장이 통째로
 * 막힌 브라우저에서 로그인이 영영 안 되는 쪽이 더 나쁩니다.
 */
export function stateMatches(returned: string | null) {
  const found = collect();
  if (!found.some((slot) => slot.read)) return true;
  return Boolean(returned) && found.some((slot) => slot.value === returned);
}
