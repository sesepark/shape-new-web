import { Suspense } from "react";
import { EquipmentReservation } from "@/components/equipment-reservation";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";
import { mockEquipment } from "@/lib/mock-data";

export const metadata = { title: "장비 예약", description: "SHAPE 보유 장비의 예약 가능 시간을 확인하고 사용을 신청합니다." };
export default async function EquipmentReservePage() {
  const equipment = await listOrEmpty(api.equipment(), mockEquipment);
  return <PageShell eyebrow="EQUIPMENT RESERVATION" title="장비 예약" contentTitle="장비 예약">
    <Suspense fallback={<p className="form-note">예약 화면을 준비하고 있습니다.</p>}><EquipmentReservation equipment={equipment} /></Suspense>
  </PageShell>;
}
