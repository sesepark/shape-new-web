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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    next: { revalidate: 300, tags: [path] },
  });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

/** 언론보도 분류 이름. 소식 탭은 이 분류를 빼고, 언론보도 탭은 이 분류만 부른다. */
export const PRESS_CATEGORY = "언론보도";

export const api = {
  page: (slug: string) => getJson<ContentPage>(`/pages/${slug}`),
  /**
   * 소식 목록. `exclude` 로 한 분류를 빼고 받을 수 있다. 소식 탭이 언론보도를
   * 빼고 부르는 데 쓴다. 화면에서 걸러내면 `limit` 만큼 받은 뒤 버리게 되어
   * 언론보도가 많아지는 만큼 소식이 목록에서 밀려 사라진다.
   */
  news: (category?: string, exclude?: string) =>
    getJson<NewsItem[]>(
      `/news?limit=50${category ? `&category=${encodeURIComponent(category)}` : ""}${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ""}`,
    ),
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

/**
 * 공개 목록을 읽어 온다. API 가 잠시 응답하지 않으면 빈 목록으로 그려서
 * 각 페이지의 안내용 빈 상태 화면이 뜨게 한다. 예시 데이터로 채우지 않는다.
 */
export async function listOrEmpty<T>(request: Promise<T[]>): Promise<T[]> {
  try {
    return await request;
  } catch {
    return [];
  }
}

export async function itemOrNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch {
    return null;
  }
}

export { API_URL };
