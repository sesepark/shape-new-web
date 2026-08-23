"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { groupForPath, isRouteActive } from "@/lib/navigation";

// 상세 페이지처럼 경로만으로는 어느 하위 탭 소속인지 알 수 없는 경우
// (예: 언론보도 기사는 /news/<id> 라 SHAPE 뉴스와 구분되지 않음)
// 페이지가 activeHref 로 직접 알려 줍니다.
export function SiteSubnav({ activeHref: override }: { activeHref?: string }) {
  const pathname = usePathname();
  const group = groupForPath(pathname);
  if (!group) return null;
  const activeHref =
    override ??
    [...group.children]
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => isRouteActive(pathname, item.href))?.href;
  return (
    <nav className="page-subnav" aria-label={`${group.label} 하위 메뉴`}>
      {group.children.map((item) => (
        <Link
          className={activeHref === item.href ? "active" : ""}
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
