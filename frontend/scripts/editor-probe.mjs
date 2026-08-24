/**
 * 글쓰기 도구를 진짜 브라우저로 눌러 보는 점검표.
 *
 * 편집기 버그는 "코드를 읽어 보면 맞는 것 같은데 화면에서는 다르게 동작한다" 는
 * 쪽이 많아서, 눈으로 확인할 수 없으면 고쳤는지 알 수 없습니다. 실제로 글자
 * 크기가 기본보다 작았던 것도, 줄바꿈으로 이어 쓴 글에서 문단 모양이 글 전체로
 * 번지던 것도 이 점검표로 재현해서 찾았습니다.
 *
 * 크로미움과 웹킷(사파리) 둘 다 돌립니다. 부원 상당수가 아이폰과 맥에서 쓰므로
 * 웹킷에서만 나는 차이를 놓치면 안 됩니다.
 *
 * 쓰는 법 (백엔드 8010, 개발 서버 3010 을 먼저 띄운 뒤):
 *   cd frontend && node scripts/editor-probe.mjs
 *
 * 마우스 드래그는 몇 글자가 골릴지 딱 맞출 수 없습니다. 그래서 "이런 결과가
 * 나와야 한다" 를 미리 적어 두지 않고, **실제로 골린 것을 보고** 판정하는 쪽으로
 * 씁니다. 그러지 않으면 도구가 멀쩡한데 점검표만 빨개집니다.
 */
import { chromium, webkit } from "playwright";

