import { describe, expect, it } from "vitest";
import { givenName } from "@/lib/members";

describe("사진 없는 부원 카드에 넣을 이름", () => {
  it("성을 떼고 이름만 남긴다", () => {
    expect(givenName("강채아")).toBe("채아");
    expect(givenName("조초아")).toBe("초아");
    expect(givenName("전라온")).toBe("라온");
  });

  it("두 글자 성씨도 알아본다", () => {
    expect(givenName("남궁민수")).toBe("민수");
    expect(givenName("황보라온")).toBe("라온");
    // 세 글자면 홑성으로 본다. "선우진"은 선우 씨가 아니라 선 씨일 수 있어 안전한 쪽을 택한다.
    expect(givenName("선우진")).toBe("우진");
  });

  it("한글이 아닌 이름은 그대로 쓴다", () => {
    expect(givenName("Anna")).toBe("Anna");
    expect(givenName("Jihun Moon")).toBe("Jihun");
  });

  it("빈 값이나 한 글자도 안전하게 다룬다", () => {
    expect(givenName("")).toBe("");
    expect(givenName("   ")).toBe("");
    expect(givenName("훈")).toBe("훈");
  });
});
