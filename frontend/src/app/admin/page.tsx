import { AdminConsole } from "@/components/admin-console";
import { AdminAccess } from "@/components/admin-access";
import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "운영진 관리", robots: { index: false, follow: false } };
export default function AdminPage() {
  const preview = process.env.NODE_ENV !== "production";
  return <PageShell eyebrow="SHAPE ADMIN" title="운영진 관리" contentTitle="관리자 페이지" compact>
    {/* 관리자 콘솔은 지금 탭을 `?tab=` 에서 읽습니다(`useSearchParams`). 그것을
        쓰는 컴포넌트는 Suspense 안에 있어야 하고, 그 상자는 `ScrollReveal` 이
        건드리는 자리보다 안쪽이어야 합니다 — `equipment/reserve` 에서 겪은
        하이드레이션 어긋남과 같은 이유입니다(`scroll-reveal.tsx` 설명 참고). */}
    <div className="admin-shell">
      <Suspense fallback={<p className="form-note">관리자 화면을 준비하고 있습니다.</p>}>
        {preview ? <AdminConsole name="SHAPE 관리자" isOwner permissions={["development:preview"]} preview /> : <AdminAccess />}
      </Suspense>
    </div>
  </PageShell>;
}
