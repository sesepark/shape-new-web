import { PageShell } from "@/components/page-shell";
import { ResourceLibrary } from "@/components/resource-library";

export const metadata = { title: "SHAPE 자료", description: "SHAPE 활동과 교육에 필요한 양식, 매뉴얼, 교육 자료를 내려받습니다." };

export default function ResourcesPage() {
  return (
    <PageShell eyebrow="SHAPE RESOURCES" title="바로가기" contentTitle="SHAPE 자료">
      <ResourceLibrary />
    </PageShell>
  );
}
