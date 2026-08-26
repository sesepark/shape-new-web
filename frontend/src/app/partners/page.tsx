import { PartnerCards } from "@/components/partner-cards";
import { PageShell } from "@/components/page-shell";

export const metadata = {
  title: "협력기관",
  description:
    "서울대학교 SHAPE와 함께 연구하고 활동하는 협력기관을 소개합니다.",
};

export default function PartnersPage() {
  return (
    <PageShell eyebrow="PARTNERS" title="SHAPE" contentTitle="협력기관">
      <PartnerCards />
    </PageShell>
  );
}
