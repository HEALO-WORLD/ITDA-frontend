import type { FailureReasonDto, ReferralStatusDto, ReservationStatusDto } from "./remote";

/**
 * 재예약 요청 뒤 진행 단계 (순수 함수, 브라우저·서버 공통).
 * 재예약 POST 성공은 '접수(REQUESTED)'다. 슬롯 확보(HOLD)·확정은 Kafka로 비동기 처리되므로 의뢰·현재 예약을 다시 조회해 판단한다.
 * - CONFIRMED: 의뢰 CONFIRMED + 현재 예약 CONFIRMED
 * - PROCESSING: 의뢰 PENDING + 예약 REQUESTED·HELD (아직 확정 아님)
 * - FAILED: 현재 예약 FAILED·BLOCKED 또는 의뢰 FAILED
 * - NEEDS_RESCHEDULE: 의뢰가 아직(또는 다시) 재조정 필요 상태
 * - EXPIRED: 재조정 기한이 만료되어 더 이상 재예약할 수 없는 상태
 * - OTHER: 취소 등 그 밖의 상태 (받은 상태 그대로 안내)
 * 화면은 이 결과만 보여 주고 상태를 바꾸지 않는다.
 */

export type RescheduleProgressStage = "CONFIRMED" | "PROCESSING" | "FAILED" | "NEEDS_RESCHEDULE" | "EXPIRED" | "OTHER";

const FAILURE_REASON_MESSAGES: Record<FailureReasonDto, string> = {
  SLOT_CONFLICT: "다른 요청이 먼저 이 슬롯을 확보했습니다.",
  CONFIRM_FAILED: "검사기관에서 예약을 확정하지 못했습니다.",
  HOLD_EXPIRED: "슬롯 확보 시간이 지났습니다.",
  EQUIPMENT_FAILURE: "검사 장비 장애로 예약하지 못했습니다.",
};

export function toRescheduleProgress(
  referralStatus: ReferralStatusDto,
  reservation: { status: ReservationStatusDto; failureReason: FailureReasonDto | null } | null,
): { stage: RescheduleProgressStage; message: string } {
  // 의뢰가 재조정 필요 상태면 현재 예약은 장애로 막힌 기존 예약이거나 실패한 재예약이다: 요청이 반영되지 않은 것으로 안내한다
  if (referralStatus === "NEEDS_RESCHEDULE") {
    return { stage: "NEEDS_RESCHEDULE", message: "아직 재조정이 필요한 상태입니다. 재예약 요청이 접수되지 않았거나 실패했을 수 있습니다." };
  }
  // 기존 예약은 BLOCKED로 남으므로 만료를 먼저 판정한다. 재예약을 다시 유도하면 안 된다.
  if (referralStatus === "EXPIRED") {
    return { stage: "EXPIRED", message: "재조정 기한이 만료되어 의뢰가 종료되었습니다. 더 이상 재예약할 수 없습니다." };
  }
  if (reservation && (reservation.status === "FAILED" || reservation.status === "BLOCKED")) {
    const reason = reservation.failureReason ? ` ${FAILURE_REASON_MESSAGES[reservation.failureReason]}` : "";
    return { stage: "FAILED", message: `재예약이 확정되지 않았습니다.${reason} 재조정 목록에서 다른 슬롯으로 다시 요청해 주세요.` };
  }
  if (referralStatus === "FAILED") return { stage: "FAILED", message: "의뢰 처리에 실패했습니다. 의뢰·예약 관리에서 상태를 확인해 주세요." };
  if (referralStatus === "CONFIRMED" && reservation?.status === "CONFIRMED") return { stage: "CONFIRMED", message: "재예약이 확정되었습니다." };
  if (referralStatus === "PENDING" && (!reservation || reservation.status === "REQUESTED" || reservation.status === "HELD")) {
    return {
      stage: "PROCESSING",
      message: reservation?.status === "HELD" ? "새 슬롯을 확보했습니다. 검사기관 확정을 기다리고 있습니다." : "재예약 요청을 처리하고 있습니다. 아직 확정되지 않았습니다.",
    };
  }
  if (referralStatus === "CANCELED") return { stage: "OTHER", message: "취소된 의뢰입니다." };
  return { stage: "OTHER", message: "의뢰·예약 상태를 의뢰·예약 관리 화면에서 확인해 주세요." };
}
