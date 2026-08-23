"use client";

import { use } from "react";
import { AuthGate } from "@/components/auth-gate";
import { NoticeDetailView } from "@/components/notice-detail";
import { PageShell } from "@/components/page-shell";

export default function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PageShell eyebrow="MEMBER BOARD" title="소식" contentTitle="게시판">
      <AuthGate>{() => <NoticeDetailView noticeId={id} />}</AuthGate>
    </PageShell>
  );
}
