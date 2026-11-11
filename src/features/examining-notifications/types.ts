/**
 * 검사기관 알림 프론트엔드 타입 (의뢰기관 알림 NotificationItem과 별개).
 *
 * ⚠️ 알림 응답 DTO·알림 유형 enum·읽음 처리 API가 확정되지 않았다.
 * 아래 타입은 Mock 데이터와 화면 렌더링을 위한 임시 타입이며, API 연동 시 응답 DTO에서 매핑한다.
 */

/** 검사기관 알림 유형 (화면 표시용) */
export type ExaminingNotificationType =
  | "RESERVATION_RECEIVED"
  | "RESERVATION_CANCELLED"
  | "RESERVATION_CHANGED"
  | "EQUIPMENT_FAILURE"
  | "EQUIPMENT_RECOVERED";

/** 알림이 가리키는 업무 대상. ID로만 연결한다 */
export type ExaminingNotificationTarget =
  | { kind: "RESERVATION"; referralId: string }
  | { kind: "INCIDENT"; incidentId: string };

export interface ExaminingNotification {
  id: string;
  /** 알림을 받는 검사기관 ID */
  recipientOrganizationId: string;
  type: ExaminingNotificationType;
  title: string;
  message: string;
  /** 발생 일시 (`YYYY-MM-DDTHH:mm`, 한국 시간) */
  occurredAt: string;
  isRead: boolean;
  target: ExaminingNotificationTarget;
}
