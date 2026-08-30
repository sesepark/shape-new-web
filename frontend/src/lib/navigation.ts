export type NavigationItem = {
  label: string;
  href: string;
  paths: string[];
  children: readonly { label: string; href: string }[];
};

export const navigation: readonly NavigationItem[] = [
  {
    label: "SHAPE",
    href: "/about",
    paths: [
      "/about",
      "/greeting",
      "/organization",
      "/members",
      "/partners",
      "/contact",
      "/directions",
    ],
    children: [
      { label: "동아리 소개", href: "/about" },
      { label: "인사말", href: "/greeting" },
      { label: "조직도", href: "/organization" },
      { label: "부원", href: "/members" },
      { label: "협력기관", href: "/partners" },
      { label: "연락", href: "/contact" },
      { label: "오시는 길", href: "/directions" },
    ],
  },
  {
    label: "장비 예약",
    href: "/equipment",
    paths: ["/equipment"],
    children: [
      { label: "보유 장비", href: "/equipment" },
      { label: "장비 예약", href: "/equipment/reserve" },
      { label: "장비 예약 현황", href: "/equipment/status" },
    ],
  },
  {
    label: "소식",
    href: "/news",
    paths: ["/news", "/notices", "/shape-up"],
    children: [
      { label: "SHAPE 뉴스", href: "/news" },
      { label: "언론보도", href: "/news/press" },
      { label: "SHAPE-UP", href: "/shape-up" },
      { label: "게시판", href: "/notices" },
    ],
  },
  {
    label: "로드맵",
    href: "/roadmap",
    paths: ["/roadmap"],
    children: [
      { label: "전체 로드맵", href: "/roadmap" },
      { label: "SHAPE-UP", href: "/roadmap/shape-up" },
      { label: "대회", href: "/roadmap/competition" },
      { label: "교육", href: "/roadmap/education" },
      { label: "기타", href: "/roadmap/etc" },
    ],
  },
  {
    label: "바로가기",
    href: "/links",
    paths: ["/links", "/resources"],
    children: [
      { label: "관련 링크", href: "/links" },
      { label: "SHAPE 자료", href: "/resources" },
    ],
  },
] as const;

export function groupForPath(pathname: string) {
  return navigation.find((group) =>
    group.paths.some((path) =>
      path === "/" ? pathname === "/" : pathname.startsWith(path),
    ),
  );
}

export function isRouteActive(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}
