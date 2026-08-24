import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "SHAPE · SNU Physical AI Club", short_name: "SHAPE",
    description: "서울대학교 Physical AI 동아리 SHAPE", start_url: "/", scope: "/", display: "standalone", display_override: ["standalone", "minimal-ui"],
    background_color: "#ffffff", theme_color: "#ffffff", lang: "ko", orientation: "portrait-primary",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
