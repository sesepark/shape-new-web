import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots { const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.snu-shape.com"; return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/mypage", "/notices", "/login", "/equipment/status"] }], sitemap: `${base}/sitemap.xml` }; }

