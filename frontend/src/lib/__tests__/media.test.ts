import { describe, expect, it } from "vitest";
import { media, optimizable } from "@/lib/media";

describe("cloudinary delivery", () => {
  const original = "https://res.cloudinary.com/shape/image/upload/v1712/shape/news/cover.jpg";

  it("asks for a modern format at the size the layout needs", () => {
    expect(media(original, 720)).toBe(
      "https://res.cloudinary.com/shape/image/upload/f_auto,q_auto,c_limit,w_720/v1712/shape/news/cover.jpg",
    );
  });

  it("leaves other hosts and already transformed URLs alone", () => {
    expect(media("https://www.snu-shape.com/figs/name.jpeg", 560)).toBe("https://www.snu-shape.com/figs/name.jpeg");
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
