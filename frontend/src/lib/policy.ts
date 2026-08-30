"use client";

import { API_URL } from "@/lib/api";
import type { PublicReservationPolicy } from "@/lib/types";

/**
 * 예약 규칙 값을 못 받아 왔을 때 쓰는 값. 서버 기본값과 같습니다.
 *
 * 안내가 조금 틀리는 것이 안내가 아예 없는 것보다 낫습니다. 다만 **신청 자체는
 * 서버가 판정**하므로, 이 값이 틀려도 잘못된 예약이 들어가지는 않습니다.
 */
export const FALLBACK_POLICY: PublicReservationPolicy = {
  autoApproveMinutes: 60, startGraceMinutes: 10, maxHours: 12, bookingWindowDays: 180,
};

/**
 * 예약 규칙 값을 한 번만 읽어 여러 화면이 나눠 씁니다.
 *
 * 예약 화면과 떠 있는 '사진 올리기' 띠가 같은 값을 보는데, 각자 부르면 회원
 * 한 명이 예약 화면을 열 때마다 같은 응답을 두 번 받습니다. `lib/session.ts`
 * 가 세션을 다루는 방식과 같게 진행 중인 요청 하나를 나눠 씁니다.
 *
 * 로그인 여부와 상관없는 공개 창구이고 서버 쪽에도 30초 공유 캐시가 있어,
 * 이 요청은 대개 Neon 까지 가지 않습니다.
 */
let cached: Promise<PublicReservationPolicy> | undefined;

export function loadPolicy(): Promise<PublicReservationPolicy> {
  if (!cached) {
    cached = fetch(`${API_URL}/reservation-policy`)
      .then((response) => (response.ok ? (response.json() as Promise<PublicReservationPolicy>) : FALLBACK_POLICY))
      // 못 받아 왔더라도 기본값을 채웁니다. 기다리게 두면 안내 팝업이 값을
      // 기다리느라 영영 뜨지 않습니다.
      .catch(() => FALLBACK_POLICY);
  }
  return cached;
}
