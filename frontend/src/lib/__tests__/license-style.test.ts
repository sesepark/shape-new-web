import { describe, expect, it } from "vitest";
import { licenseStyle } from "@/lib/license-style";

describe("라이선스 이름으로 카드 얼굴 정하기", () => {
  it("지금 등록된 여덟 종이 저마다 다른 갈래로 간다", () => {
    const mapped = [
      "AI Worker 운용 교육",
      "OMY 운용 교육",
      "SO-ARM 101 운용 교육",
      "GPU 워크스테이션 이용 교육",
      "Tesollo Hand 운용 교육",
      "ROBOTIS Hand 운용 교육",
      "LEAP Hand 운용 교육",
      "카메라 이용 교육",
    ].map((name) => [name, licenseStyle(name).kind] as const);
    expect(Object.fromEntries(mapped)).toEqual({
      "AI Worker 운용 교육": "HMN",
      "OMY 운용 교육": "ARM",
      "SO-ARM 101 운용 교육": "ARM",
      "GPU 워크스테이션 이용 교육": "CMP",
      "Tesollo Hand 운용 교육": "HND",
      "ROBOTIS Hand 운용 교육": "HND",
      "LEAP Hand 운용 교육": "HND",
      "카메라 이용 교육": "SNS",
    });
  });

  it("손 규칙이 팔 규칙보다 먼저 걸린다", () => {
    // 순서가 뒤집히면 "Tesollo Hand" 가 팔로 분류된다.
    expect(licenseStyle("로봇 손 운용 교육").kind).toBe("HND");
    expect(licenseStyle("로봇 팔 기초 교육").kind).toBe("ARM");
  });

  it("안전 교육과 휴머노이드도 갈라진다", () => {
    expect(licenseStyle("로봇 안전 교육").kind).toBe("SFT");
    expect(licenseStyle("휴머노이드 운용 교육").kind).toBe("HMN");
  });

  it("모르는 이름은 기본 얼굴을 쓴다", () => {
    const style = licenseStyle("3D 프린터 이용 안내");
    expect(style.kind).toBe("GEN");
    expect(style.accent).toBeTruthy();
  });
});
