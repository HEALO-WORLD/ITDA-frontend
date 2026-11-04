import type { FailureReasonDto, ReferralHistoryReasonDto, ReferralStatusDto, ReservationStatusDto } from "./remote";

/**
 * 의뢰·예약 API 값 → 화면 문구 (의뢰기관 상세 대화상자·관리자 의뢰/예약 화면 공용).
 * 값은 백엔드 enum(origin/dev) 그대로이고, 문구만 정한다.
 */

export const REFERRAL_STATUS_LABELS: Record<ReferralStatusDto, string> = {
  PENDING: "처리 중",
  CONFIRMED: "확정",
  FAILED: "예약 실패",
  CANCELED: "취소",
  NEEDS_RESCHEDULE: "재조정 필요",
};

export const RESERVATION_STATUS_LABELS: Record<ReservationStatusDto, string> = {
  REQUESTED: "예약 요청됨",
  HELD: "슬롯 확보 중",
  CONFIRMED: "예약 확정",
  FAILED: "예약 실패",
  BLOCKED: "예약 차단",
  CANCELED: "예약 취소",
};

export const FAILURE_REASON_LABELS: Record<FailureReasonDto, string> = {
  SLOT_CONFLICT: "다른 예약과 슬롯이 겹쳤습니다",
  CONFIRM_FAILED: "예약 확정 처리에 실패했습니다",
  HOLD_EXPIRED: "슬롯 확보 시간이 지났습니다",
  EQUIPMENT_FAILURE: "검사 장비 장애로 예약할 수 없습니다",
};

export const HISTORY_REASON_LABELS: Record<ReferralHistoryReasonDto, string> = {
  REFERRAL_CREATED: "의뢰 접수",
  RESERVATION_CONFIRMED: "예약 확정",
  RESERVATION_FAILED: "예약 실패",
  RESERVATION_BLOCKED: "예약 차단",
  RESCHEDULED: "재예약 접수",
  CANCELED_BY_REQUESTER: "의뢰기관 취소",
};
