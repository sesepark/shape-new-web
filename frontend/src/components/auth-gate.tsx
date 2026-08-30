"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, Mail } from "lucide-react";
import { endSession, useSession } from "@/lib/session";
import type { SessionUser } from "@/lib/types";

const previewSession: SessionUser = { id: "preview", status: "APPROVED", isOwner: false, permissions: [], licenses: [], name: "SHAPE 데모 회원", email: "demo@snu-shape.com" };

/**
 * 가입 승인을 기다리는 사람에게 보여 주는 화면.
 *
 * 구글 로그인을 마친 **새 부원이 처음 만나는 화면**입니다. 곧 백 명 가까이가
 * 이 문을 지납니다. 그런데 예전에는 "가입 승인 대기 중입니다" 와 "승인 후
 * 사용할 수 있습니다" 두 줄이 전부였습니다. 얼마나 걸리는지, 누가 승인하는지,
 * 안 되면 어디로 연락하는지, 그동안 뭘 보면 되는지가 한 글자도 없는 막다른
 * 길이었습니다.
 *
 * **어느 계정으로 들어왔는지도 여기서 보여 줍니다.** 학교 메일 대신 개인 구글
 * 계정으로 로그인하는 것이 가장 흔한 가입 사고인데, 좁은 화면에서는 머리글의
 * 계정 이름이 보이지 않아 본인이 무엇을 잘못했는지 알 방법이 없었습니다.
 * 여기서 메일 주소를 그대로 보여 주고, 다른 계정으로 다시 들어갈 길을 둡니다.
 */
function WaitingForApproval({ session, onSignOut }: { session: SessionUser; onSignOut: () => void }) {
  return (
    <div className="empty-state approval-wait">
      <Clock3 size={30} aria-hidden="true" />
      <h2>가입 신청을 받았습니다</h2>
      <p>
        운영진이 확인하고 승인하면 예약·게시판·마이페이지를 쓸 수 있습니다.
        보통 <b>며칠 안</b>에 처리되고, 승인되면 이 화면이 저절로 바뀝니다.
      </p>
      {/* 어느 계정으로 들어왔는지. 이것이 없어서 잘못된 계정으로 로그인한 사람이
          영문도 모르고 기다리는 일이 생겼습니다. */}
      <div className="approval-account">
        <span className="account-initial">{session.name.slice(0, 1)}</span>
        <div>
          <strong>{session.name}</strong>
          <span>{session.email}</span>
        </div>
      </div>
      <p className="field-hint">
        <b>이 계정이 맞나요?</b> 학교 메일이 아니라 개인 구글 계정으로 들어오셨다면,
        운영진이 명단에서 찾지 못해 승인이 늦어집니다.
      </p>
      <div className="approval-actions">
        <button type="button" className="button secondary small" onClick={onSignOut}>
          다른 계정으로 로그인
        </button>
        <a className="button secondary small" href="mailto:contact@example.com?subject=%EA%B0%80%EC%9E%85%20%EC%8A%B9%EC%9D%B8%20%EB%AC%B8%EC%9D%98">
          <Mail size={15} aria-hidden="true" /> 승인 문의
        </a>
      </div>
      {/* 기다리는 동안 할 수 있는 것. 막다른 길로 두지 않습니다. */}
      <p className="approval-meanwhile">
        기다리는 동안 <Link href="/about">동아리 소개</Link> · <Link href="/equipment">보유 장비</Link> ·{" "}
        <Link href="/news">소식</Link> 은 지금 바로 보실 수 있습니다.
      </p>
    </div>
  );
}

export function AuthGate({ children, admin = false, localPreview = false }: { children: (session: SessionUser) => React.ReactNode; admin?: boolean; localPreview?: boolean }) {
  const { session, setSession } = useSession();
  const router = useRouter();

  /** 머리글의 로그아웃과 같은 방식입니다. 세션 기억을 비우고 로그인으로 보냅니다. */
  async function signOut() {
    await endSession();
    setSession(null);
    router.push("/login");
    router.refresh();
  }

  if (session === undefined) return <div className="empty-state"><p>회원 정보를 확인하고 있습니다.</p></div>;
  if (!session && localPreview && process.env.NODE_ENV !== "production") return <>{children(previewSession)}</>;
  if (!session) return <div className="empty-state"><h2>로그인이 필요합니다</h2><p>Google 계정으로 로그인한 뒤 회원 가입을 신청해 주세요.</p><Link className="button google-login" href="/login">Google 로그인</Link></div>;
  // 보기 전용 회원도 회원 화면에 들어옵니다. 무엇을 못 하는지는 각 화면이
  // 자기 자리에서 알려 주고, 서버도 쓰기 창구를 따로 막습니다.
  if (session.status !== "APPROVED" && session.status !== "VIEWER") {
    if (session.status === "PENDING") return <WaitingForApproval session={session} onSignOut={signOut} />;
    return (
      <div className="empty-state">
        <h2>지금은 이용할 수 없는 계정입니다</h2>
        <p>
          가입이 반려되었거나 이용이 중지된 상태입니다. 잘못된 것 같으면
          운영진에게 알려 주세요.
        </p>
        <p className="field-hint">{session.email}</p>
        <a className="button secondary" href="mailto:contact@example.com?subject=%EA%B3%84%EC%A0%95%20%EB%AC%B8%EC%9D%98">
          <Mail size={15} aria-hidden="true" /> 운영진에게 문의
        </a>
      </div>
    );
  }
  if (admin && !session.isOwner && session.permissions.length === 0) return <div className="empty-state"><h2>관리 권한이 없습니다</h2><p>운영진에게 필요한 기능 권한을 요청해 주세요.</p></div>;
  return <>{children(session)}</>;
}
