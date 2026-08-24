import { GoogleLoginButton } from "@/components/google-login-button";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "로그인", robots: { index: false } };

export default function LoginPage() {
  return (
    <PageShell eyebrow="MEMBER ACCESS" title="SHAPE 로그인">
      <div className="empty-state">
        <h2>Google 계정으로 시작하세요</h2>
        <p>처음 로그인한 계정은 가입 승인 대기 상태로 등록됩니다.</p>
        <GoogleLoginButton />
      </div>
    </PageShell>
  );
}
