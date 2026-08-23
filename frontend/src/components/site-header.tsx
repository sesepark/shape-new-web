"use client";

import Link from "next/link";
import { ArrowUpRight, LogOut, Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShapeSymbol } from "@/components/shape-symbol";
import { groupForPath, navigation } from "@/lib/navigation";
import { canManage, endSession, useSession } from "@/lib/session";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dropdown, setDropdown] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const activeGroup = groupForPath(pathname);
  const { session, setSession } = useSession();
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
                <Link href={item.href} onClick={(event) => { event.currentTarget.blur(); setDropdown(null); }}>
                  <span className="nav-label" aria-label={item.label}>
                    <span className="nav-label-current">{item.label}</span>
                    <span className="nav-label-next" aria-hidden="true">{item.label}</span>
                  </span>
                </Link>
                <div className={`nav-dropdown${dropdown === item.label ? " open" : ""}`}>
                  {item.children.map((child) => (
                    <Link href={child.href} key={child.href} onClick={(event) => { event.currentTarget.blur(); setDropdown(null); }}>
                      {child.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="account-link" href={session ? "/mypage" : "/login"}>
              <span>{session ? session.name : "로그인"}</span>
              <ArrowUpRight size={14} />
            </Link>
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
                <Link href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              </div>
              <p>
                {item.children.map((child) => (
                  <Link
                    href={child.href}
                    key={child.href}
                    onClick={() => setOpen(false)}
                  >
                    {child.label}
                  </Link>
                ))}
              </p>
            </section>
          ))}
          <section className="all-menu-utilities">
            <Link href={session ? "/mypage" : "/login"} onClick={() => setOpen(false)}>
              {session ? "마이페이지" : "로그인"}
            </Link>
            {canManage(session) && (
              <Link href="/admin" onClick={() => setOpen(false)}>
                운영진 관리
              </Link>
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
