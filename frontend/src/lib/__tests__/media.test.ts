import { describe, expect, it } from "vitest";
import { media, mediaSquare, optimizable } from "@/lib/media";

describe("cloudinary delivery", () => {
  const original = "https://res.cloudinary.com/shape/image/upload/v1712/shape/news/cover.jpg";

  it("asks for a modern format at the size the layout needs", () => {
    expect(media(original, 720)).toBe(
      "https://res.cloudinary.com/shape/image/upload/f_auto,q_auto,c_limit,w_720/v1712/shape/news/cover.jpg",
    );
  });

  it("옛 사이트 주소로 저장된 부원 사진은 우리 폴더의 상대 경로로 바꾼다", () => {
    // 절대 주소로 두면 이미지 최적화가 제 사이트에 HTTP 요청을 한 번 더 보낸다.
    expect(media("https://www.snu-shape.com/figs/name.jpeg", 560)).toBe("/figs/name.jpeg");
    expect(media("https://www.snu-shape.com/figs/%EA%B9%80%EC%A4%80%EC%84%9C.jpeg", 560)).toBe(
      "/figs/%EA%B9%80%EC%A4%80%EC%84%9C.jpeg",
    );
  });

  it("leaves other hosts and already transformed URLs alone", () => {
    const transformed = "https://res.cloudinary.com/shape/image/upload/w_100/v1/a.jpg";
    expect(media(transformed, 720)).toBe(transformed);
    expect(media("", 720)).toBe("");
    expect(media(null, 720)).toBe("");
  });
});

describe("optimizable", () => {
  it("leaves already transformed and unknown hosts alone", () => {
    // Cloudinary 는 media() 가 이미 크기와 형식을 지정해 두었다.
    expect(optimizable("https://res.cloudinary.com/shape/image/upload/f_auto/a.jpg")).toBe(false);
    // remotePatterns 에 없는 주소를 최적화에 넘기면 400 이 난다.
    expect(optimizable("https://example.com/photo.jpg")).toBe(false);
    expect(optimizable(null)).toBe(false);
    expect(optimizable("")).toBe(false);
  });

  it("optimizes the photos we serve ourselves", () => {
    expect(optimizable("/figs/name.jpeg")).toBe(true);
    expect(optimizable("https://www.snu-shape.com/figs/name.jpeg")).toBe(true);
  });
});

describe("장비 사진은 잘라내지 않고 통째로 담는다", () => {
  const original = "https://res.cloudinary.com/shape/image/upload/v1712/shape/equipment/hand.png";

  it("빈 여백을 떼고 칸 안에 맞춘 뒤, 늘리지 않고 여백만 채운다", () => {
    // 예전에는 c_fill 로 잘라 맞춰서 넓은 제품 사진의 물건이 잘려 나갔습니다
    // (로봇 손 사진에서 손가락이 화면 밖으로 나갔습니다).
    expect(mediaSquare(original, 800)).toBe(
      "https://res.cloudinary.com/shape/image/upload/e_trim/c_pad,b_transparent,w_704,h_704/" +
        "c_lpad,b_transparent,w_800,h_800,f_auto,q_auto:good/v1712/shape/equipment/hand.png",
    );
  });

  it("마지막 칸을 c_lpad 로 채운다 — c_pad 를 두 번 쓰면 다시 키워 여백이 사라진다", () => {
    const url = mediaSquare(original, 1200);
    expect(url).toContain("c_pad,b_transparent,w_1056,h_1056/");
    expect(url).toContain("c_lpad,b_transparent,w_1200,h_1200,");
  });

  it("우리 폴더의 그림과 이미 변환된 주소는 그대로 둔다", () => {
    // public/equipment/ 의 3D 렌더는 이미 여백이 정리돼 있어 Next.js 최적화로 갑니다.
    expect(mediaSquare("/equipment/ai-worker-2.png", 800)).toBe("/equipment/ai-worker-2.png");
    expect(mediaSquare("https://res.cloudinary.com/shape/image/upload/w_100/v1/a.png", 800)).toBe(
      "https://res.cloudinary.com/shape/image/upload/w_100/v1/a.png",
    );
    expect(mediaSquare(null, 800)).toBe("");
  });
});
