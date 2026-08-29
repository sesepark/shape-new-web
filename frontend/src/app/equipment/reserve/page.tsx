import { Suspense } from "react";
import { EquipmentReservation } from "@/components/equipment-reservation";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";

export const metadata = { title: "장비 예약", description: "SHAPE 보유 장비의 예약 가능 시간을 확인하고 사용을 신청합니다." };
export default async function EquipmentReservePage() {
  const equipment = await listOrEmpty(api.equipment());
  return <PageShell eyebrow="EQUIPMENT RESERVATION" title="장비 예약" contentTitle="장비 예약">
    {/* Suspense 를 감싸는 이 상자가 필요합니다. `PageShell` 안의 `ScrollReveal` 은
        직속 자식마다 클래스와 인라인 스타일을 붙이는데, Suspense 안쪽은 바깥보다
        **늦게 하이드레이션**됩니다. 그래서 상자가 없으면 아직 React 가 넘겨받지
        않은 `.booking-app` 을 건드리게 되고, 곧이어 하이드레이션이 서버가 보낸
        `className` 과 어긋난 것을 발견해 경고를 냅니다(실제로 이 화면에서만
        났습니다). 상자는 바깥 트리에 속해 먼저 하이드레이션되므로 안전합니다.
        `ScrollReveal` 에도 같은 설명을 적어 두었습니다. */}
    <div className="booking-shell">
      <Suspense fallback={<p className="form-note">예약 화면을 준비하고 있습니다.</p>}><EquipmentReservation equipment={equipment} /></Suspense>
    </div>
  </PageShell>;
}
