/**
 * 안전 머리말(CSP)이 화면을 깨뜨리지 않는지 브라우저로 확인한다.
 *
 *   npm run build && npx next start -p 3100 &
 *   node scripts/csp-check.mjs http://localhost:3100
 *
 * 왜 있는가: `next.config.ts` 의 Content-Security-Policy 는 잘못 좁히면 **조용히**
 * 무언가를 지운다. 페이지는 열리는데 지도만 안 나오거나, 3D 로봇만 안 도는 식이다.
 * 배포한 뒤 사람이 눈으로 찾기에는 늦다. 실제로 처음 넣은 정책이 오시는 길의
 * 구글 지도 iframe 을 막았고, 이 스크립트가 그것을 잡았다.
 *
 * 브라우저는 정책을 어긴 요청을 콘솔에 "Refused to …" 로 남긴다. 여기서는 모든
 * 공개 화면을 한 번씩 열어 그 줄을 모은다. 백엔드를 띄우지 않았다면 API 호출이
 * ERR_CONNECTION_REFUSED 로 뜨는데, 그것은 정책과 무관하다.
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const urls = (process.env.URLS ?? [
  "/", "/equipment", "/equipment/reserve", "/members", "/news", "/notices",
  "/shape-up", "/resources", "/organization", "/about", "/greeting", "/directions",
  "/contact", "/partners", "/links", "/login", "/mypage", "/admin", "/roadmap",
].join(",")).split(",");

const browser = await chromium.launch();
const page = await browser.newPage();
const found = [];
const isPolicy = (text) => /Content Security Policy|Refused to/i.test(text);
page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" || isPolicy(text)) found.push([page.url(), text]);
});
page.on("pageerror", (error) => found.push([page.url(), `pageerror: ${error.message}`]));

for (const path of urls) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch((error) => found.push([path, `goto: ${error.message}`]));
  await page.waitForTimeout(1200);
}
await browser.close();

const violations = found.filter(([, text]) => isPolicy(text));
console.log(`총 오류 ${found.length}건 / 그중 정책 위반 ${violations.length}건`);
for (const [url, text] of found) console.log("-", url, "::", text.slice(0, 220));
process.exit(violations.length ? 1 : 0);
