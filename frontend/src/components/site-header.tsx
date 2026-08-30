"use client";

import Link from "next/link";
import { HoverPrefetchLink } from "@/components/hover-prefetch-link";
import { ArrowUpRight, LogOut, Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { ScrollingName } from "@/components/scrolling-name";
import { ShapeSymbol } from "@/components/shape-symbol";
import { groupForPath, navigation } from "@/lib/navigation";
import { useUnreadCount } from "@/lib/notifications";
import { canManage, endSession, useSession } from "@/lib/session";

/**
 * 머리글과 전체 메뉴에는 사이트의 거의 모든 주소가 들어 있습니다. Next.js 는
 * 화면에 들어온 링크를 미리 받아 두는데, 그러면 한 쪽을 열 때마다 마흔 건 넘는
 * 요청이 나갑니다. 전체 메뉴는 열기 전까지 보이지도 않고, 드롭다운 하위 항목은
 * 마우스를 올려야 나옵니다. 둘 다 미리 받기를 끄면 그때 가서 받으므로 체감
 * 속도는 그대로이고 무료 요금제의 요청 수만 줄어듭니다.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dropdown, setDropdown] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const activeGroup = groupForPath(pathname);
  const { session, setSession } = useSession();
  // 안 읽은 알림이 있으면 계정 칩에 점을 띄웁니다. 예약 확정·반려·사진 요청이
  // 전부 알림으로 가는데, 그동안 그 수는 마이페이지 안쪽에서만 보였습니다.
  const unread = useUnreadCount(session);
  const router = useRouter();

  async function signOut() {
    await endSession();
    setSession(null);
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 18);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
        <div className="header-inner">
          <Link href="/" className="brand" aria-label="SHAPE 홈">
            <ShapeSymbol className="brand-symbol" />
          </Link>
          <nav className="desktop-nav" aria-label="주요 메뉴">
            {navigation.map((item) => (
              <div
                className={`nav-item${activeGroup?.label === item.label ? " active" : ""}`}
                key={item.label}
                onMouseEnter={() => setDropdown(item.label)}
                onMouseLeave={() => setDropdown(null)}
              >
                <HoverPrefetchLink href={item.href} onClick={(event) => { event.currentTarget.blur(); setDropdown(null); }}>
                  <span className="nav-label" aria-label={item.label}>
                    <span className="nav-label-current">{item.label}</span>
                    <span className="nav-label-next" aria-hidden="true">{item.label}</span>
                  </span>
                </HoverPrefetchLink>
                <div className={`nav-dropdown${dropdown === item.label ? " open" : ""}`}>
                  {/* 하위 항목은 차례로 하나씩 내려옵니다. 그 차례를 CSS 로 넘기는
                      이유는, 예전에 CSS 가 :nth-child(1)~(6) 을 하나하나 적어 두고
                      있었기 때문입니다. SHAPE 탭에 일곱 번째 항목(협력기관)이
                      생기자 그 하나만 지연 없이 튀어나왔습니다. 차례를 값으로
                      넘기면 항목이 몇 개가 되든 CSS 를 다시 손대지 않아도 됩니다
                      (components/scroll-reveal.tsx 의 --scroll-order 와 같은 방식). */}
                  {item.children.map((child, order) => (
                    <HoverPrefetchLink
                      href={child.href}
                      key={child.href}
                      style={{ "--nav-order": order } as CSSProperties}
                      onClick={(event) => { event.currentTarget.blur(); setDropdown(null); }}
                    >
                      {child.label}
                    </HoverPrefetchLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="header-actions">
            <HoverPrefetchLink className="account-link" href={session ? "/mypage" : "/login"}>
              {session ? <ScrollingName name={session.name} className="account-name" /> : <span className="account-name">로그인</span>}
              {unread > 0 && (
                <span className="account-unread" aria-label={`안 읽은 알림 ${unread}건`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
              <ArrowUpRight size={14} />
            </HoverPrefetchLink>
            {session && (
              <button className="account-logout" type="button" onClick={signOut}>
                <LogOut size={16} />
                <span>로그아웃</span>
              </button>
            )}
            <button
              className="menu-button"
              onClick={() => setOpen(true)}
              aria-label="전체 메뉴 열기"
              aria-expanded={open}
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>
      <div className={`all-menu${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="all-menu-head">
          <Link
            href="/"
            className="all-menu-brand"
            aria-label="SHAPE 홈"
           
            onClick={() => setOpen(false)}
          >
            <ShapeSymbol className="all-menu-symbol" />
          </Link>
          <button onClick={() => setOpen(false)} aria-label="전체 메뉴 닫기">
            <X size={42} />
          </button>
        </div>
        <nav className="all-menu-nav" aria-label="전체 메뉴">
          {navigation.map((item, index) => (
            <section className="all-menu-group" key={item.label}>
              <div>
                <span>0{index + 1}</span>
                <HoverPrefetchLink href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </HoverPrefetchLink>
              </div>
              <p>
                {item.children.map((child) => (
                  <HoverPrefetchLink
                    href={child.href}
                    key={child.href}
                    onClick={() => setOpen(false)}
                  >
                    {child.label}
                  </HoverPrefetchLink>
                ))}
              </p>
            </section>
          ))}
          <section className="all-menu-utilities">
            <HoverPrefetchLink href={session ? "/mypage" : "/login"} onClick={() => setOpen(false)}>
              {session ? "마이페이지" : "로그인"}
              {unread > 0 && <span className="account-unread">{unread > 99 ? "99+" : unread}</span>}
            </HoverPrefetchLink>
            {canManage(session) && (
              <HoverPrefetchLink href="/admin" onClick={() => setOpen(false)}>
                운영진 관리
              </HoverPrefetchLink>
            )}
            {session && (
              <button type="button" onClick={signOut}>
                로그아웃
              </button>
            )}
          </section>
        </nav>
        <div className="all-menu-wave wave-a" />
        <div className="all-menu-wave wave-b" />
      </div>
    </>
  );
}
