import type { Examination, ExamProgressStatus, ExamResultInput, ExamResultStatus, ResultRegistrationStatus } from "./types";

/** 결과 텍스트 최대 길이 (서버 제한 확인 필요) */
export const RESULT_TEXT_MAX_LENGTH = 1000;

export const RESULT_STATUS_LABELS: Record<ExamResultStatus, string> = {
  PRELIMINARY: "예비 판독",
  FINAL: "최종 판독",
  NEEDS_REVIEW: "추가 확인 필요",
};

/** 결과 등록 상태 (예약 상태·검사 진행 상태·결과 유무에서 계산) */
export function getResultRegistrationStatus(examination: Examination): ResultRegistrationStatus {
  if (examination.result) return "REGISTERED";
  if (examination.reservationStatus === "CANCELLED" || examination.progressStatus === "NOT_PERFORMED") {
    return "NOT_APPLICABLE";
  }
  return examination.progressStatus === "COMPLETED" ? "PENDING" : "BEFORE_EXAM";
}

/** 결과를 등록할 수 없는 이유. 등록 가능하면 null */
export function getRegistrationBlockReason(examination: Examination): string | null {
  if (examination.reservationStatus === "CANCELLED") return "취소된 예약은 결과를 등록할 수 없습니다.";
  if (examination.result) return "이미 결과가 등록된 검사입니다.";
  if (examination.progressStatus !== "COMPLETED") return "검사가 완료된 뒤에 결과를 등록할 수 있습니다.";
  return null;
}

/** 상태 변경 버튼으로 바꿀 수 있는 다음 진행 상태 */
export type NextProgressStatus = Extract<ExamProgressStatus, "IN_PROGRESS" | "COMPLETED">;

export const PROGRESS_ACTION_LABELS: Record<NextProgressStatus, string> = {
  IN_PROGRESS: "검사 시작",
  COMPLETED: "검사 완료",
};

/**
 * 다음 진행 상태. 대기 → 진행 중 → 완료 순서로 한 단계씩만 바꾼다 (서버 ExaminationStatus 규칙과 같다).
 * 완료·미실시이거나 예약이 취소된 검사는 바꿀 수 없어 null이다.
 */
export function getNextProgressStatus(examination: Examination): NextProgressStatus | null {
  if (examination.reservationStatus === "CANCELLED") return null;
  if (examination.progressStatus === "WAITING") return "IN_PROGRESS";
  if (examination.progressStatus === "IN_PROGRESS") return "COMPLETED";
  return null;
}

/**
 * 다음 단계로 바꿀 수 없는 이유 (버튼은 보이지만 막는 경우). 바꿀 수 있으면 null.
 * 서버도 확정된 예약일 때만 검사 시작을 허용한다 (EXAMINATION_START_NOT_ALLOWED).
 */
export function getProgressChangeBlockReason(examination: Examination, next: NextProgressStatus): string | null {
  if (next === "IN_PROGRESS" && examination.reservationStatus !== "CONFIRMED") {
    return "예약이 확정된 검사만 시작할 수 있습니다.";
  }
  return null;
}

export type ResultInputErrors = Partial<Record<keyof ExamResultInput, string>>;

/** 결과 등록 입력 검증 */
export function validateResultInput({ status, text }: ExamResultInput): ResultInputErrors {
  const errors: ResultInputErrors = {};
  if (!status) errors.status = "검사 결과 상태를 선택해 주세요.";
  const trimmed = text.trim();
  if (!trimmed) errors.text = "검사 결과 텍스트를 입력해 주세요.";
  else if (trimmed.length > RESULT_TEXT_MAX_LENGTH) {
    errors.text = `검사 결과 텍스트는 ${RESULT_TEXT_MAX_LENGTH}자 이하로 입력해 주세요.`;
  }
  return errors;
}
