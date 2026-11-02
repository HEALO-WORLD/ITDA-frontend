import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";

import type { ExamProgressStatus } from "./types";

/**
 * 검사 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 ExaminationController·ExaminationStatusChangeRequest/Response를 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * API 연결 상태 (NEXT_PUBLIC_API_FEATURES=examinations 기준)
 * - API 연결: 검사 상태 변경 `changeExaminationStatus` (`examinations`를 API 대상으로 골랐을 때만 호출할 수 있다)
 * - 화면은 아직 이 함수를 쓰지 않는다: 요청에 필요한 검사 ID(examinationId)를 얻을 공개 조회 API가 없어
 *   화면은 Mock 상태 변경(progress.ts)을 쓴다. 의뢰 ID나 Mock ID를 검사 ID 대신 보내지 않는다.
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-Institution-Id·X-Role을 붙인다.
 * 프론트는 이 X- 헤더들을 만들지 않는다. 토큰 전달은 로그인 연동 후 서버 전용 모듈에서 `headers`로 넘긴다.
 */

/** 백엔드 ExaminationStatus (SCHEDULED → IN_PROGRESS → COMPLETED) */
export type ExaminationStatusDto = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";

/** 상태 변경 요청 본문 (백엔드 ExaminationStatusChangeRequest) */
export interface ExaminationStatusChangeRequestDto {
  status: ExaminationStatusDto;
}

/**
 * 상태 변경 응답 (백엔드 ExaminationStatusChangeResponse, ID는 UUID 문자열).
 * 같은 상태를 다시 요청하면 previousStatus와 currentStatus가 같고 updatedAt도 기존 값이다 (멱등).
 */
export interface ExaminationStatusChangeResponseDto {
  examinationId: string;
  referralId: string;
  previousStatus: ExaminationStatusDto;
  currentStatus: ExaminationStatusDto;
  /** Java LocalDateTime 직렬화 문자열 (시간대 표기 없음) */
  updatedAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 검사 상태 변경 `PATCH /api/v1/examinations/{examinationId}/status`.
 * Gateway 권한(origin/dev 기준): EXAMINER만 허용. 서버가 검사 수행 기관 일치·상태 전이·예약 유효성을 검증한다.
 * Mock 구현으로 대신하지 않는다: examinations가 API 대상이 아니거나 검사 ID가 UUID가 아니면 요청 없이 설정 오류,
 * 호출 실패는 그대로 ApiError로 던진다 (화면 문구는 getExaminationStatusErrorMessage).
 */
export async function changeExaminationStatus(
  examinationId: string,
  status: Exclude<ExaminationStatusDto, "SCHEDULED">,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ExaminationStatusChangeResponseDto> {
  requireApiFeature("examinations");
  // Mock ID(mock-referral-…)나 형식이 다른 값이 서버로 가지 않게 막는다
  if (!UUID_PATTERN.test(examinationId)) {
    throw new ApiError("CONFIG", `검사 ID 형식이 올바르지 않습니다: "${examinationId}"`);
  }
  const body: ExaminationStatusChangeRequestDto = { status };
  return apiRequestData<ExaminationStatusChangeResponseDto>(
    `/api/v1/examinations/${encodeURIComponent(examinationId)}/status`,
    { ...options, method: "PATCH", body },
  );
}

/** 백엔드 검사 상태 → 화면 진행 상태 */
export function toExamProgressStatus(status: ExaminationStatusDto): ExamProgressStatus {
  switch (status) {
    case "SCHEDULED":
      return "WAITING";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "COMPLETED";
  }
}

/**
 * 화면 진행 상태 → 백엔드 검사 상태.
 * NOT_PERFORMED(예약 취소로 검사 안 함)는 화면용 상태라 백엔드 값이 없어 null이다.
 */
export function toExaminationStatusDto(status: ExamProgressStatus): ExaminationStatusDto | null {
  switch (status) {
    case "WAITING":
      return "SCHEDULED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "COMPLETED";
    case "NOT_PERFORMED":
      return null;
  }
}

/** 백엔드 오류 코드별 안내 (코드가 없거나 모르는 코드면 상태 코드 기준 공통 문구) */
const STATUS_CHANGE_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "변경할 검사 상태가 올바르지 않습니다.",
  INVALID_INPUT: "검사 정보 또는 상태 값이 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  ACCESS_DENIED: "검사 상태는 검사기관 담당자만 변경할 수 있습니다.",
  EXAMINATION_ACCESS_DENIED: "우리 기관이 수행하는 검사만 상태를 변경할 수 있습니다.",
  EXAMINATION_NOT_FOUND: "검사 정보를 찾을 수 없습니다.",
  INVALID_EXAMINATION_STATUS_TRANSITION: "현재 검사 상태에서는 이 단계로 변경할 수 없습니다. 최신 상태를 확인해 주세요.",
  EXAMINATION_START_NOT_ALLOWED: "확정된 예약이 아니어서 검사를 시작할 수 없습니다. 예약 상태를 확인해 주세요.",
};

/**
 * 상태 변경 실패 안내 문구.
 * 400·403·404·409는 같은 상태 코드 안에서도 원인이 여러 가지라 백엔드 오류 코드로 구분하고,
 * 401(토큰 없음·만료)과 그 밖의 오류는 공통 문구(ApiError.message)를 쓴다.
 */
export function getExaminationStatusErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "검사 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && STATUS_CHANGE_ERROR_MESSAGES[error.code]) {
    return STATUS_CHANGE_ERROR_MESSAGES[error.code];
  }
  return error.message;
}
