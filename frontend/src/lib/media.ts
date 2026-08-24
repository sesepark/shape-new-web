/**
 * Cloudinary serves whatever the upload produced unless the delivery URL asks
 * for otherwise, so a phone photo comes back as the original multi-megabyte
 * JPEG. Asking for `f_auto,q_auto` plus a width cap keeps the free delivery
 * quota intact and sends AVIF/WebP where the browser supports it.
 */
const UPLOAD_MARKER = "/image/upload/";

/** 옛 사이트에서 옮겨 와 우리 public 폴더가 그대로 들고 있는 사진. */
const LEGACY_PHOTOS = "https://www.snu-shape.com/figs/";

/**
 * 사진을 얼마나 아껴 보낼지.
 *
 * 크게 보이는 사진은 조금이라도 뭉개지면 바로 눈에 띄고, 작게 보이는 사진은
 * 많이 눌러도 알아채기 어렵습니다. 그래서 자리마다 다르게 씁니다.
 *
 *   high — 화면에서 크게 놓이는 사진(장비 상세, 소식 대표 사진).
 *   auto — 보통. Cloudinary 가 알아서 고릅니다.
 *   eco  — 이름 옆 작은 얼굴처럼 작게 놓이는 사진.
 */
export type MediaQuality = "high" | "auto" | "eco";

const QUALITY: Record<MediaQuality, string> = {
  high: "q_auto:good",
  auto: "q_auto",
  eco: "q_auto:eco",
};

/**
 * 정사각으로 잘라서 받아 옵니다.
 *
 * 장비 사진 자리는 1:1 인데 올라오는 사진은 대개 가로로 넓습니다. 지금까지는 넓은
 * 사진을 그대로 받아 **화면에서** 정사각으로 잘랐습니다. 그러면 받아 온 픽셀의
 * 절반 이상을 버리면서, 정작 세로는 모자라 늘려 그리게 됩니다(16:9 사진이면
 * 1.75배). 자를 곳을 Cloudinary 에 맡기면 필요한 크기가 그대로 오고, 버리는
 * 픽셀이 없으니 전송량도 줍니다. `g_auto` 는 사진에서 중요한 부분을 스스로
 * 찾아 그쪽을 남깁니다.
 */
export function mediaSquare(url: string | null | undefined, size: number, quality: MediaQuality = "high"): string {
  if (!url) return "";
  if (url.startsWith(LEGACY_PHOTOS)) return url.slice(LEGACY_PHOTOS.length - "/figs/".length);
  const marker = url.indexOf(UPLOAD_MARKER);
  if (!url.startsWith("https://res.cloudinary.com/") || marker === -1) return url;
  const head = url.slice(0, marker + UPLOAD_MARKER.length);
  const tail = url.slice(marker + UPLOAD_MARKER.length);
  if (/^[a-z]_[^/]*\//.test(tail)) return url;
  return `${head}f_auto,${QUALITY[quality]},c_fill,g_auto,w_${size},h_${size}/${tail}`;
}

export function media(url: string | null | undefined, width: number, quality: MediaQuality = "auto"): string {
  if (!url) return "";
  // 옛 사이트 주소로 저장된 부원 사진은 우리 public 폴더에 그대로 있는 파일이다.
  // 절대 주소로 두면 Next.js 이미지 최적화가 제 사이트에 다시 HTTP 요청을 보내
  // 원본을 받아 온다. 같은 파일을 상대 경로로 가리키면 디스크에서 바로 읽는다.
  if (url.startsWith(LEGACY_PHOTOS)) return url.slice(LEGACY_PHOTOS.length - "/figs/".length);
  const marker = url.indexOf(UPLOAD_MARKER);
  if (!url.startsWith("https://res.cloudinary.com/") || marker === -1) return url;
  const head = url.slice(0, marker + UPLOAD_MARKER.length);
  const tail = url.slice(marker + UPLOAD_MARKER.length);
  // A URL that already carries a transformation is left untouched.
  if (/^[a-z]_[^/]*\//.test(tail)) return url;
  return `${head}f_auto,${QUALITY[quality]},c_limit,w_${width}/${tail}`;
}

/**
 * Next.js 이미지 최적화에 맡겨도 되는 주소인지 알려 줍니다.
 *
 * Cloudinary 주소는 `media()` 가 이미 크기와 형식을 지정해 두었으니 그대로 두고,
 * 우리 폴더에 있는 원본 사진만 최적화를 거칩니다. 나머지를 최적화에 넘기면 안
 * 됩니다. `next.config.ts` 의 remotePatterns 에 없는 주소는 400 으로 막히는데,
 * 관리자는 어떤 주소든 붙여 넣을 수 있기 때문입니다.
 */
export function optimizable(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/") || url.startsWith(LEGACY_PHOTOS);
}
