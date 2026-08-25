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
 * 장비 사진을 정사각 칸에 **통째로** 담아 받아 옵니다.
 *
 * 장비 사진 자리는 1:1 인데 올라오는 제품 사진은 대개 가로로 넓습니다. 예전에는
 * `c_fill` 로 **잘라서** 맞췄는데, 그러면 넓은 사진에서 물건의 일부가 잘려 나갑니다
 * (로봇 손 사진에서 손가락이 화면 밖으로 잘려 나갔습니다). 사람 얼굴이라면 잘라도
 * 되지만 장비는 물건 전체가 보여야 무엇인지 알아볼 수 있습니다.
 *
 * 그래서 세 단계로 받습니다.
 *
 * 1. `e_trim:0` — 사진 가장자리의 빈 여백을 떼어 냅니다. 제품 사진은 배경이 비어
 *    있는 경우가 많은데, 그 여백이 얼마나 되는지가 사진마다 제각각이라 그대로 두면
 *    같은 칸에서도 어떤 장비는 크고 어떤 장비는 콩알만 하게 보입니다.
 *
 *    **`:0` 을 반드시 붙입니다.** 기본값(10)은 모서리 색과 '비슷한' 픽셀까지 떼어
 *    내는데, 흰 배경에 놓인 흰 로봇처럼 배경과 물건의 색이 가까우면 **사진 전체를
 *    떼어 내고** Cloudinary 가 400 을 돌려줍니다. 그러면 화면에서는 사진이 깨져
 *    보입니다 — 우리가 고치려던 바로 그 증상입니다. 실제로 시험해 확인했습니다.
 *    `:0` 은 모서리와 **똑같은** 색만 떼므로 지금 올라와 있는 사진 여덟 장의 결과가
 *    그대로이면서 그 실패는 일어나지 않습니다.
 * 2. `c_pad` 로 안쪽 칸(`INNER` 만큼)에 맞춰 담고,
 * 3. `c_lpad` 로 바깥 칸까지 **늘리지 않고** 여백만 채웁니다. `c_pad` 를 두 번 쓰면
 *    두 번째에서 다시 키워 버려 여백이 사라집니다.
 *
 * 결과적으로 어떤 사진이든 물건의 긴 변이 칸의 88% 를 차지합니다. 3D 모델에서 뽑아
 * `public/equipment/` 에 둔 그림들이 이미 그 비율이라, 올려 받은 사진도 같은 크기로
 * 보입니다.
 */
// 물건이 칸 가장자리에 닿지 않도록 남기는 안쪽 칸의 비율.
const INNER = 0.88;

export function mediaSquare(url: string | null | undefined, size: number, quality: MediaQuality = "high"): string {
  if (!url) return "";
  if (url.startsWith(LEGACY_PHOTOS)) return url.slice(LEGACY_PHOTOS.length - "/figs/".length);
  const marker = url.indexOf(UPLOAD_MARKER);
  if (!url.startsWith("https://res.cloudinary.com/") || marker === -1) return url;
  const head = url.slice(0, marker + UPLOAD_MARKER.length);
  const tail = url.slice(marker + UPLOAD_MARKER.length);
  if (/^[a-z]_[^/]*\//.test(tail)) return url;
  const inner = Math.round(size * INNER);
  // 배경은 투명하게 채웁니다. 흰색으로 채우면 카드의 옅은 바탕 위에 흰 네모가
  // 얹혀 보입니다.
  return `${head}e_trim:0/c_pad,b_transparent,w_${inner},h_${inner}/c_lpad,b_transparent,w_${size},h_${size},f_auto,${QUALITY[quality]}/${tail}`;
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
