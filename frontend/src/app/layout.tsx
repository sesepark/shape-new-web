import type { Metadata } from "next";
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
    <html lang="ko" data-scroll-behavior="smooth">
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
