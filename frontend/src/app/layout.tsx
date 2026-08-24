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
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "SHAPE",
    title: "SHAPE | SNU Physical AI Club",
    description: "서울대학교 휴머노이드 및 Physical AI 동아리 SHAPE",
  },
  twitter: {
    card: "summary",
    title: "SHAPE | SNU Physical AI Club",
    description: "서울대학교 휴머노이드 및 Physical AI 동아리 SHAPE",
    images: ["/icon-512.png"],
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
