/**
 * 화면 크기·글꼴·브라우저를 바꿔 가며 무너지는 자리를 찾는다.
 *
 *   npx next dev -p 3100 &
 *   node scripts/responsive-audit.mjs http://localhost:3100
 *
 * 왜 있는가: 이 사이트의 깨짐은 대부분 "내 컴퓨터에서는 멀쩡한데 저쪽에서는
 * 무너진다" 는 모양으로 온다. 글꼴 폭, 창 높이, 브라우저 엔진이 조금씩 달라서다.
 * 그래서 눈으로 한 번 보는 대신, 열네 가지 크기(32:9 울트라 와이드부터 320px
 * 휴대폰까지)를 훑으면서 다음 네 가지를 기계로 잡는다.
 *
 *   pill-wrap          알약 모양 캡슐 안의 항목이 두 줄로 접힌 곳
 *   off-screen         가로로 화면 밖에 나간 글(가로 스크롤 상자 안은 뺀다)
 *   clipped            넘치는데 감춰서 글자가 잘리는 곳(줄 수 제한·말줄임은 뺀다)
 *   spills-out         제 칸 밖으로 삐져나온 곳
 *   taller-than-screen 홈에서 한 장이 화면 높이를 넘은 곳(스냅이 mandatory 인
 *                      높이, 즉 창 높이 760px 초과에서만 본다)
 *
 * 환경 변수
 *   BROWSER=chromium|firefox|webkit   기본 chromium. firefox·webkit 은
 *                                     `npx playwright install firefox webkit` 이 필요하다.
 *   FONT="Arial, sans-serif"          글꼴을 강제로 바꿔 다른 환경을 흉내 낸다.
 *   BLOCK_FONT=1                      글꼴을 못 받아 온 순간의 배치를 본다.
 *   FAKE_SESSION=1                    로그인해야 보이는 화면의 배치도 본다.
 *   URLS=/,/equipment                 볼 주소. SIZES=1920x985,390x844 크기.
 */
import { chromium, firefox, webkit } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const font = process.env.FONT;
const urls = (process.env.URLS ?? [
  "/", "/equipment", "/equipment/reserve", "/equipment/status",
  "/members", "/roadmap", "/roadmap/education", "/notices", "/news", "/news/press",
  "/shape-up", "/resources", "/organization", "/about", "/greeting",
  "/directions", "/contact", "/partners", "/links", "/login",
].join(",")).split(",");
const sizes = (process.env.SIZES ?? "3840x1080,3440x1345,2560x985,1920x985,1512x860,1366x640,1280x720,1024x1366,820x1180,768x1024,430x932,390x844,360x740,320x568").split(",")
  .map((s) => { const [w, h] = s.split("x").map(Number); return { w, h }; });

