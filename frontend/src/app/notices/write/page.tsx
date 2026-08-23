"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { NoticeEditor } from "@/components/notice-editor";
import { PageShell } from "@/components/page-shell";

export default function NoticeWritePage() {
  return (
    <PageShell eyebrow="MEMBER BOARD" title="소식" contentTitle="글쓰기">
      <AuthGate>
        {(session) => (
          <Suspense fallback={<p className="form-note">글쓰기 화면을 준비하고 있습니다.</p>}>
            <NoticeEditor session={session} />
          </Suspense>
        )}
      </AuthGate>
    </PageShell>
  );
}
