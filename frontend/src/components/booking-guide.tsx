"use client";

import { useCallback, useEffect, useRef } from "react";
import { BookOpen } from "lucide-react";
import { useAsk } from "@/components/ask-dialog";
import type { PublicReservationPolicy } from "@/lib/types";

/**
 * 예약이 어떻게 굴러가는지 처음부터 끝까지 설명하는 팝업.
 *
 * 규칙이 여럿 생겼는데(자동 확정, 지금 칸 예약, 사진 두 장, 조기 반납, 사용 제한)
 * 부원 100명이 이것을 문서로 읽을 리가 없습니다. 그래서 **예약 화면 안에서**
 * 말해 줍니다.
 *
 * 두 가지 방식으로 뜹니다.
 *
 * * **처음 온 사람에게 저절로 한 번.** 브라우저에 자국을 남겨 두 번째부터는
 *   뜨지 않습니다. 저장이 막힌 곳(시크릿 창)에서는 매번 뜨는데, 그편이 한 번도
 *   못 보는 것보다 낫습니다.
 * * **'예약 안내' 단추로 언제든.** 처음 본 뒤에 다시 찾을 곳이 없으면 결국
 *   운영진에게 물어보게 됩니다.
 *
 * 숫자는 **서버가 알려 준 정책**에서 그대로 옵니다(`policy`). 화면에 "한 시간" 을
 * 적어 두면 관리자가 두 시간으로 바꾼 뒤에도 안내가 옛말을 하게 됩니다.
 */

/** 브라우저에 남기는 자국. 값이 아니라 있고 없음만 봅니다. */
const SEEN_KEY = "shape:booking-guide-seen";

