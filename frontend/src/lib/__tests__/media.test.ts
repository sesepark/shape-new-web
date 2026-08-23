import { describe, expect, it } from "vitest";
import { media } from "@/lib/media";

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
