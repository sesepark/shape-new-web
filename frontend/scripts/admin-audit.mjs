/**
 * 관리자 페이지의 탭을 하나씩 열어 가며 무너지는 자리를 찾는다.
 *
 *   npx next dev -p 3100 &
 *   node scripts/admin-audit.mjs http://localhost:3100
 *
 * 왜 필요한가: `/admin` 은 로그인해야 보이는 데다, 탭이 스물넷이고 주소에
 * 남지 않아 눈으로 훑기가 어렵다. 개발 모드에서는 로그인 없이 화면 구성만
 * 볼 수 있으므로(`app/admin/page.tsx` 의 preview), 여기서 탭을 하나씩 눌러
 * 크기별로 재 본다.
 *
 * 관리자 창구는 쿠키가 없으면 답하지 않고, 공개 창구도 다른 출처에서 부르면
 * CORS 에 막힌다. 그래서 두 가지를 대신 넣는다.
 *
 *   - 관리자 창구: `admin-sample.mjs` 의 흉내 낸 자료. **글과 사람이 쌓인 뒤**를
 *     기준으로 넉넉히(회원 34명, 예약 28건, 기록 50건) 만들어 두었다. 지금
 *     자료가 적다고 괜찮아 보이는 화면을 통과시키지 않기 위해서다.
 *   - 공개 창구: 운영 서버에서 노드로 미리 받아 그대로 돌려준다. 부원 목록은
 *     84명으로 부풀린다.
 *
 * 찾는 것은 responsive-audit.mjs 와 같다(pill-wrap / off-screen / clipped /
 * text-spill). 환경 변수도 같은 이름을 쓴다: BROWSER, SIZES, TABS, SHOT_W.
 * 두 번째 인자를 주면 그 폴더에 탭마다 화면을 찍어 둔다.
 */
import { chromium, firefox, webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import { mockFor } from "./admin-sample.mjs";

const base = process.argv[2] ?? "http://localhost:3100";
const outDir = process.argv[3];
const engine = { chromium, firefox, webkit }[process.env.BROWSER ?? "chromium"];
const sizes = (process.env.SIZES ?? "3440x1345,2560x985,1920x985,1280x800,820x1180,390x844")
  .split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { w, h }; });
const TABS = process.env.TABS ? process.env.TABS.split(",") : [
  "히어로","인트로","단계","현황","일정",
  "인사말","동아리 소개","조직도","부원",
  "보유 장비","라이선스","라이선스 부여","장비예약 관리","관리자 장비예약","사용 통계",
  "SHAPE 뉴스","언론보도","게시판",
  "전체 로드맵","SHAPE-UP","대회","교육","기타",
  "관련 링크",
  "회원 및 권한","수정 내역","서버",
];

const probe = () => {
  const de = document.documentElement;
  const out = [];
  const path = (el) => { const b = []; for (let n = el; n && n.nodeType === 1 && b.length < 3; n = n.parentElement) b.unshift(n.tagName.toLowerCase() + (typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : "")); return b.join(">"); };
  const skip = (el) => el.closest(".sr-only, .footer-art, .footer-ai-worker") || el.classList.contains("sr-only") || el.classList.contains("site-footer") || el.classList.contains("nav-label");
  if (de.scrollWidth > de.clientWidth + 1) out.push({ kind: "doc-scroll", sel: "html", info: `${de.scrollWidth}>${de.clientWidth}` });
  for (const el of document.querySelectorAll(".admin-layout *")) {
    if (skip(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const txt = (el.textContent || "").trim().slice(0, 26);
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const scrollable = (() => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.overflowX === "auto" || c.overflowX === "scroll") return true; } return false; })();
    if (cs.display.includes("flex") && cs.flexWrap === "wrap" && cs.flexDirection.startsWith("row") && radius >= 30 && el.children.length > 1) {
      const kids = Array.from(el.children).map((c) => c.getBoundingClientRect());
      const tallest = Math.max(...kids.map((k) => k.height));
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      if (r.height > tallest + pad + 8) out.push({ kind: "pill-wrap", sel: path(el), info: `h${Math.round(r.height)}>${Math.round(tallest + pad)}`, txt });
    }
    if (!scrollable && cs.position !== "fixed" && (r.right > de.clientWidth + 1 || r.left < -1) && el.children.length === 0 && txt)
      out.push({ kind: "off-screen", sel: path(el), info: `${Math.round(r.left)}..${Math.round(r.right)}/${de.clientWidth}`, txt });
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
  return out;
};

