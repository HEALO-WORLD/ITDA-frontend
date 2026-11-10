import type { ExamType } from "@/features/slots/types";

/**
 * 재조정·알림(S04) 프론트엔드 타입.
 *
 * ⚠️ 알림 API의 응답 필드·알림 타입 enum은 확인되지 않았다. (screen-spec S04-C 확인 필요)
 * 아래 타입은 Mock 데이터와 화면 렌더링을 위한 임시 타입이며, API 연동 시 응답 DTO에서 매핑한다.
 */

/** 화면 표시용 알림 유형 */
export type NotificationType =
  | "RESCHEDULE_REQUIRED"
  | "RESERVATION_CONFIRMED"
  | "RESERVATION_CANCELLED"
  | "RESULT_REGISTERED";

/** 재조정 원인. 확인된 원인이 있을 때만 둔다 (없으면 원인을 단정하지 않는다) */
export interface RescheduleCause {
  kind: "EQUIPMENT_FAILURE";
  examType: ExamType;
  /** 장애 장비 식별자 (ExamSlot.equipmentId와 같은 값) */
  equipmentId: string;
  equipmentName: string;
}

export interface NotificationItem {
  id: string;
  /** 관련 의뢰 id (ReferralSummary.id). 의뢰와 무관한 알림은 null */
  referralId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  /** 발생 일시 (`YYYY-MM-DDTHH:mm`, 한국 시간) */
  occurredAt: string;
  isRead: boolean;
  /** RESCHEDULE_REQUIRED 알림의 원인 */
  rescheduleCause?: RescheduleCause;
}

// ── 알림 API 화면 타입 (의뢰기관·검사기관 공통) ──

/**
 * 알림 API 응답(NotificationResponse)을 화면에서 쓰는 형태로 옮긴 값.
 * 백엔드에 없는 값(재조정 원인 장비·관련 화면 등)은 두지 않는다. 유형은 값 목록이 미확정이라 문자열 그대로다.
 */
export interface ApiNotificationItem {
  id: string;
  referralId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  /** 생성 시각 (Java LocalDateTime 문자열, 시간대 표기 없음) */
  occurredAt: string;
  readAt: string | null;
}

/**
 * 알림 API 실패 원인.
 * - SIGNED_OUT: 로그인 쿠키 없음 (요청하지 않음)
 * - UNAUTHORIZED: 401 (토큰 만료·위조) → 다시 로그인
 * - FORBIDDEN: 403 (알림을 쓸 수 없는 역할, 또는 본인 알림이 아님)
 * - NOT_FOUND: 404 (읽음 처리할 알림이 없음)
 * - NETWORK: 서버에 연결하지 못함·응답 시간 초과
 * - ERROR: 그 밖의 실패 (400·5xx·응답 형식 오류·설정 오류)
 */
export type NotificationFailureReason = "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NETWORK" | "ERROR";

export interface NotificationFailure {
  ok: false;
  reason: NotificationFailureReason;
  message: string;
}

/** 읽지 않은 알림 수 조회 결과 (레이아웃이 Promise로 넘겨 헤더·목록이 함께 쓴다) */
export type UnreadNotificationCountResult = { ok: true; unreadCount: number } | NotificationFailure;

/**
 * 읽음 처리 Server Function 결과.
 * SESSION_CHANGED: 다른 탭에서 로그인 계정이 바뀌어 요청하지 않음 (FORBIDDEN과 구분, 읽음 처리에만 있다)
 */
export type NotificationReadActionResult =
  | { ok: true; notificationId: string; readAt: string }
  | NotificationFailure
  | { ok: false; reason: "SESSION_CHANGED"; message: string };

/** API 알림 목록의 읽지 않음 필터 화면 주소 값 (`?filter=unread`) */
export const NOTIFICATION_UNREAD_FILTER = "unread";
