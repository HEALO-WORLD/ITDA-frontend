import type { IncidentProcessingStatusDto } from "./remote";

/**
 * 장비 장애 후속 처리 표시 문구 (검사기관·관리자 장애 상세 공용, 표시 계층에서만 바꾼다. 백엔드 값은 그대로).
 *
 * processingStatus는 장애 발생 뒤 서버가 돌리는 "자동 후속 처리 작업"의 상태다.
 * SUCCEEDED는 그 작업이 끝났다는 뜻일 뿐, 의뢰기관이 새 슬롯을 골라 예약 재조정까지 끝났다는 뜻이 아니다.
 */
export const PROCESSING_STATUS_LABELS: Record<IncidentProcessingStatusDto, string> = {
  PENDING: "후속 처리 대기",
  PROCESSING: "자동 처리 중",
  SUCCEEDED: "자동 처리 완료",
  FAILED: "자동 처리 실패",
};

/** '자동 처리 완료'와 예약 재조정 완료를 혼동하지 않도록 붙이는 안내 */
export const AUTO_PROCESSING_NOTE = "자동 처리 완료는 장애에 따른 후속 작업이 완료되었다는 의미이며, 예약 재조정 완료를 뜻하지 않습니다.";

/** 백엔드 IncidentReferral resultCode → 화면 문구 (목록에 없는 값은 문구를 만들지 않는다) */
const RESULT_CODE_LABELS: Readonly<Record<string, string>> = {
  RESCHEDULE_REQUIRED: "재조정 필요 상태로 변경",
  ALREADY_BLOCKED: "이미 차단된 예약",
  SKIPPED_IN_PROGRESS: "검사 진행 중으로 자동 처리 제외",
  SKIPPED_COMPLETED: "검사 완료로 처리 대상 제외",
  SKIPPED_CANCELED: "취소된 예약으로 처리 대상 제외",
  SKIPPED_NOT_CURRENT: "현재 예약이 아니어서 제외",
};

/**
 * resultCode 표시 문구. 알려진 값이면 한글 문구, 모르는 값이면 null (화면은 원래 코드를 그대로 보여 준다).
 * 객체 기본 속성(toString 등)이 문구로 잡히지 않도록 자기 속성만 본다
 */
export function getResultCodeLabel(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(RESULT_CODE_LABELS, code) ? RESULT_CODE_LABELS[code] : null;
}
