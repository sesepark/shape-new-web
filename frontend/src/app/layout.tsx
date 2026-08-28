import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TopButton } from "@/components/top-button";
import { PwaRegister } from "@/components/pwa-register";
import { ReservationNow } from "@/components/reservation-now";
import "./globals.css";
import "./responsive-additions.css";
import "./feature-additions.css";
import "./header-fixes.css";
import "./site-polish.css";

/**
 * 글꼴을 사이트가 직접 실어 보냅니다.
 *
 * 예전에는 `font-family` 에 Pretendard·Apple SD Gothic Neo·Noto Sans KR 을
 * 늘어놓고 **보는 사람 컴퓨터에 그 글꼴이 깔려 있기를 기대**했습니다. 맥에는
 * Apple SD Gothic Neo 가 있어 의도대로 보였지만, 리눅스·윈도에는 저 목록에
 * 든 글꼴이 하나도 없어 Arial(리눅스에서는 Liberation Sans)로 떨어집니다.
 * 같은 글이 환경마다 다른 폭으로 그려지니, 여유가 십몇 픽셀뿐이던 칸은
 * 그대로 무너졌습니다. 홈의 로봇 전환 캡슐이 리눅스·파이어폭스에서 두 줄로
 * 접혀 있던 것이 그 예입니다.
 *
 * 글꼴 파일을 함께 배포하면 어느 환경에서든 글자 폭이 같아져, 이 부류의
 * 깨짐이 통째로 사라집니다. 가변 글꼴 한 벌(2MB)이라 요청은 한 번뿐이고,
 * Next 가 `/_next/static` 에 올려 1년짜리 캐시를 붙이므로 무료 티어에서
 * 세는 요청 수에도 부담이 없습니다. `display:"swap"` 이라 글꼴을 받는 동안
 * 글이 안 보이는 일은 없고, `adjustFontFallback` 이 그동안 쓰는 대체 글꼴의
 * 폭을 Pretendard 에 맞춰 줄여 놓아 글꼴이 바뀌는 순간의 들썩임도 작습니다.
 */
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  // Pretendard Variable 의 굵기 축은 45~920 입니다. 사이트가 쓰는 900 도 이 안에 듭니다.
  weight: "45 920",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
  fallback: ["Apple SD Gothic Neo", "Noto Sans KR", "Arial", "sans-serif"],
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: { default: "SHAPE | SNU Physical AI Club", template: "%s | SHAPE" },
  description: "서울대학교 휴머노이드 및 Physical AI 동아리 SHAPE",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.snu-shape.com",
  ),
  keywords: [
    "서울대학교",
    "SNU",
    "SHAPE",
    "Physical AI",
    "휴머노이드",
    "로보틱스",
    "학생 동아리",
  ],
  /**
   * 파비콘은 여기서 지정하지 않습니다.
   *
   * 예전에는 `icons` 로 `/icon-192.png` 만 가리켰는데, 브라우저·검색엔진·슬랙
   * 미리보기 중 상당수는 그 태그를 보기 전에 `/favicon.ico` 부터 찾습니다.
   * 그 자리에 아무것도 없으면 Vercel 이 자기 기본 아이콘을 대신 내주고,
   * 그래서 탭에 SHAPE 심볼 대신 Vercel 삼각형이 떴습니다.
   *
   * 그래서 Next 의 파일 규칙(`app/favicon.ico`, `app/icon.png`,
   * `app/apple-icon.png`)으로 옮겼습니다. 파일 규칙은 이 `metadata` 객체보다
   * 우선하므로 둘을 함께 두면 한쪽이 조용히 무시됩니다.
   */
  appleWebApp: { capable: true, title: "SHAPE", statusBarStyle: "default" },
  /**
   * 링크를 붙여 넣었을 때 뜨는 미리보기 그림은 여기서 지정하지 않습니다.
   *
   * 파비콘과 같은 이유로 Next 의 파일 규칙(`app/opengraph-image.png`)에 맡깁니다.
   * 파일 규칙은 이 `metadata` 객체보다 우선하므로, 여기에 `images` 를 함께 적으면
   * 한쪽이 조용히 무시됩니다. 그림은 1200×630 짜리 정적 PNG 라 배포될 때 파일
   * 하나로 나가고, 만들어 내는 데 드는 서버 시간이 없습니다.
   */
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "SHAPE",
    title: "SHAPE | SNU Physical AI Club",
    description: "서울대학교 휴머노이드 및 Physical AI 동아리 SHAPE",
  },
  /**
   * `images` 를 적지 않으면 X(트위터)·슬랙 같은 곳이 위의 `og:image` 를 그대로
   * 씁니다. 예전에는 여기에 `/icon-512.png` 를 적어 두었는데, 정사각 아이콘이라
   * 카드가 작은 네모로 나왔습니다. 가로로 넓은 카드를 쓰도록 바꿉니다.
   */
  twitter: {
    card: "summary_large_image",
    title: "SHAPE | SNU Physical AI Club",
    description: "서울대학교 휴머노이드 및 Physical AI 동아리 SHAPE",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" className={pretendard.variable}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <TopButton />
        <ReservationNow />
        <PwaRegister />
      </body>
    </html>
  );
}
