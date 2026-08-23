import { describe, expect, it } from "vitest";
import { groupForPath, isRouteActive, navigation } from "@/lib/navigation";

describe("navigation", () => {
  it("keeps every dropdown link inside its group's paths", () => {
    for (const group of navigation) {
      for (const child of group.children) {
        const owner = groupForPath(child.href);
        expect(owner?.label, `${child.href} 는 어떤 그룹에도 속하지 않습니다`).toBe(group.label);
      }
    }
  });

  it("treats a section root as active for its own detail pages only", () => {
    expect(isRouteActive("/news/abc", "/news")).toBe(true);
    expect(isRouteActive("/newsletter", "/news")).toBe(false);
    expect(isRouteActive("/", "/")).toBe(true);
    expect(isRouteActive("/about", "/")).toBe(false);
  });
});