function span(minutes: number): string {
  if (minutes <= 0) return "시작 시각";
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  if (minutes > 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  return `${minutes}분`;
}

export function BookingGuide({
  policy,
  sharedCalendar,
}: {
  policy: PublicReservationPolicy | null;
  sharedCalendar?: boolean;
}) {
  const { ask, dialogNode } = useAsk();
  // 저절로 뜨는 것은 한 번뿐입니다. 정책을 늦게 받아 다시 그려질 때마다 뜨면
  // 안내가 아니라 방해가 됩니다.
  const opened = useRef(false);

  const lead = policy?.autoApproveMinutes ?? 60;
  const grace = policy?.startGraceMinutes ?? 10;
  const maxHours = policy?.maxHours ?? 12;
  const windowDays = policy?.bookingWindowDays ?? 180;

  const show = useCallback(() => {
    void ask({
      title: "장비 예약 안내",
      description: (
        <div className="booking-guide-body">
          <section>
            <h4>1. 신청하면 어떻게 확정되나요</h4>
            <p>
              신청은 <b>승인 대기</b>로 들어갑니다. 같은 호기·같은 시간에 다른 신청이 없으면
              <b> 시작 {span(lead)} 전에 저절로 확정</b>됩니다. 운영진이 그 전에 먼저 확정해도 됩니다.
            </p>
            <p>
              신청하는 순간 이미 그 안이면 <b>곧바로 확정</b>됩니다. 장비 앞에 서서 지금 시간을
              잡는 경우가 여기에 해당합니다.
            </p>
            <p className="warn">
              같은 시간에 신청이 겹치면 <b>저절로 확정되지 않습니다.</b> 운영진이 한 건을 고르고
              나머지는 사유와 함께 반려합니다. 그래서 <b>기타 내용</b>에 왜 이 시간이어야 하는지
              적어 두면 실제로 판단에 쓰입니다.
            </p>
          </section>

          <section>
            <h4>2. 지금 돌고 있는 칸도 잡을 수 있습니다</h4>
            <p>
              17시 14분에 17~18시 칸을 잡는 것은 정상입니다. <b>끝 시각이 지난 칸만</b> 잠깁니다.
              장비가 비어 있는데 남은 시간을 버릴 이유가 없습니다.
            </p>
          </section>

          <section>
            <h4>3. 시간표의 칸 색</h4>
            <ul>
              <li><b>빈 시간</b> — 아무도 잡지 않았습니다.</li>
              <li><b>지금</b> — 이미 시작된 칸입니다. 그대로 잡아 바로 쓸 수 있습니다.</li>
              <li><b>신청 N</b> — 남이 신청해 두었지만 아직 확정 전입니다. 함께 신청할 수 있습니다.</li>
              <li><b>확정</b> — 이미 확정된 예약이 있습니다.</li>
              <li><b>사용 제한</b> — 운영진이 막아 둔 시간입니다(정비·교육 실습·대회 준비). 사유는 시간표 위에 적힙니다.</li>
              <li><b>지난 시간</b> — 이미 끝났습니다.</li>
            </ul>
          </section>

          <section>
            <h4>4. 사진 두 장을 꼭 올려 주세요</h4>
            <p>
              <b>사용 전 사진을 올려야 사용이 시작되고, 사용 후 사진을 올려야 완료됩니다.</b>{" "}
              사진은 장비 상태를 남기는 유일한 기록이라, 빠지면 다음 사람이 이전 상태를 확인할 수 없습니다.
            </p>
            <ul>
              <li><b>마이페이지</b> — 내 예약 카드에서 바로 올립니다.</li>
              <li><b>장비 예약 현황</b> — 달력에서 내 예약을 누르면 뜨는 창에서도 올릴 수 있습니다.</li>
              <li>사용 시각이 되면 <b>화면 왼쪽 아래에 띠</b>가 떠서 그 자리에서 바로 갈 수 있습니다.</li>
            </ul>
            <p>사용 시작은 예약 시각 <b>{span(grace)} 전</b>부터 누를 수 있습니다.</p>
          </section>

          <section>
            <h4>5. 일찍 끝내면 남은 시간을 반납해 주세요</h4>
            <p>
              사용 후 사진을 올릴 때 <b>남은 시간 반납</b>을 함께 고를 수 있습니다. 반납한 시간은
              곧바로 다른 부원이 예약할 수 있게 열립니다.
            </p>
          </section>

          <section>
            <h4>6. 지켜야 하는 한도</h4>
            <ul>
              <li>한 번에 최대 <b>{maxHours}시간</b>까지 잡을 수 있습니다.</li>
              <li>오늘부터 <b>{windowDays}일</b> 앞까지 신청할 수 있습니다.</li>
              <li>장비마다 <b>운용 교육 이수</b>가 필요합니다. 이수하지 않은 장비는 카드가 잠겨 있습니다.</li>
              <li>함께 쓰는 부원은 신청서에 넣어 주세요. 사고가 났을 때 물어볼 곳이 됩니다.</li>
            </ul>
          </section>

          {sharedCalendar && (
            <section>
              <h4>7. 공유 캘린더에 올라가는 장비가 있습니다</h4>
              <p>
                일부 장비는 확정되면 동아리가 함께 쓰는 구글 캘린더 ‘휴머노이드 운용’ 에 일정이
                올라갑니다. 그 캘린더는 SHAPE 밖에서도 보므로, <b>기타 내용은 올라가지 않습니다.</b>
              </p>
            </section>
          )}
        </div>
      ),
      confirmLabel: "알겠습니다",
      cancelLabel: "닫기",
    });
  }, [ask, lead, grace, maxHours, windowDays, sharedCalendar]);

  // 처음 온 사람에게 한 번. 자국은 열어 본 그 자리에서 남깁니다 — 닫을 때 남기면
  // 팝업을 닫지 않고 나간 사람에게 다음에도 뜹니다.
  useEffect(() => {
    if (opened.current) return;
    // 규칙 값을 받기 전에 띄우면 팝업이 "한 시간" 이라고 적어 놓고, 관리자가
    // 두 시간으로 바꿔 두었어도 첫 방문자만 옛말을 보게 됩니다. 값이 자리를
    // 잡은 뒤에 띄웁니다(못 받아 온 경우에도 기본값이 채워집니다).
    if (!policy) return;
    let seen = true;
    try {
      seen = Boolean(window.localStorage.getItem(SEEN_KEY));
    } catch {
      // 시크릿 창처럼 저장이 막힌 곳입니다. 매번 뜨더라도 안 뜨는 것보다 낫습니다.
      seen = false;
    }
    if (seen) return;
    opened.current = true;
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // 저장하지 못해도 안내는 띄웁니다.
    }
    show();
  }, [show, policy]);

  return (
    <>
      <button type="button" className="text-button booking-guide-open" onClick={show}>
        <BookOpen size={15} aria-hidden="true" /> 예약 안내 자세히 보기
      </button>
      {dialogNode}
    </>
  );
}
