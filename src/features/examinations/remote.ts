import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

import type { ExamProgressStatus } from "./types";

/**
 * 검사 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 ExaminationController와 요청·응답 DTO를 기준으로 옮겼다 (ITDA 저장소 origin/dev a963fc5 기준 확인).
 * API 연결 상태 (NEXT_PUBLIC_API_FEATURES=examinations 기준, API 모드 화면에서만 호출)
 * - 검사 목록 조회 `fetchExaminationPage`
 * - 검사 상태 변경 `changeExaminationStatus`, 검사 결과 등록 `createExaminationResult` (actions.ts에서 호출)
 * - Mock 모드 화면은 api.ts·progress.ts·register.ts를 그대로 쓴다. 의뢰 ID나 Mock ID를 검사 ID 대신 보내지 않는다.
 * - 검사 결과 조회(GET …/results)는 연결하지 않았다.
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-Institution-Id·X-Role을 붙인다.
 * 프론트는 이 X- 헤더들을 만들지 않는다. 토큰은 서버 전용 모듈에서 `headers`로 넘긴다 (getExaminationAuthorizationHeaders).
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
  const data = await apiRequestData<unknown>(`/api/v1/examinations/${encodeURIComponent(examinationId)}/status`, {
    ...options,
    method: "PATCH",
    body,
  });
  // 성공 응답이면 서버가 요청한 상태로 바꿨거나 이미 그 상태였다 (멱등). 그 밖의 값은 계약과 다른 응답으로 본다
  if (!isStatusChangeResponse(data, examinationId, status)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

function isStatusChangeResponse(
  value: unknown,
  examinationId: string,
  status: ExaminationStatusDto,
): value is ExaminationStatusChangeResponseDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.examinationId === "string" &&
    data.examinationId.toLowerCase() === examinationId.toLowerCase() &&
    EXAMINATION_STATUSES.includes(data.previousStatus as ExaminationStatusDto) &&
    data.currentStatus === status &&
    typeof data.updatedAt === "string"
  );
}

// ── 검사 결과 등록 ──

/** 결과 등록 요청 본문 (백엔드 ExaminationResultCreateRequest: summary 필수·공백 불가, notes 선택. 길이 제한 없음) */
export interface ExaminationResultCreateRequestDto {
  summary: string;
  notes?: string;
}

/** 결과 등록 응답 (백엔드 ExaminationResultCreateResponse) */
export interface ExaminationResultCreateResponseDto {
  resultId: string;
  examinationId: string;
  /** Java LocalDateTime 직렬화 문자열 (시간대 표기 없음) */
  registeredAt: string;
}

/**
 * 검사 결과 등록 `POST /api/v1/examinations/{examinationId}/results` (201).
 * Gateway 권한(origin/dev 기준): EXAMINER만 허용. 서버가 검사 수행 기관 일치·검사 완료·중복 등록을 검증한다
 * (⚠️ 서비스 자체는 X-Role을 확인하지 않는다: 역할 제한은 Gateway 정책에만 있다).
 * 결과 상태(예비·최종 판독 등)는 백엔드에 없어 보내지 않는다. summary·notes는 앞뒤 공백을 지우고, 빈 notes는 보내지 않는다.
 * 요청 전 검증에 걸리면 설정 오류, 호출 실패는 그대로 ApiError로 던진다 (화면 문구는 getExaminationResultErrorMessage).
 */
