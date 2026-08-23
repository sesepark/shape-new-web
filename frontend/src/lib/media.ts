/**
 * Cloudinary serves whatever the upload produced unless the delivery URL asks
 * for otherwise, so a phone photo comes back as the original multi-megabyte
 * JPEG. Asking for `f_auto,q_auto` plus a width cap keeps the free delivery
 * quota intact and sends AVIF/WebP where the browser supports it.
 */
const UPLOAD_MARKER = "/image/upload/";

export function media(url: string | null | undefined, width: number): string {
  if (!url) return "";
  const marker = url.indexOf(UPLOAD_MARKER);
  if (!url.startsWith("https://res.cloudinary.com/") || marker === -1) return url;
  const head = url.slice(0, marker + UPLOAD_MARKER.length);
  const tail = url.slice(marker + UPLOAD_MARKER.length);
  // A URL that already carries a transformation is left untouched.
  if (/^[a-z]_[^/]*\//.test(tail)) return url;
  return `${head}f_auto,q_auto,c_limit,w_${width}/${tail}`;
}

/**
 * Cloudinary 주소는 `media()` 가 이미 크기와 형식을 지정해 두므로 Next.js 가
 * 다시 손댈 필요가 없습니다. 그 밖의 주소(옛 사이트에서 옮겨 온 부원 사진 등)는
 * 원본 그대로 내려가므로 Next.js 이미지 최적화를 거치게 둡니다.
 */
export function preTransformed(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith("https://res.cloudinary.com/"));
}
