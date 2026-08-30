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

/**
 * 공개 데이터를 서버에서 얼마나 오래 들고 있을지.
 *
 * 5분이었는데 그 5분이 두 군데서 값을 치르고 있었습니다. 하나는 Neon 으로,
 * 무료 티어 compute 는 5분만 놀면 잠드는데 재검증 주기가 정확히 5분이라
 * 방문이 이어지는 내내 데이터베이스가 깨어 있었습니다(베타 다섯 명으로 이미
 * 전체 시간의 33%). 다른 하나는 Vercel 로, 재검증 한 번이 곧 서버 렌더링
 * 한 번이고 무료 요금제의 Active CPU 는 월 4시간뿐입니다.
 *
 * 그런데 이 타이머가 사 주는 것이 없습니다. 운영진이 저장하면 백엔드가
 * `/api/revalidate` 를 불러 그 자리에서 새로 고치기 때문입니다(회원이 올리는
 * SHAPE UP 과 부원 카드 연결까지 모두 이 길을 지납니다). 타이머는 관리자
 * 화면을 거치지 않고 바뀐 경우의 예비 장치일 뿐이라 한 시간이면 충분합니다.
 *
 * 백엔드의 `public_cache_seconds` 와 같은 값으로 두세요. 두 창이 어긋나면
 * 데이터베이스를 깨우는 시점이 흩어져서 얻는 것이 줄어듭니다.
 */
const PUBLIC_REVALIDATE_SECONDS = 3600;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [path] },
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
  shapeUp: (before?: string) =>
    getJson<ShapeUpItem[]>(`/shape-up${before ? `?before=${encodeURIComponent(before)}` : ""}`),
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


/** 서버가 한 쪽에 담아 주는 SHAPE-UP 결과물 수. 백엔드 `SHAPE_UP_PAGE` 와 같아야 합니다. */
const SHAPE_UP_PAGE = 60;
/**
 * 몇 쪽까지 이어 받을지. 60 × 5 = 300편이면 학기당 열 편으로 열다섯 해입니다.
 *
 * 상한을 두는 이유는 창구가 이상하게 답할 때 무한히 도는 것을 막기 위해서입니다.
 */
const SHAPE_UP_MAX_PAGES = 5;

/**
 * SHAPE-UP 결과물 **전부**.
 *
 * 창구는 한 번에 60편까지만 주는데 목록 화면은 이어받기를 쓰지 않고 있었습니다.
 * 학기당 열 편이면 **3년째에 옛 결과물이 목록에서 소리 없이 사라집니다** —
 * "다음 기수의 자산으로 축적한다"는 목적이 정확히 그 시점에 깨집니다.
 *
 * 화면이 아니라 여기서 이어받는 이유는, 목록이 서버에서 그려져야 검색 엔진이
 * 지난 기수의 결과물까지 읽어 가기 때문입니다. 한 시간에 한 번 도는 재검증
 * 때만 부르므로 쪽이 몇 개든 값이 거의 들지 않습니다.
 */
export async function allShapeUp(): Promise<ShapeUpItem[]> {
  const out: ShapeUpItem[] = [];
  let before: string | undefined;
  for (let page = 0; page < SHAPE_UP_MAX_PAGES; page += 1) {
    const rows = await listOrEmpty(api.shapeUp(before));
    out.push(...rows);
    if (rows.length < SHAPE_UP_PAGE) break;
    before = rows[rows.length - 1]?.createdAt;
    if (!before) break;
  }
  return out;
}
