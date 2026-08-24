"use client";

import { useEffect } from "react";

/**
 * 본문에 들어 있는 수식을 그립니다.
 *
 * 글에는 `<div data-math="x^2">x^2</div>` 만 저장되어 있습니다. 이 조각이 화면에
 * 올라온 뒤 그 자리를 찾아 KaTeX 로 그립니다. 그린 결과를 저장하지 않는 이유는
 * 두 가지입니다. 본문이 몇 배로 불어나고, 서버의 지우개에 허용해야 할 태그가
 * 한없이 늘어나기 때문입니다.
 *
 * KaTeX 는 300KB 가까이 되므로 **수식이 실제로 있는 글에서만** 내려받습니다.
 * 무료 요금제에서는 이런 것 하나가 그대로 전송량이 됩니다.
 */
export function MathContent({ html }: { html: string }) {
  useEffect(() => {
    if (!html.includes("data-math")) return;
    let cancelled = false;
    void (async () => {
      const [{ default: katex }] = await Promise.all([
        import("katex"),
        // 스타일도 함께 받아야 글자가 겹치지 않습니다.
        import("katex/dist/katex.min.css"),
      ]);
      if (cancelled) return;
      document.querySelectorAll<HTMLElement>("[data-math]:not([data-math-done])").forEach((node) => {
        const latex = node.getAttribute("data-math") ?? "";
        node.setAttribute("data-math-done", "true");
        try {
          katex.render(latex, node, { displayMode: true, throwOnError: false });
        } catch {
          // 식이 잘못돼도 글은 남아야 합니다. 원문을 그대로 둡니다.
          node.textContent = latex;
        }
      });
    })();
    return () => { cancelled = true; };
  }, [html]);
  return null;
}
