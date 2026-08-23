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
  icons: {
    icon: [{ url: "/icon-192.png", type: "image/png" }],
    apple: "/icon-192.png",
  },
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