const BASE = "http://localhost:3010";
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${detail ? `\n         ${detail}` : ""}`);
};

/**
 * 시험 하나마다 화면을 새로 연다.
 *
 * 편집기는 앞선 조작의 흔적(예: '다음에 입력할 글자' 에 걸린 크기)을 들고 있어서,
 * 한 화면에서 여러 시험을 이어 하면 앞 시험이 뒷 시험을 오염시킨다. 실제로
 * 그렇게 해서 엉뚱한 실패가 났다.
 */
async function freshEditor(page, tab = "인사말") {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: tab, exact: true }).click({ timeout: 40000 });
  const body = page.locator(".rich-editor .tiptap");
  await body.waitFor({ state: "attached", timeout: 60000 });
  await body.waitFor({ state: "visible", timeout: 60000 });
  await body.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  return body;
}

/** 문단(Enter)으로 나눠 넣는다. */
async function typeParagraphs(page, lines) {
  for (const [index, line] of lines.entries()) {
    if (index) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

/** 한 문단 안에서 Shift+Enter 로 줄만 내려 넣는다(= 문단은 하나). */
async function typeSoftLines(page, lines) {
  for (const [index, line] of lines.entries()) {
    if (index) await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(line);
  }
}

const menuButton = (page, label) => page.getByRole("button", { name: label, exact: true }).first();

async function pick(page, menuLabel, optionLabel) {
  await menuButton(page, menuLabel).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
  await page.waitForTimeout(180);
}

/** 글자 몇 번째부터 몇 번째까지를 진짜 마우스 드래그로 고른다. */
async function dragChars(page, locator, from, to) {
  const at = await locator.evaluate((el, [a, b]) => {
    // Shift+Enter 로 줄을 내리면 한 문단 안에 텍스트 조각이 여럿 생긴다(<br> 로
    // 갈린다). 조각 하나만 보면 "8번째 글자" 같은 자리를 못 찾으므로, 조각들을
    // 이어 붙인 전체 기준으로 센다.
    const nodes = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) nodes.push(node);
    const range = document.createRange();
    const point = (offset) => {
      let left = offset;
      for (const node of nodes) {
        if (left <= node.length) {
          range.setStart(node, left);
          range.setEnd(node, left);
          const rect = range.getBoundingClientRect();
          return [rect.left, rect.top + rect.height / 2];
        }
        left -= node.length;
      }
      throw new Error(`글자 ${offset} 번째가 없습니다`);
    };
    return [point(a), point(b)];
  }, [from, to]);
  await page.mouse.move(at[0][0], at[0][1]);
  await page.mouse.down();
  await page.mouse.move(at[1][0], at[1][1], { steps: 14 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection().toString());
}

const THREE = ["첫째 문단입니다", "둘째 문단입니다", "셋째 문단입니다"];
const PLAIN = "<p>첫째 문단입니다</p><p>둘째 문단입니다</p><p>셋째 문단입니다</p>";

async function probe(engine, name) {
  console.log(`\n════════ ${name} ════════`);
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => record(`${name}: 화면 오류`, false, error.message));
  let body;

  // ── 1. 글자 크기가 기본보다 실제로 크고 작은가 ────────────────────────
  const measured = {};
  let base = null;
  for (const label of ["작게", "크게", "제목"]) {
    body = await freshEditor(page);
    await typeParagraphs(page, ["크기 시험 문단"]);
    if (base === null) base = await body.locator("p").first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    await page.keyboard.press("ControlOrMeta+a");
    await pick(page, "글자 크기", label);
    measured[label] = await page.evaluate(() => {
      const span = document.querySelector(".rich-editor .tiptap span[style*='font-size']");
      return span ? parseFloat(getComputedStyle(span).fontSize) : null;
    });
  }
  record(`${name} · 글자 크기 차례가 작게<기본<크게<제목 인가`,
    measured["작게"] < base && base < measured["크게"] && measured["크게"] < measured["제목"],
    `작게 ${measured["작게"]}px / 기본 ${base}px / 크게 ${measured["크게"]}px / 제목 ${measured["제목"]}px`);

  // ── 2. 크기를 준 뒤 지우고 새로 쓰면 그 크기가 따라붙는가 ───────────────
  body = await freshEditor(page);
  await typeParagraphs(page, ["크기 시험"]);
  await page.keyboard.press("ControlOrMeta+a");
  await pick(page, "글자 크기", "제목");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("새로 쓰는 글");
  let after = await body.innerHTML();
  record(`${name} · 다 지우고 새로 쓴 글에 옛 크기가 따라붙지 않는가`,
    !after.includes("font-size"), after);

  // ── 3. 문단 모양이 고른 곳 밖으로 번지지 않는가 ──────────────────────
  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  const partial = await dragChars(page, body.locator("p").nth(1), 1, 4);
  await pick(page, "문단 모양", "제목 1");
  after = await body.innerHTML();
  record(`${name} · 문단 일부만 골라 제목으로 바꾸면 그 문단만 바뀌는가`,
    after === "<p>첫째 문단입니다</p><h1>둘째 문단입니다</h1><p>셋째 문단입니다</p>",
    `고른 글자 ${JSON.stringify(partial)} → ${after}`);

  // ── 4. Shift+Enter 로만 쓴 글에서 일부를 골라 제목으로 바꾸기 ──────────
  //    (문단이 하나뿐이라 고른 곳 밖까지 통째로 바뀐다)
  body = await freshEditor(page);
  await typeSoftLines(page, THREE);
  const softBefore = await body.innerHTML();
  const softPick = await dragChars(page, body.locator("p").first(), 8, 12);
  await pick(page, "문단 모양", "제목 1");
  const softAfter = await body.innerHTML();
  const spread = softAfter.includes("첫째 문단입니다") && softAfter.startsWith("<h1>");
  record(`${name} · Shift+Enter 로 이어 쓴 글에서 일부만 골라도 글 전체가 제목이 되는가`,
    !spread,
    `고른 글자 ${JSON.stringify(softPick)}\n         이전: ${softBefore}\n         이후: ${softAfter}`);

  // ── 4b. 줄이 다섯일 때, 고른 줄만 제목이 되고 나머지는 그대로인가 ────────
  //
  // 마우스 드래그는 몇 글자가 골릴지 딱 맞추기 어려워서, "이런 결과가 나와야
  // 한다" 를 미리 적어 두면 시험이 흔들린다. 대신 **실제로 골린 것을 보고**
  // 판정한다. 고른 글자가 몇 줄에 걸쳤든, 제목이 된 줄 수가 그와 같고 글자가
  // 하나도 늘거나 줄지 않았으면 옳다.
  const FIVE = ["첫 줄", "둘째 줄", "셋째 줄", "넷째 줄", "다섯째 줄"];
  const wholeText = FIVE.join("");
  for (const [pickFrom, pickTo, label] of [[8, 10, "가운데"], [1, 2, "첫"], [10, 12, "줄바꿈을 걸친"], [17, 20, "마지막"]]) {
    body = await freshEditor(page);
    await typeSoftLines(page, FIVE);
    const got = await dragChars(page, body.locator("p").first(), pickFrom, pickTo);
    await pick(page, "문단 모양", "제목 1");
    const out = (await body.innerHTML()).replace('<p><br class="ProseMirror-trailingBreak"></p>', "");
    const pickedLines = got.split("\n").length;
    const heading = out.match(/<h1>(.*?)<\/h1>/)?.[1] ?? "";
    const headingLines = heading ? heading.split("<br>").length : 0;
    const text = out.replace(/<br>/g, "").replace(/<[^>]+>/g, "");
    record(`${name} · 줄바꿈 다섯 줄에서 ${label} 줄만 제목이 되는가`,
      headingLines === pickedLines && text === wholeText,
      `고른 줄 ${pickedLines} / 제목이 된 줄 ${headingLines} · 글자 보존 ${text === wholeText} → ${out}`);
  }

  // ── 4c. 편집기에서 준 크기가 공개 화면 미리보기에서도 같은가 ────────────
  body = await freshEditor(page);
  await typeParagraphs(page, ["크기 견주기"]);
  await page.keyboard.press("ControlOrMeta+a");
  await pick(page, "글자 크기", "크게");
  await page.waitForTimeout(500);
  const both = await page.evaluate(() => {
    const inEditor = document.querySelector(".rich-editor .tiptap span[style*='font-size']");
    const inPreview = document.querySelector(".preview-sheet .rich-content span[style*='font-size']");
    return [inEditor && getComputedStyle(inEditor).fontSize, inPreview && getComputedStyle(inPreview).fontSize];
  });
  record(`${name} · 편집기와 공개 화면 미리보기의 글자 크기가 같은가`,
    both[0] !== null && both[0] === both[1], `편집기 ${both[0]} / 미리보기 ${both[1]}`);

  // ── 5. 커서만 두고 바꾸기 / 두 문단 걸치기 ────────────────────────
  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  await body.locator("p").nth(1).click();
  await pick(page, "문단 모양", "제목 2");
  after = await body.innerHTML();
  record(`${name} · 커서만 둔 문단만 바뀌는가`,
    after === "<p>첫째 문단입니다</p><h2>둘째 문단입니다</h2><p>셋째 문단입니다</p>", after);

  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  const one = await body.locator("p").nth(0).boundingBox();
  const two = await body.locator("p").nth(1).boundingBox();
  await page.mouse.move(one.x + 6, one.y + one.height / 2);
  await page.mouse.down();
  await page.mouse.move(two.x + two.width - 6, two.y + two.height / 2, { steps: 12 });
  await page.mouse.up();
  await pick(page, "문단 모양", "제목 3");
  after = await body.innerHTML();
  record(`${name} · 두 문단에 걸치면 그 둘만 바뀌는가`,
    after === "<h3>첫째 문단입니다</h3><h3>둘째 문단입니다</h3><p>셋째 문단입니다</p>", after);

  // ── 6. 인용문·코드에서 되돌아오기 ─────────────────────────────────
  for (const [from, to, want] of [["인용문", "본문", PLAIN], ["코드 블록", "본문", PLAIN]]) {
    body = await freshEditor(page);
    await typeParagraphs(page, THREE);
    await body.locator("p").nth(1).click();
    await pick(page, "문단 모양", from);
    await pick(page, "문단 모양", to);
    after = await body.innerHTML();
    record(`${name} · ${from} → ${to} 되돌리기`, after === want, after);
  }

  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  await body.locator("p").nth(1).click();
  await pick(page, "문단 모양", "인용문");
  await pick(page, "문단 모양", "제목 2");
  after = await body.innerHTML();
  record(`${name} · 인용문 → 제목 2`,
    !after.includes("<blockquote") && after.includes("<h2>둘째 문단입니다</h2>"), after);

  // ── 7. 상자에 지금 상태가 뜨는가 ─────────────────────────────────
  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  await body.locator("p").nth(1).click();
  await pick(page, "문단 모양", "제목 2");
  await body.locator("p").first().click();
  await page.waitForTimeout(150);
  let shown = (await menuButton(page, "문단 모양").innerText()).trim();
  record(`${name} · 커서를 옮기면 문단 모양 상자가 따라오는가`, shown === "본문", `상자에 "${shown}"`);
  await body.locator("h2").first().click();
  await page.waitForTimeout(150);
  shown = (await menuButton(page, "문단 모양").innerText()).trim();
  record(`${name} · 제목 줄에서 상자가 '제목 2' 로 뜨는가`, shown === "제목 2", `상자에 "${shown}"`);

  body = await freshEditor(page);
  await typeParagraphs(page, ["크기 확인 문단"]);
  await page.keyboard.press("ControlOrMeta+a");
  await pick(page, "글자 크기", "크게");
  await page.waitForTimeout(150);
  shown = (await menuButton(page, "글자 크기").innerText()).trim();
  record(`${name} · 크기를 준 뒤 상자가 '크게' 로 뜨는가`, shown === "크게", `상자에 "${shown}"`);

  // ── 8. 줄 간격 · 정렬 · 굵게 ─────────────────────────────────────
  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  await body.locator("p").nth(1).click();
  await pick(page, "줄 간격", "넓게");
  after = await body.innerHTML();
  record(`${name} · 줄 간격이 고른 문단에만 붙는가`,
    (after.match(/line-height/g) || []).length === 1, after);

  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  await body.locator("p").nth(1).click();
  await page.getByRole("button", { name: "가운데 정렬" }).click();
  after = await body.innerHTML();
  record(`${name} · 정렬이 고른 문단에만 붙는가`,
    (after.match(/text-align/g) || []).length === 1, after);

  body = await freshEditor(page);
  await typeParagraphs(page, THREE);
  const boldPick = await dragChars(page, body.locator("p").nth(1), 1, 4);
  const boldRange = await page.evaluate(() => {
    const s = window.getSelection();
    return s.rangeCount ? s.toString() : "";
  });
  await page.getByRole("button", { name: "굵게" }).click();
  after = await body.innerHTML();
  record(`${name} · 굵게가 고른 글자에만 걸리는가`,
    after === `<p>첫째 문단입니다</p><p>둘<strong>${boldRange}</strong>${"둘째 문단입니다".slice(1 + boldRange.length)}</p><p>셋째 문단입니다</p>`,
    `고른 글자 ${JSON.stringify(boldPick)} → ${after}`);

  // ── 9. 목록 안에서 문단 모양 바꾸기 ───────────────────────────────
  body = await freshEditor(page);
  await typeParagraphs(page, ["첫 줄"]);
  await page.getByRole("button", { name: "글머리 목록" }).click();
  await page.keyboard.type("");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째 줄");
  await body.locator("li").first().click();
  await pick(page, "문단 모양", "제목 2");
  after = await body.innerHTML();
  record(`${name} · 목록 한 줄만 제목으로 바꿔도 나머지 줄이 남는가`,
    after.includes("둘째 줄"), after);

  // ── 10. 펼친 목록이 가리지 않는가 ────────────────────────────────
  body = await freshEditor(page);
  await typeParagraphs(page, ["긴 글", ...Array.from({ length: 25 }, (_, i) => `채우는 줄 ${i + 1}`)]);
  await body.locator("p").first().click();
  await menuButton(page, "문단 모양").click();
  const menu = page.locator(".editor-menu-list");
  const menuBox = await menu.boundingBox();
  const covered = await page.evaluate(() => {
    const list = document.querySelector(".editor-menu-list");
    if (!list) return "목록 없음";
    const rect = list.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 8);
    return list.contains(top) ? "덮이지 않음" : `덮임: ${top?.className || top?.tagName}`;
  });
  record(`${name} · 펼친 목록이 본문에 가리지 않는가`,
    (await menu.isVisible()) && covered === "덮이지 않음" && menuBox.height > 100,
    `${covered} · 높이 ${menuBox?.height}px`);
  await page.keyboard.press("Escape");

  // ── 11. 좁은 화면(모바일)에서도 펼친 목록이 보이는가 ────────────────
  await page.setViewportSize({ width: 390, height: 780 });
  body = await freshEditor(page);
  await typeParagraphs(page, ["모바일 확인"]);
  await menuButton(page, "문단 모양").click();
  const small = await page.locator(".editor-menu-list").boundingBox();
  record(`${name} · 좁은 화면에서 펼친 목록이 화면 안에 들어오는가`,
    small && small.x >= 0 && small.x + small.width <= 390 && small.y >= 0 && small.y + small.height <= 780,
    small ? `x ${Math.round(small.x)} w ${Math.round(small.width)} y ${Math.round(small.y)} h ${Math.round(small.height)} (화면 390×780)` : "목록 없음");
  const rowHeight = await page.locator(".editor-menu-list button").first().boundingBox();
  record(`${name} · 좁은 화면에서 목록 한 줄이 손가락으로 누를 만한가(≥40px)`,
    rowHeight && rowHeight.height >= 40, `한 줄 높이 ${Math.round(rowHeight?.height ?? 0)}px`);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ── 12. '저장하지 않은 변경' 표시가 사실대로 뜨는가 ──────────────────
  for (const tab of ["언론보도", "SHAPE 뉴스", "게시판", "인사말"]) {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: tab, exact: true }).click({ timeout: 40000 });
    await page.locator(".rich-editor .tiptap").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(600);
    const marked = await page.locator(".unsaved-mark").count();
    record(`${name} · ${tab} 탭을 열자마자 미저장 표시가 없는가`, marked === 0,
      marked ? "아무것도 고치지 않았는데 '저장하지 않은 변경이 있습니다' 가 떠 있다" : "표시 없음");
  }

  // 글자를 쳤다가 도로 지우면 표시도 사라져야 한다.
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "언론보도", exact: true }).click({ timeout: 40000 });
  await page.locator(".rich-editor .tiptap").waitFor({ state: "visible", timeout: 60000 });
  const titleBox = page.getByRole("textbox", { name: "제목" }).or(page.locator(".admin-form input").first());
  await titleBox.first().fill("시험 제목");
  await page.waitForTimeout(300);
  const whileTyped = await page.locator(".unsaved-mark").count();
  await titleBox.first().fill("");
  await page.waitForTimeout(300);
  const afterUndo = await page.locator(".unsaved-mark").count();
  record(`${name} · 고치면 표시가 뜨고, 되돌리면 사라지는가`,
    whileTyped === 1 && afterUndo === 0, `고쳤을 때 ${whileTyped}개 · 되돌린 뒤 ${afterUndo}개`);

  await browser.close();
}

await probe(chromium, "Chromium");
await probe(webkit, "WebKit(사파리)");

console.log("\n════════ 요약 ════════");
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} 통과\n`);
failed.forEach((r) => console.log(`FAIL ${r.name}\n     ${r.detail}\n`));
