import { ContactForm } from "@/components/contact-form";
import { PageShell } from "@/components/page-shell";

export const metadata = {
  title: "연락",
  description:
    "SHAPE 가입, 협업, 장비와 행사 관련 문의를 이메일로 보낼 수 있습니다.",
};

export default function ContactPage() {
  return (
    <PageShell eyebrow="CONTACT SHAPE" title="SHAPE" contentTitle="연락">
      <ContactForm />
    </PageShell>
  );
}
