import { describe, expect, it } from "vitest";
import { youtubeEmbed, youtubeId, youtubeThumbnail } from "@/lib/youtube";

describe("youtubeId", () => {
  it("여러 모양의 유튜브 주소에서 id 를 뽑는다", () => {
    const cases: [string, string][] = [
      ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s", "dQw4w9WgXcQ"],
      ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ?t=12", "dQw4w9WgXcQ"],
    ];
    for (const [url, id] of cases) expect(youtubeId(url), url).toBe(id);
  });

  it("유튜브가 아니면 빈 문자열이다", () => {
    // 이 값이 곧 '영상 칸에 빨간 글씨를 띄울지' 를 정한다. 서버도 같은 잣대다.
    for (const url of [
      "https://vimeo.com/12345",
      "https://example.com/demo.mp4",
      // 진짜 유튜브처럼 보이려는 주소도 걸러야 한다.
      "https://youtube.com.evil.example/watch?v=x",
      "https://notyoutube.com/watch?v=x",
      "그냥 글자",
      "",
    ]) expect(youtubeId(url), url).toBe("");
    expect(youtubeId(null)).toBe("");
    expect(youtubeId(undefined)).toBe("");
  });
});

describe("youtubeEmbed", () => {
  it("추적 쿠키를 심지 않는 주소로 만든다", () => {
    // 공개 페이지라 로그인하지 않은 방문자도 온다. 우리가 그들에게 흔적을
    // 남길 이유가 없다.
    expect(youtubeEmbed("https://youtu.be/dQw4w9WgXcQ"))
      .toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  });

  it("유튜브가 아니면 빈 문자열이라 화면이 상자를 그리지 않는다", () => {
    expect(youtubeEmbed("https://vimeo.com/1")).toBe("");
  });
});

describe("youtubeThumbnail", () => {
  it("표지를 안 올린 팀의 카드를 유튜브 그림으로 채운다", () => {
    // hqdefault 를 쓰는 이유: maxresdefault 는 없는 영상이 있어 깨진 그림이 된다.
    expect(youtubeThumbnail("https://youtu.be/dQw4w9WgXcQ"))
      .toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(youtubeThumbnail(null)).toBe("");
  });
});
