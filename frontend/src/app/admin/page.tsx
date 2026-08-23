import { AdminConsole } from "@/components/admin-console";
import { AdminAccess } from "@/components/admin-access";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "운영진 관리", robots: { index: false, follow: false } };
export default function AdminPage() {
  const preview = process.env.NODE_ENV !== "production";
  return <PageShell eyebrow="SHAPE ADMIN" title="운영진 관리" contentTitle="관리자 페이지">
    {preview ? <AdminConsole name="SHAPE 관리자" isOwner permissions={["development:preview"]} preview /> : <AdminAccess />}
  </PageShell>;
}
