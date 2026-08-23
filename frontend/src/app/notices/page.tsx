"use client";

import { AuthGate } from "@/components/auth-gate";
import { NoticeList } from "@/components/notice-list";
import { PageShell } from "@/components/page-shell";

export default function NoticesPage() { return <PageShell eyebrow="MEMBER BOARD" title="소식" contentTitle="게시판"><AuthGate>{() => <NoticeList />}</AuthGate></PageShell>; }