const browser = await engine.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
// 공개 창구는 브라우저가 다른 출처로 부르면 CORS 에 막혀 빈 화면이 된다.
// 노드에서 미리 받아 두었다가 그대로 돌려준다. 부원 목록은 사람이 늘어난 뒤를
// 보려고 부풀린다.
const pages = new Map();
for (const slug of ["members", "greeting", "about", "organization", "home"]) {
  const r = await fetch(`https://api.snu-shape.com/api/v1/pages/${slug}`).catch(() => null);
  if (r?.ok) pages.set(slug, await r.json());
}
const mem = pages.get("members");
if (mem?.contentJson?.members) {
  const base = mem.contentJson.members;
  mem.contentJson.members = Array.from({ length: 84 }, (_, i) => ({
    ...base[i % base.length], id: `${base[i % base.length].id}-${i}`,
    name: i % 7 === 0 ? "황보름다운나리" : base[i % base.length].name,
    role: i % 5 === 0 ? "SHAPE-UP 3팀 팀장 겸 교육 트랙 멘토" : base[i % base.length].role,
  }));
}
await page.route(/\/api\/v1\/pages\//, (route) => {
  const slug = new URL(route.request().url()).pathname.split("/").pop().split("?")[0];
  const body = pages.get(slug);
  if (!body) return route.continue();
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
// 관리자 창구는 로그인 쿠키가 있어야 답하므로, 자료 모양대로 흉내 낸 응답을 준다.
await page.route(/\/api\/v1\/admin\//, (route) => {
  const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, "").split("?")[0];
  const body = mockFor(path);
  if (body === undefined) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
const failed = new Set();
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) failed.add(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
if (outDir) await mkdir(outDir, { recursive: true });

const rows = [];
for (const { w, h } of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base + "/admin", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  for (const tab of TABS) {
    const button = page.locator(`.admin-tab`, { hasText: new RegExp(`^${tab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
    if (!(await button.count())) { rows.push({ vp: `${w}x${h}`, tab, kind: "missing-tab", sel: "-", info: "탭 버튼 없음" }); continue; }
    await button.click().catch(() => {});
    await page.waitForTimeout(900);
    if (outDir && w === Number(process.env.SHOT_W ?? 1920)) await page.screenshot({ path: `${outDir}/${tab.replace(/[\/ ]/g, "_")}.png`, fullPage: true }).catch(() => {});
    for (const f of await page.evaluate(probe)) rows.push({ vp: `${w}x${h}`, tab, ...f });
  }
}
const byKey = new Map();
for (const r of rows) {
  const k = `${r.tab}|${r.kind}|${r.sel}|${r.txt ?? ""}`;
  if (!byKey.has(k)) byKey.set(k, { ...r, vps: [] });
  byKey.get(k).vps.push(r.vp);
}
let last = "";
for (const v of byKey.values()) {
  if (v.tab !== last) { console.log(`\n### ${v.tab}`); last = v.tab; }
  console.log(`  [${v.kind}] ${v.sel} ${v.txt ? `"${v.txt}"` : ""} — ${v.info} @ ${v.vps.join(" ")}`);
}
console.log(`\ntotal ${byKey.size}`);
console.log("\n실패한 API 호출:", [...failed].slice(0, 25));
await browser.close();
