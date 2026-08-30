import type { MetadataRoute } from "next";
import { api } from "@/lib/api";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.snu-shape.com";

const staticRoutes = [
  "",
  "/about",
  "/greeting",
  "/organization",
  "/members",
  "/partners",
  "/contact",
  "/directions",
  "/equipment",
  "/equipment/reserve",
  "/news",
  "/news/press",
  "/shape-up",
  "/roadmap",
  "/roadmap/shape-up",
  "/roadmap/competition",
  "/roadmap/education",
  "/roadmap/etc",
  "/links",
  "/resources",
];

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Detail pages are the ones search engines can only reach through the sitemap,
  // so they are listed from the API and simply omitted when it is unavailable.
  const [news, equipment, shapeUp] = await Promise.all([
    api.news().catch(() => []),
    api.equipment().catch(() => []),
    api.shapeUp().catch(() => []),
  ]);
  return [
    ...staticRoutes.map((path) => ({
      url: `${base}${path}`,
      changeFrequency: (path === "/news" ? "daily" : "weekly") as "daily" | "weekly",
      priority: path === "" ? 1 : path === "/news" ? 0.8 : 0.7,
    })),
    ...news.map((item) => ({
      url: `${base}/news/${item.id}`,
      lastModified: new Date(item.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...equipment.map((item) => ({
      url: `${base}/equipment/${item.id}`,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...shapeUp.map((item) => ({
      url: `${base}/shape-up/${item.id}`,
      lastModified: new Date(item.createdAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
