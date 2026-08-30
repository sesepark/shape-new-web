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
    // public/ 안의 파일은 기본값이 `max-age=0` 이라 화면을 넘길 때마다 다시
    // 받아 옵니다. 실제로 재방문에서도 부원 사진과 마스크 그림이 매번 다시
    // 나갔습니다. Vercel 무료 요금제에서 세는 것이 요청 수라 이 낭비가 그대로
    // 한도로 이어집니다. 내용이 바뀌지 않는 파일은 오래 잡아 둡니다.
    const forever = { key: "Cache-Control", value: "public, max-age=31536000, immutable" };
    // 부원 사진은 같은 이름으로 갈아 끼우는 일이 있으므로 하루만 잡고, 그 뒤로는
    // 일주일 동안 옛 사진을 보여 주면서 뒤에서 새로 받아 옵니다.
    const daily = { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" };
    return [
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
