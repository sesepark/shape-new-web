"use client";

import { AuthGate } from "@/components/auth-gate";
import { PageShell } from "@/components/page-shell";
import { ReservationCalendarView } from "@/components/reservation-calendar";

export default function EquipmentStatusPage() {
  return (
    <PageShell eyebrow="EQUIPMENT STATUS" title="장비 예약" contentTitle="장비 예약 현황">
      <AuthGate>{() => <ReservationCalendarView />}</AuthGate>
    </PageShell>
  );
}
