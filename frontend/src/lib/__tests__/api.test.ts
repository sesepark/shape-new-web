import { describe, expect, it } from "vitest";
import { itemOrNull, listOrEmpty } from "@/lib/api";

describe("public data fallbacks", () => {
  it("returns the API result when the request succeeds", async () => {
    await expect(listOrEmpty(Promise.resolve([1, 2]), [9])).resolves.toEqual([1, 2]);
    await expect(itemOrNull(Promise.resolve("live"), () => "sample")).resolves.toBe("live");
  });

  it("falls back to sample content outside production", async () => {
    await expect(listOrEmpty(Promise.reject(new Error("down")), [9])).resolves.toEqual([9]);
    await expect(itemOrNull(Promise.reject(new Error("down")), () => "sample")).resolves.toBe("sample");
  });
});