export async function createExaminationResult(
  examinationId: string,
  input: { summary: string; notes?: string | null },
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ExaminationResultCreateResponseDto> {
  requireApiFeature("examinations");
  if (!UUID_PATTERN.test(examinationId)) {
    throw new ApiError("CONFIG", `검사 ID 형식이 올바르지 않습니다: "${examinationId}"`);
  }
  const summary = input.summary.trim();
  const notes = input.notes?.trim();
  if (!summary) {
    throw new ApiError("CONFIG", "검사 결과 요약이 비어 있습니다.");
  }
  const body: ExaminationResultCreateRequestDto = notes ? { summary, notes } : { summary };
  const data = await apiRequestData<unknown>(`/api/v1/examinations/${encodeURIComponent(examinationId)}/results`, {
    ...options,
    method: "POST",
    body,
  });
  if (!isResultCreateResponse(data, examinationId)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

function isResultCreateResponse(value: unknown, examinationId: string): value is ExaminationResultCreateResponseDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.resultId === "string" &&
    UUID_PATTERN.test(data.resultId) &&
    typeof data.examinationId === "string" &&
    data.examinationId.toLowerCase() === examinationId.toLowerCase() &&
    typeof data.registeredAt === "string"
  );
}

/** 검사 ID 형식 확인 (Server Function 인자 검증용) */
export const isExaminationId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/** 백엔드 검사 상태 → 화면 진행 상태 (NOT_PERFORMED는 백엔드에 없어 나오지 않는다) */
export function toExamProgressStatus(status: ExaminationStatusDto): Exclude<ExamProgressStatus, "NOT_PERFORMED"> {
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

// ── 검사 목록 조회 ──

/**
 * 검사 목록 항목 (백엔드 ExaminationListResponse, ID는 UUID 문자열).
 * - examinationId: 검사 ID. 상태 변경·결과 등록·결과 조회(`/api/v1/examinations/{examinationId}/…`)에 쓴다
 * - referralId: 이 검사의 의뢰 ID (의뢰 1건에 검사 1건). 의뢰 API에만 쓰고 검사 API에 넘기지 않는다
 * - reservationId: 현재 예약 시도 ID. 재예약하면 바뀔 수 있다
 */
export interface ExaminationListItemDto {
  examinationId: string;
  referralId: string;
  reservationId: string;
  status: ExaminationStatusDto;
  startedAt: string | null;
  completedAt: string | null;

  // 이번에 백엔드에 추가한 필드
  examTypeId: string;
  examDate: string;
  startTime: string;
  endTime: string;
  reservationStatus: string;
  equipmentId: string;
  resultRegistered: boolean;
}

/** 검사 목록 조회 조건. 조회 범위(요청자 소속 검사기관)와 정렬(생성일 최신순)은 서버가 정한다 */
export interface ExaminationListParams {
  /** 0부터. 기본 0 */
  page?: number;
  /** 1~100. 기본 10 */
  size?: number;
}

export const EXAMINATION_PAGE_SIZE_MAX = 100;
const EXAMINATION_STATUSES: readonly ExaminationStatusDto[] = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"];

/**
 * 검사 목록 조회 `GET /api/v1/examinations?page&size` (EXAMINER, 요청자 소속 검사기관의 검사만).
 * Mock 구현으로 대신하지 않는다: examinations가 API 대상이 아니거나 page·size가 범위를 벗어나면 요청 없이 설정 오류,
 * 호출 실패는 그대로 ApiError로 던지고, 응답 형태가 계약과 다르면 PARSE 오류로 본다 (화면 문구는 getExaminationListErrorMessage).
 * Gateway 권한(origin/dev 35bdbd4 이후): EXAMINER만 허용. 다른 역할은 403 ACCESS_DENIED.
 */
export async function fetchExaminationPage(
  { page = 0, size = 10 }: ExaminationListParams = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ExaminationListItemDto>> {
  requireApiFeature("examinations");
  // 서버도 400으로 거부하지만 코드가 UNSUPPORTED_REQUEST라 원인을 알 수 없어 보내기 전에 막는다
  if (!Number.isInteger(page) || page < 0) {
    throw new ApiError("CONFIG", `검사 목록 페이지 번호가 올바르지 않습니다: ${page}`);
  }
  if (!Number.isInteger(size) || size < 1 || size > EXAMINATION_PAGE_SIZE_MAX) {
    throw new ApiError("CONFIG", `검사 목록 페이지 크기는 1~${EXAMINATION_PAGE_SIZE_MAX}이어야 합니다: ${size}`);
  }
  const data = await apiRequestData<unknown>("/api/v1/examinations", { ...options, query: { page, size } });
  if (!isExaminationPage(data)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

const isNullableString = (value: unknown) => value === null || typeof value === "string";

/** 검사 ID 등이 UUID가 아니거나 모르는 상태값이면 계약과 다른 응답으로 본다 (모르는 값을 추측해 바꾸지 않는다) */
function isExaminationListItem(
  value: unknown,
): value is ExaminationListItemDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;

  const validIds = [
    item.examinationId,
    item.referralId,
    item.reservationId,
    item.examTypeId,
    item.equipmentId,
  ].every(
    (id) => typeof id === "string" && UUID_PATTERN.test(id),
  );

  const validStatus = EXAMINATION_STATUSES.includes(
    item.status as ExaminationStatusDto,
  );

  const validDates = [
    item.examDate,
    item.startTime,
    item.endTime,
  ].every(
    (date) => typeof date === "string" && date.length > 0,
  );

  return (
    validIds &&
    validStatus &&
    isNullableString(item.startedAt) &&
    isNullableString(item.completedAt) &&
    validDates &&
    typeof item.reservationStatus === "string" &&
    typeof item.resultRegistered === "boolean"
  );
}

function isExaminationPage(value: unknown): value is PagedResponseDto<ExaminationListItemDto> {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.contents) &&
    page.contents.every(isExaminationListItem) &&
    [page.totalElements, page.totalPages, page.size, page.number].every(Number.isInteger)
  );
}

/** 검사 목록 항목을 화면 진행 상태로 바꾼 값 (화면 표시용 Examination이 아니다: 의뢰번호 등 표시 정보가 없다) */
export interface ExaminationProgressItem
  extends Omit<ExaminationListItemDto, "status"> {
  progressStatus: Exclude<
    ExamProgressStatus,
    "NOT_PERFORMED"
  >;
}

/** 목록 항목 → 화면 진행 상태 (SCHEDULED → WAITING). 응답에 없는 값은 만들지 않는다 */
export function toExaminationProgressItem({ status, ...rest }: ExaminationListItemDto): ExaminationProgressItem {
  return { ...rest, progressStatus: toExamProgressStatus(status) };
}

/** 검사 목록 조회 오류 코드별 안내 (PR #49 기준) */
const LIST_ERROR_MESSAGES: Record<string, string> = {
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  INVALID_INPUT: "로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.",
  /** 400일 때만: Spring 표준 오류(잘못된 page·size)에 붙는다. 404·405에도 같은 코드가 붙으므로 그때는 공통 문구를 쓴다 */
  UNSUPPORTED_REQUEST: "검사 목록 조회 조건이 올바르지 않습니다.",
  ACCESS_DENIED: "검사 목록은 검사기관 담당자만 조회할 수 있습니다.",
  EXAMINATION_ACCESS_DENIED: "검사 목록은 검사기관 담당자만 조회할 수 있습니다.",
};

/** 검사 목록 조회 실패 안내 문구. 401과 모르는 코드는 공통 문구(ApiError.message)를 쓴다 */
export function getExaminationListErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "검사 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.code === "UNSUPPORTED_REQUEST" && error.status !== 400) return error.message;
  if (error.kind === "HTTP" && error.status !== 401 && error.code && LIST_ERROR_MESSAGES[error.code]) {
    return LIST_ERROR_MESSAGES[error.code];
  }
  return error.message;
}

// ── 검사 상태 변경 오류 안내 ──

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

// ── 검사 결과 등록 오류 안내 ──

const RESULT_CREATE_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "검사 결과 요약을 입력해 주세요.",
  INVALID_INPUT: "검사 정보 또는 입력값이 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  ACCESS_DENIED: "검사 결과는 검사기관 담당자만 등록할 수 있습니다.",
  EXAMINATION_RESULT_ACCESS_DENIED: "우리 기관이 수행한 검사만 결과를 등록할 수 있습니다.",
  EXAMINATION_NOT_FOUND: "검사 정보를 찾을 수 없습니다.",
  EXAMINATION_NOT_COMPLETED: "검사가 완료된 뒤에 결과를 등록할 수 있습니다. 최신 상태를 확인해 주세요.",
  EXAMINATION_RESULT_ALREADY_EXISTS: "이미 결과가 등록된 검사입니다.",
};

/** 결과 등록 실패 안내 문구. 401과 모르는 코드는 공통 문구(ApiError.message)를 쓴다 */
export function getExaminationResultErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "검사 결과를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && RESULT_CREATE_ERROR_MESSAGES[error.code]) {
    return RESULT_CREATE_ERROR_MESSAGES[error.code];
  }
  return error.message;
}