const probe = () => {
  const de = document.documentElement;
  const out = [];
  const path = (el) => { const b = []; for (let n = el; n && n.nodeType === 1 && b.length < 3; n = n.parentElement) b.unshift(n.tagName.toLowerCase() + (typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : "")); return b.join(">"); };
  // 푸터는 로봇 그림이 상자 밖으로 걸치도록 일부러 잘라 두는 곳이라 넘침 검사에서 뺍니다.
  const skip = (el) => el.closest(".sr-only, .footer-art, .footer-ai-worker") || el.classList.contains("sr-only") || el.classList.contains("site-footer")
    // 머리글 메뉴는 다음 글자가 상자 아래에 접혀 대기하도록 일부러 잘라 둡니다.
    || el.classList.contains("nav-label");
  if (de.scrollWidth > de.clientWidth + 1) out.push({ kind: "doc-scroll", sel: "html", info: `${de.scrollWidth}>${de.clientWidth}` });
  for (const el of document.querySelectorAll("body *")) {
    if (skip(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const txt = (el.textContent || "").trim().slice(0, 26);
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    // 1) 알약 모양인데 안의 항목이 두 줄로 접힌 곳. 높이로 판정한다.
    if (cs.display.includes("flex") && cs.flexWrap === "wrap" && cs.flexDirection.startsWith("row") && radius >= 30 && el.children.length > 1) {
      const kids = Array.from(el.children).map((c) => c.getBoundingClientRect());
      const tallest = Math.max(...kids.map((k) => k.height));
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      if (r.height > tallest + pad + 8) out.push({ kind: "pill-wrap", sel: path(el), info: `h${Math.round(r.height)}>${Math.round(tallest + pad)}`, txt });
    }
    // 2) 가로로 화면 밖에 나간 잎 요소
    const scrollable = (() => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.overflowX === "auto" || c.overflowX === "scroll") return true; } return false; })();
    if (!scrollable && cs.position !== "fixed" && (r.right > de.clientWidth + 1 || r.left < -1) && el.children.length === 0 && txt)
      out.push({ kind: "off-screen", sel: path(el), info: `${Math.round(r.left)}..${Math.round(r.right)}/${de.clientWidth}`, txt });
    // 3) 넘치는데 감춰서 글자가 잘리는 곳(줄 수 제한·말줄임은 뺀다)
    const clamped = cs.webkitLineClamp !== "none" || cs.textOverflow === "ellipsis";
    const hides = (cs.overflowX === "hidden" || cs.overflowY === "hidden") && cs.overflowX !== "auto" && cs.overflowY !== "auto";
    if (!scrollable && hides && !clamped && txt && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4) && el.clientWidth)
      out.push({ kind: "clipped", sel: path(el), info: `${el.scrollWidth}x${el.scrollHeight}>${el.clientWidth}x${el.clientHeight}`, txt });
    // 제 칸 밖으로 삐져나온 곳. 자르지 않아 화면 밖까지는 안 가더라도 옆 칸을
    // 침범합니다. 덩이(블록)면 그 안에 그려진 글자가 상자를 넘었는지 재고,
    // 줄 안에 흐르는 조각이면 부모 칸을 넘었는지 잽니다. scrollWidth 는 글꼴의
    // 잉크 여유까지 세어 멀쩡한 곳도 넘쳤다고 하므로 쓰지 않습니다.
    const block = !cs.display.startsWith("inline") && cs.display !== "contents";
    // 글자를 직접 담은 잎만 봅니다. 자식 요소를 품은 상자에 같은 잣대를 대면
    // 가로 스크롤 칸 안의 글까지 넘쳤다고 잡혀 쓸모가 없어집니다.
    if (txt && cs.position === "static" && el.children.length === 0) {
      if (block && el.clientWidth) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect();
        const right = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const left = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        if (t.width && !hides && (t.right > right + 1.5 || t.left < left - 1.5))
          out.push({ kind: "spills-out", sel: path(el), info: `글자 ${Math.round(t.left)}..${Math.round(t.right)} / 칸 ${Math.round(left)}..${Math.round(right)}`, txt });
      } else if (!block && el.parentElement) {
        const parent = el.parentElement, pcs = getComputedStyle(parent), pr = parent.getBoundingClientRect();
        const right = pr.right - parseFloat(pcs.paddingRight) - parseFloat(pcs.borderRightWidth);
        const left = pr.left + parseFloat(pcs.paddingLeft) + parseFloat(pcs.borderLeftWidth);
        const flows = pcs.overflowX === "visible" && pcs.overflowY === "visible";
        if (flows && parent.clientWidth && (r.right > right + 1.5 || r.left < left - 1.5))
          out.push({ kind: "spills-out", sel: path(el), info: `${Math.round(r.left)}..${Math.round(r.right)} / 칸 ${Math.round(left)}..${Math.round(right)}`, txt });
      }
    }
  }
  // 4) 홈은 한 장이 화면 높이를 넘으면 안 된다 — **스냅이 mandatory 인 높이에서만.**
  //
  // `site-polish.css` 는 창이 760px 보다 낮으면 스냅을 `proximity` 로 낮춘다.
  // 노트북에 도구 모음을 여러 줄 띄웠거나 세로로 화면을 나눠 쓰는 경우, 다음
  // 일정 장(플랫폼·대회·타임라인)은 어떤 여백을 줄여도 640px 안에 들어가지
  // 않는다. 그런 높이에서 mandatory 로 두면 넘친 아랫부분이 늘 위로 튕겨
  // 올라가므로, 스냅을 낮춰 읽을 수 있게 하는 것이 그 화면에서의 정답이다.
  //
  // 그래서 여기서도 같은 경계를 쓴다. 낮은 창까지 보고하면 고칠 수도, 고쳐서도
  // 안 되는 지적이 늘 네 건씩 남아 사람이 이 도구의 출력을 읽지 않게 된다.
  if (window.innerHeight > 760) {
    for (const s of document.querySelectorAll(".shape-home > section")) {
      const r = s.getBoundingClientRect();
      if (r.height > window.innerHeight + 2) out.push({ kind: "taller-than-screen", sel: "#" + (s.id || "?"), info: `${Math.round(r.height)}>${window.innerHeight}` });
    }
  }
  return out;
};

const engine = { chromium, firefox, webkit }[process.env.BROWSER ?? "chromium"];
const browser = await engine.launch();
// 스크롤에 맞춰 움직이는 연출을 끄고 잽니다. 켜 두면 잠깐 옮겨져 있는 요소가
// 넘침으로 잘못 잡힙니다.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
// 글꼴을 못 받아 온 순간(느린 회선, 차단)에도 배치가 버티는지 보려면 BLOCK_FONT=1.
if (process.env.BLOCK_FONT) await page.route(/\.woff2?($|\?)/, (r) => r.abort());
// 로그인해야 보이는 화면(마이페이지·관리자)의 배치도 보려면 FAKE_SESSION=1.
// 세션 조회만 가짜로 답하고 나머지 자료는 그대로 둡니다.
if (process.env.FAKE_SESSION) await page.route(/\/auth\/me(\?|$)/, (r) => r.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ id: "probe", name: "홍길동", email: "probe@example.com", status: "ACTIVE", isOwner: true, permissions: ["OWNER"], licenses: [] }),
}));
if (font) await page.addInitScript((f) => {
  const put = () => { const s = document.createElement("style"); s.textContent = `body, body * { font-family: ${f} !important; }`; document.head.appendChild(s); };
  if (document.head) put(); else document.addEventListener("DOMContentLoaded", put);
}, font);

let total = 0;
for (const url of urls) {
  const rows = [];
  let first = true;
  for (const { w, h } of sizes) {
    await page.setViewportSize({ width: w, height: h });
    if (first) { await page.goto(base + url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {}); first = false; }
    else await page.reload({ waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(450);
    const found = await page.evaluate(probe);
    for (const f of found) rows.push({ vp: `${w}x${h}`, ...f });
  }
  if (!rows.length) continue;
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.kind}|${r.sel}|${r.txt ?? ""}`;
    if (!byKey.has(k)) byKey.set(k, { ...r, vps: [] });
    byKey.get(k).vps.push(r.vp);
  }
  console.log(`\n### ${url}`);
  for (const v of byKey.values()) { total++; console.log(`  [${v.kind}] ${v.sel} ${v.txt ? `"${v.txt}"` : ""} — ${v.info} @ ${v.vps.join(" ")}`); }
}
console.log(`\ntotal ${total}`);
await browser.close();
