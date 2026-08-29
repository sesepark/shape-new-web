"use client";

import { AdminBlackouts } from "@/components/admin-blackouts";
import { AdminRecurring } from "@/components/admin-recurring";
import { AdminReservationPolicy } from "@/components/admin-reservation-policy";

/**
 * 운영진이 **직접 잡고 막고 정하는** 것들만 모은 탭.
 *
 * 예약 심사 화면(‘장비예약 관리’)과 나눈 이유가 둘 있습니다.
 *
 * 첫째, 성격이 다릅니다. 심사는 부원이 올린 것을 보고 고르는 **매일 하는 일**
 * 이고, 여기 있는 셋은 학기에 몇 번 정하는 일입니다. 한 화면에 섞어 두면 매일
 * 보는 목록이 설정에 밀립니다.
 *
 * 둘째, 정기 예약이 실제로 묻혀 있었습니다. 예약 심사 화면 맨 아래에 접힌 채
 * 있어서 눌러야 나왔고, 학기 일정을 잡으러 온 사람은 그 기능이 있는 줄도
 * 몰랐습니다. 여기서는 셋 모두 펼쳐 둡니다.
 *
 * 순서는 쓰는 빈도를 따릅니다 — 정기 예약(학기 초), 사용 제한(수시), 예약
 * 정책(거의 손대지 않음).
 */
export function AdminEquipmentReservation() {
  return (
    <div className="admin-form admin-equipment-reservation">
      <p className="form-note">
        부원이 올린 신청을 확정·반려하는 곳은 <b>장비예약 관리</b> 탭입니다. 여기는 운영진이 직접
        일정을 잡고, 시간을 막고, 예약 규칙을 정하는 곳입니다.
      </p>
      <AdminRecurring onChanged={() => undefined} />
      <AdminBlackouts />
      <AdminReservationPolicy />
    </div>
  );
}
