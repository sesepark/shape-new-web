/**
 * 유튜브 주소 다루기.
 *
 * SHAPE-UP 결과물은 **영상을 우리가 받아 두지 않습니다.** Cloudinary 무료
 * 티어는 1크레딧에 HD 250초라 영상이 크레딧을 가장 빨리 먹고, 우리가 영상
 * 서버를 겸할 이유가 없습니다(백엔드 `models.ShapeUpPost` 설명에 같은 내용이
 * 있습니다). 대신 유튜브 주소를 받아 여기서 세 가지를 뽑습니다.
 */

/** 주소에서 영상 id 를 뽑습니다. 유튜브가 아니거나 못 읽으면 빈 문자열. */
export function youtubeId(url: string | null | undefined): string {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  // youtu.be/<id> — 짧은 주소는 경로가 곧 id 입니다.
  if (host === "youtu.be") return parsed.pathname.slice(1).split("/")[0] ?? "";
  if (host !== "youtube.com" && host !== "m.youtube.com") return "";
  // youtube.com/watch?v=<id>
  const query = parsed.searchParams.get("v");
  if (query) return query;
  // youtube.com/embed/<id> · /shorts/<id> · /live/<id>
  const match = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
  return match ? match[1] : "";
}

/**
 * 화면에 끼워 넣을 주소.
 *
 * `youtube-nocookie.com` 을 쓰는 이유는, 보는 사람이 재생을 누르기 전까지
 * 유튜브가 추적 쿠키를 심지 않기 때문입니다. 공개 페이지라 로그인하지 않은
 * 방문자도 오고, 우리가 그들에게 남길 이유가 없는 흔적입니다.
 */
export function youtubeEmbed(url: string | null | undefined): string {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : "";
}

/**
 * 미리보기 그림 주소.
 *
 * **유튜브가 보내 주므로 우리 대역폭을 쓰지 않습니다.** 표지 사진을 따로 올리지
 * 않은 팀의 목록 카드를 이걸로 채웁니다. `hqdefault` 는 어느 영상에나 있고
 * (`maxresdefault` 는 없을 때가 있어 깨진 그림이 됩니다) 480×360 이라 카드에
 * 충분합니다.
 */
export function youtubeThumbnail(url: string | null | undefined): string {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}
