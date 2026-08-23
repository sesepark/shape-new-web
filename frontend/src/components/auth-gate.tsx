"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import type { SessionUser } from "@/lib/types";

const previewSession: SessionUser = { id: "preview", status: "APPROVED", isOwner: false, permissions: [], licenses: [], name: "SHAPE 데모 회원", email: "demo@snu-shape.com" };

export function AuthGate({ children, admin = false, localPreview = false }: { children: (session: SessionUser) => React.ReactNode; admin?: boolean; localPreview?: boolean }) {
  const { session } = useSession();
  if (session === undefined) return <div className="empty-state"><p>회원 정보를 확인하고 있습니다.</p></div>;
  if (!session && localPreview && process.env.NODE_ENV !== "production") return <>{children(previewSession)}</>;
  if (!session) return <div className="empty-state"><h2>로그인이 필요합니다</h2><p>Google 계정으로 로그인한 뒤 회원 가입을 신청해 주세요.</p><Link className="button" href="/login">Google 로그인</Link></div>;
  if (session.status !== "APPROVED") return <div className="empty-state"><h2>{session.status === "PENDING" ? "가입 승인 대기 중입니다" : "현재 이용할 수 없습니다"}</h2><p>승인 후 예약, 공지, 마이페이지 기능을 사용할 수 있습니다.</p></div>;
  if (admin && !session.isOwner && session.permissions.length === 0) return <div className="empty-state"><h2>관리 권한이 없습니다</h2><p>운영진에게 필요한 기능 권한을 요청해 주세요.</p></div>;
  return <>{children(session)}</>;
}
