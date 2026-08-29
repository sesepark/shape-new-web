"use client";

import type { RefObject } from "react";
import { AutoTextarea } from "@/components/auto-textarea";
import { SegmentedChoice } from "@/components/segmented-choice";
import { PURPOSE_CATEGORIES, URGENCY_LEVELS } from "@/lib/booking";
import type { ReservationPurpose, ReservationUrgency } from "@/lib/types";

/**
 * 신청서에서 사람이 직접 적는 부분.
 *
 * 목적과 시급도를 먼저 두고 덧붙일 말을 나중에 두는 것은 일부러다. 두 번의
 * 누름으로 무엇을 적어야 하는지가 정해지고, 그 바로 아래에 적는 칸이 온다.
 */
export function BookingRequestFields({
  purposeCategory,
  urgency,
  note,
  disabled,
  noteRef,
  onPurposeChange,
  onUrgencyChange,
  onNoteChange,
}: {
  purposeCategory: ReservationPurpose | "";
  urgency: ReservationUrgency;
  note: string;
  disabled?: boolean;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  onPurposeChange: (value: ReservationPurpose) => void;
  onUrgencyChange: (value: ReservationUrgency) => void;
  onNoteChange: (value: string) => void;
}) {
  return (
    <div className="booking-choices">
      <SegmentedChoice
        label="사용 목적"
        hint="무엇을 위해 쓰는지 골라 주세요. 시간이 겹쳤을 때 운영진이 보는 첫 기준입니다."
        options={PURPOSE_CATEGORIES}
        value={purposeCategory}
        onChange={onPurposeChange}
        disabled={disabled}
      />
      <SegmentedChoice
        label="사용 시급도"
        hint="급하지 않은 신청을 낮음으로 두면, 정말 급한 신청이 가려집니다."
        options={URGENCY_LEVELS}
        value={urgency}
        onChange={onUrgencyChange}
        disabled={disabled}
        levelled
      />
      <label className="booking-note">
        <span className="booking-field-label">기타 내용 <i>(선택)</i></span>
        <AutoTextarea
          textareaRef={noteRef}
          value={note}
          onChange={onNoteChange}
          minRows={4}
          maxLength={2000}
          disabled={disabled}
          placeholder="같은 시간을 다른 부원도 신청하면 운영진이 이 내용을 보고 누구를 먼저 승인할지 정합니다. 마감이 언제인지, 왜 이 시간이어야 하는지 적어 주세요."
        />
        <small className="field-hint">
          함께 쓸 재료나 안전에 유의할 점이 있으면 여기 적어 주세요.
          확정된 예약은 동아리 예약 현황에서 누구나 볼 수 있지만, <b>이 내용은 운영진만 봅니다.</b>
        </small>
      </label>
    </div>
  );
}
