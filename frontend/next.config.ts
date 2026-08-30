import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 최적화한 사진을 얼마나 오래 들고 있을지. 기본값(4시간)이면 같은 사진을
    // 하루에도 몇 번씩 다시 변환한다. Vercel 무료 요금제에서 세는 것은 전송량이
    // 아니라 변환 횟수(월 5,000회)이므로 이 값이 그대로 한도로 이어진다.
    // 부원 사진은 파일 이름이 곧 신원이라 내용이 바뀌지 않고, Cloudinary 주소는
    // 업로드마다 판 번호(v1787…)가 붙어 주소 자체가 달라진다. 둘 다 오래 잡아
    // 두어도 옛 사진이 남을 일이 없다.
    minimumCacheTTL: 31_536_000,
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      {
        protocol: "https",
        hostname: "www.snu-shape.com",
        pathname: "/figs/**",
      },
    ],
  },
  async headers() {
    /**
     * 사이트 전체에 붙는 안전 머리말.
     *
     * 지금까지 이 사이트가 브라우저에게 준 지시는 Vercel 이 붙여 주는 HSTS 하나뿐
     * 이었습니다. 그래서 **아무나 자기 페이지 안에 우리 사이트를 액자처럼 끼워
     * 넣을 수 있었습니다.** 그 위에 투명한 단추를 겹쳐 놓으면, 로그인한 부원이
     * 남의 페이지에서 무심코 누른 것이 우리 화면의 '삭제' 나 '승인' 이 됩니다.
     * 관리자 화면과 마이페이지가 그대로 열려 있는 셈이라 값이 큽니다.
     *
     * CSP 는 **깨질 걱정 없이 실제로 값을 하는 만큼만** 겁니다.
     *
     * `script-src` 에 `'unsafe-inline'` 이 들어 있는 것은 Next.js 가 페이지마다
     * 인라인 부트스트랩 조각을 넣기 때문입니다. 그것을 없애려면 요청마다 nonce 를
     * 새로 만들어야 하고, 그러면 **모든 페이지가 정적 캐시에서 빠져나와** 매 방문이
     * 서버 렌더링이 됩니다. 무료 요금제의 Active CPU 는 월 4시간이라 그 값을 치를
     * 수 없습니다. 대신 본문 HTML 은 저장할 때 백엔드가 걸러 내고
     * (`services/content.py` 의 bleach), 아래 나머지 지시가 새는 길을 막습니다.
     *
     *   frame-ancestors  남의 페이지에 우리 화면을 끼워 넣지 못하게 (클릭재킹)
     *   base-uri         `<base>` 를 심어 상대 주소를 통째로 남의 서버로 돌리는 것
     *   form-action      폼 제출이 바깥으로 나가는 것
     *   object-src       플러그인 자리로 임의의 것을 끼우는 것
     *   connect-src      스크립트가 우리 API 와 Cloudinary 말고 다른 데로 보내는 것
     *   frame-src        소식에 붙는 영상 임베드만 허용
     *
     * `img-src` 는 `https:` 로 넓게 둡니다. 관리자가 바깥 사진 주소를 그대로 붙여
     * 넣을 수 있고(`lib/media.ts` 의 `optimizable` 설명), 사진은 스크립트가 아니라
     * 위험이 작기 때문입니다.
     */
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
    const apiOrigin = (() => { try { return new URL(api).origin; } catch { return "http://localhost:8000"; } })();
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' blob: https://res.cloudinary.com",
      `connect-src 'self' ${apiOrigin} https://api.cloudinary.com`,
      // 오시는 길의 지도(www.google.com/maps/embed)와 소식에 붙는 영상 임베드.
      "frame-src 'self' https://www.google.com https://www.youtube.com https://www.youtube-nocookie.com https://www.instagram.com https://player.vimeo.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      // 로컬 개발은 백엔드가 http 라서 이 지시를 켜면 요청이 https 로 바뀌어 막힙니다.
      ...(apiOrigin.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    const safety = [
      { key: "Content-Security-Policy", value: csp },
      // frame-ancestors 를 모르는 옛 브라우저를 위한 같은 뜻의 머리말.
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // 우리가 쓰지 않는 장치 권한은 아예 닫아 둡니다.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    ];
    // public/ 안의 파일은 기본값이 `max-age=0` 이라 화면을 넘길 때마다 다시
    // 받아 옵니다. 실제로 재방문에서도 부원 사진과 마스크 그림이 매번 다시
    // 나갔습니다. Vercel 무료 요금제에서 세는 것이 요청 수라 이 낭비가 그대로
    // 한도로 이어집니다. 내용이 바뀌지 않는 파일은 오래 잡아 둡니다.
    const forever = { key: "Cache-Control", value: "public, max-age=31536000, immutable" };
    // 부원 사진은 같은 이름으로 갈아 끼우는 일이 있으므로 하루만 잡고, 그 뒤로는
    // 일주일 동안 옛 사진을 보여 주면서 뒤에서 새로 받아 옵니다.
    const daily = { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" };
    return [
      { source: "/:path*", headers: safety },
      // 글꼴 조각은 폴더 이름에 판 번호가 들어 있어 내용이 바뀔 일이 없습니다.
      // `src/app/fonts.css` 머리말에 판을 올리는 법을 적어 두었습니다.
      { source: "/fonts/:path*", headers: [forever] },
      { source: "/models/:path*.glb", headers: [forever] },
      { source: "/ai-worker-outline.png", headers: [forever] },
      { source: "/shape-symbol.:ext(png|svg)", headers: [forever] },
      { source: "/icon-:size.png", headers: [forever] },
      { source: "/figs/:path*", headers: [daily] },
      { source: "/equipment/:path*", headers: [daily] },
    ];
  },
};

export default nextConfig;
