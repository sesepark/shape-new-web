import { GoogleLoginButton } from "@/components/google-login-button";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "로그인", robots: { index: false } };

/** 로그인이 어긋났을 때 무엇을 하면 되는지 한 줄로 알려 줍니다. */
const REASONS: Record<string, string> = {
  oauth: "구글 로그인이 끝나지 않았습니다. 다시 시도해 주세요.",
  state: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  access_denied: "구글 계정 화면에서 취소되었습니다.",
  redirect_uri_mismatch: "로그인 주소 설정이 어긋났습니다. 운영진에게 알려 주세요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <PageShell eyebrow="MEMBER ACCESS" title="SHAPE 로그인">
      <div className="empty-state">
        <h2>Google 계정으로 시작하세요</h2>
        <p>처음 로그인한 계정은 가입 승인 대기 상태로 등록됩니다.</p>
        {error && <p className="save-notice danger">{REASONS[error] ?? "로그인에 실패했습니다. 다시 시도해 주세요."}</p>}
        <GoogleLoginButton />
      </div>
    </PageShell>
  );
}
