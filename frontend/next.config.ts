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
    return [
      {
        source: "/models/:path*.glb",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
