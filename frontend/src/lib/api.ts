import type {
  ContentPage,
  EquipmentAvailability,
  EquipmentItem,
  NewsDetail,
  MemberProfile,
  NewsItem,
  RelatedLink,
  RoadmapItem,
  ShapeUpDetail,
  ShapeUpItem,
} from "@/lib/types";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

/** Sample content stands in for a missing API locally, never on the live site. */
const isPreview = process.env.NODE_ENV !== "production";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    next: { revalidate: 300, tags: [path] },
  });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  page: (slug: string) => getJson<ContentPage>(`/pages/${slug}`),
  news: (category?: string) =>
    getJson<NewsItem[]>(`/news?limit=50${category ? `&category=${encodeURIComponent(category)}` : ""}`),
  newsDetail: (id: string) => getJson<NewsDetail>(`/news/${id}`),
  equipment: () => getJson<EquipmentItem[]>("/equipment"),
  roadmap: () => getJson<RoadmapItem[]>("/roadmap"),
  links: () => getJson<RelatedLink[]>("/links"),
  memberProfiles: () => getJson<MemberProfile[]>("/member-profiles"),
  shapeUp: () => getJson<ShapeUpItem[]>("/shape-up"),
  shapeUpDetail: (id: string) => getJson<ShapeUpDetail>(`/shape-up/${id}`),
  availability: (equipmentId: string, day: string) =>
    getJson<EquipmentAvailability>(
      `/equipment/${equipmentId}/availability?date=${encodeURIComponent(day)}`,
    ),
};

/** Resolve a public list, degrading to sample rows only during development. */
export async function listOrEmpty<T>(request: Promise<T[]>, preview: T[]): Promise<T[]> {
  try {
    return await request;
  } catch {
    return isPreview ? preview : [];
  }
}

export async function itemOrNull<T>(request: Promise<T>, preview: () => T | null): Promise<T | null> {
  try {
    return await request;
  } catch {
    return isPreview ? preview() : null;
  }
}

export { API_URL, isPreview };
