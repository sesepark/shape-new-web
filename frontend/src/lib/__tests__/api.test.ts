import { describe, expect, it } from "vitest";
import { itemOrNull, listOrEmpty } from "@/lib/api";

describe("공개 데이터 읽기", () => {
  it("요청이 성공하면 API 결과를 그대로 돌려준다", async () => {
    await expect(listOrEmpty(Promise.resolve([1, 2]))).resolves.toEqual([1, 2]);
    await expect(itemOrNull(Promise.resolve("live"))).resolves.toBe("live");
  });

  it("요청이 실패하면 빈 값을 돌려준다 — 예시 데이터로 채우지 않는다", async () => {
    await expect(listOrEmpty(Promise.reject(new Error("down")))).resolves.toEqual([]);
    await expect(itemOrNull(Promise.reject(new Error("down")))).resolves.toBeNull();
  });
});
