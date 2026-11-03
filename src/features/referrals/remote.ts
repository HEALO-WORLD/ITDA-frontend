import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

import type { ReferralDisplayStatus } from "./types";

/**
 * 의뢰 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 ReferralController·ReferralSearchCondition·ReferralResponse를 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * 의뢰 목록 조회는 API 연결 함수다 (`referrals` 기능을 API 대상으로 골랐을 때만 호출할 수 있다).
 * 화면(api.ts의 getRecentReferrals)은 아직 이 함수를 쓰지 않는다: 목록 응답에 화면 표가 쓰는
 * 의뢰번호·검사기관·검사 유형명·검사 일시가 없어 기관 API 완성 후 연결한다.
 * 재조정 필요 목록(재조정·알림 화면)은 fetchRescheduleReferralPage·fetchExamTypePage를,
 * 선택한 의뢰의 기존 예약 상세는 fetchReservation을 쓴다 (server.ts).
 * 재예약 요청 requestReschedule은 통신 계층만 있다 (화면·Server Action에는 아직 연결하지 않았다).
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-User-Id·X-Institution-Id·X-Role을 붙인다.
 * 프론트는 이 X- 헤더들을 만들지 않는다 (Gateway가 바깥에서 온 값을 지운다).
 * 토큰 전달은 로그인 연동 후 서버 전용 모듈에서 `headers`로 넘긴다. 그 전에는 호출하면 401이다.
 */

/** 백엔드 ReferralStatus. 표기를 바꾸지 않는다 (CANCELED는 L 하나) */
export type ReferralStatusDto = "PENDING" | "CONFIRMED" | "FAILED" | "CANCELED" | "NEEDS_RESCHEDULE";

/** 백엔드 ReferralResponse (ID는 UUID 문자열) */
export interface ReferralResponseDto {
  id: string;
  referringInstitutionId: string;
  referrerId: string;
  examTypeId: string;
  /** 현재 예약 시도 ID. 예약 전이면 null */
  currentReservationId: string | null;
  referralStatus: ReferralStatusDto;
  patientName: string;
}

/**
 * 의뢰 목록 조회 조건 (백엔드 ReferralSearchCondition).
 * 조회 범위는 서버가 정한다: 관리자가 아니면 요청자 소속 기관(X-Institution-Id)의 의뢰만 온다.
 */
export interface ReferralListParams {
  status?: ReferralStatusDto;
  /** 관리자 전용 필터 */
  referringInstitutionId?: string;
  /** 본인 ID를 넣으면 내가 작성한 의뢰만 */
  referrerId?: string;
  examTypeId?: string;
  /** 부분 일치 */
  patientName?: string;
  /** 0부터. 음수·누락이면 서버가 0으로 본다 */
  page?: number;
  /** 10·30·50만 허용. 그 외 값은 서버가 10으로 바꾼다 */
  size?: 10 | 30 | 50;
  /** 누락·허용 외 값이면 서버 기본값 createdAt,desc */
  sort?: `${"createdAt" | "updatedAt"},${"asc" | "desc"}`;
}

/**
 * 의뢰 목록 조회 `GET /api/v1/referrals`.
 * Gateway 권한(origin/dev 기준): REQUESTER·ADMIN만 허용, 그 외 역할은 403.
 * Mock 구현이 없으므로 referrals가 API 대상이 아니면 설정 오류이고, 호출 실패는 그대로 ApiError로 던진다.
 */
export async function fetchReferralPage(
  params: ReferralListParams = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ReferralResponseDto>> {
  requireApiFeature("referrals");
  return apiRequestData<PagedResponseDto<ReferralResponseDto>>("/api/v1/referrals", {
    ...options,
    query: { ...params },
  });
}

/**
 * 백엔드 의뢰 상태 → 화면 표시 상태.
 * FAILED(예약 실패)는 화면에 대응하는 상태가 없어 null을 돌려준다 (표시 방식은 화면 기획 확인 후 정한다).
 */
export function toReferralDisplayStatus(status: ReferralStatusDto): ReferralDisplayStatus | null {
  switch (status) {
    case "PENDING":
      return "PROCESSING";
    case "CONFIRMED":
      return "CONFIRMED";
    case "NEEDS_RESCHEDULE":
      return "RESCHEDULE_REQUIRED";
    case "CANCELED":
      return "CANCELLED";
    case "FAILED":
      return null;
  }
}

// ── 재조정 필요 목록용 조회 (응답 형식 검증 포함) ──

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERRAL_STATUSES: readonly ReferralStatusDto[] = ["PENDING", "CONFIRMED", "FAILED", "CANCELED", "NEEDS_RESCHEDULE"];

/** 백엔드가 받는 의뢰 목록 페이지 크기 (그 밖의 값은 서버가 조용히 10으로 바꾸므로 보내기 전에 막는다) */
export const REFERRAL_PAGE_SIZES = [10, 30, 50] as const;

/**
 * 재조정 필요 의뢰 목록 `GET /api/v1/referrals?status=NEEDS_RESCHEDULE&page&size`.
 * 조회 범위(요청자 소속 기관)는 Gateway의 X-Institution-Id로 서버가 정한다. 사용자·기관 ID는 보내지 않는다.
 * 요청 전 검증에 걸리면 설정 오류, 응답이 계약과 다르면(모르는 상태값·UUID가 아닌 ID 등) PARSE 오류로 던진다.
 */
export async function fetchRescheduleReferralPage(
  { page = 0, size = 10 }: { page?: number; size?: (typeof REFERRAL_PAGE_SIZES)[number] } = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ReferralResponseDto>> {
  requireApiFeature("referrals");
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new ApiError("CONFIG", `의뢰 목록 페이지 번호가 올바르지 않습니다: ${page}`);
  }
  if (!REFERRAL_PAGE_SIZES.includes(size)) {
    throw new ApiError("CONFIG", `의뢰 목록 페이지 크기는 ${REFERRAL_PAGE_SIZES.join("·")} 중 하나여야 합니다: ${size}`);
  }
  const data = await apiRequestData<unknown>("/api/v1/referrals", {
    ...options,
    query: { status: "NEEDS_RESCHEDULE", page, size },
  });
  if (!isPage(data, isReferralResponse)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.");
  }
  return data;
}

/**
 * 의뢰 단건 조회 `GET /api/v1/referrals/{referralId}` (Gateway: 로그인 사용자 전체).
 * 범위는 서버가 정한다: 의뢰기관 소속(X-Institution-Id)이거나 관리자가 아니면 404 REFERRAL_NOT_FOUND (작성자 본인 여부는 보지 않는다).
 * UUID가 아니면 요청하지 않고 설정 오류, 응답이 계약과 다르거나 다른 의뢰면 PARSE 오류로 던진다.
 */
export async function fetchReferral(
  referralId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ReferralResponseDto> {
  requireApiFeature("referrals");
  if (!isUuid(referralId)) {
    throw new ApiError("CONFIG", "의뢰 ID 형식이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/referrals/${referralId}`, options);
  if (!isReferralResponse(data) || data.id.toLowerCase() !== referralId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 검사 유형 (백엔드 ExamTypeResponse). 기관과 무관한 전체 목록이다 */
export interface ExamTypeDto {
  id: string;
  name: string;
  /** 백엔드 Modality enum 값 (값 목록은 화면에서 해석하지 않는다) */
  modality: string;
  durationMinutes: number;
}

/** 백엔드가 받는 검사 유형 페이지 크기 상한 (1~100, 벗어나면 400) */
export const EXAM_TYPE_PAGE_SIZE_MAX = 100;

/**
 * 검사 유형 목록 `GET /api/v1/exam-types?page&size` (Gateway: REQUESTER·EXAMINER).
 * 의뢰 응답의 examTypeId를 표시명으로 바꾸는 데만 쓴다. 응답이 계약과 다르면 PARSE 오류로 던진다.
 */
export async function fetchExamTypePage(
  page: number,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ExamTypeDto>> {
  requireApiFeature("referrals");
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new ApiError("CONFIG", `검사 유형 페이지 번호가 올바르지 않습니다: ${page}`);
  }
  const data = await apiRequestData<unknown>("/api/v1/exam-types", {
    ...options,
    query: { page, size: EXAM_TYPE_PAGE_SIZE_MAX },
  });
  if (!isPage(data, isExamType)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.");
  }
  return data;
}

/** 백엔드 ReservationStatus */
export type ReservationStatusDto = "REQUESTED" | "HELD" | "CONFIRMED" | "FAILED" | "BLOCKED" | "CANCELED";
/** 백엔드 FailureReason */
export type FailureReasonDto = "SLOT_CONFLICT" | "CONFIRM_FAILED" | "HOLD_EXPIRED" | "EQUIPMENT_FAILURE";

const RESERVATION_STATUSES: readonly ReservationStatusDto[] = ["REQUESTED", "HELD", "CONFIRMED", "FAILED", "BLOCKED", "CANCELED"];
const FAILURE_REASONS: readonly FailureReasonDto[] = ["SLOT_CONFLICT", "CONFIRM_FAILED", "HOLD_EXPIRED", "EQUIPMENT_FAILURE"];
/** Java LocalDateTime 직렬화 문자열 (시간대 표기 없음, 초·소수 초는 생략될 수 있다) */
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;

/** 백엔드 ReservationResponse (ID는 UUID, 시각은 시간대 표기 없는 LocalDateTime 문자열) */
export interface ReservationResponseDto {
  id: string;
  referralId: string;
  attemptNo: number;
  slotId: string;
  examInstitutionId: string;
  equipmentId: string;
  examDate: string;
  startTime: string;
  endTime: string;
  reservationStatus: ReservationStatusDto;
  /** 실패·차단된 예약만 값이 있다 */
  failureReason: FailureReasonDto | null;
  confirmedAt: string | null;
  endedAt: string | null;
}

/** URL 등 외부 입력의 의뢰·예약 ID 검증 (UUID) */
export const isReferralApiId = (value: unknown): value is string => isUuid(value);

/**
 * 예약 단건 조회 `GET /api/v1/referrals/reservations/{reservationId}` (Gateway: 로그인 사용자 전체).
 * 범위는 서버가 정한다: 의뢰기관·검사기관 소속이거나 관리자가 아니면 404 RESERVATION_NOT_FOUND (403이 아니다).
 * UUID가 아니면 요청하지 않고 설정 오류, 응답이 계약과 다르거나 다른 예약이면 PARSE 오류로 던진다.
 */
export async function fetchReservation(
  reservationId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ReservationResponseDto> {
  requireApiFeature("referrals");
  if (!isUuid(reservationId)) {
    throw new ApiError("CONFIG", "예약 ID 형식이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/referrals/reservations/${reservationId}`, options);
  if (!isReservationResponse(data) || data.id.toLowerCase() !== reservationId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.");
  }
  return data;
}

// ── 재예약 요청 (STEP 4A: 통신 계층만. 화면·Server Action 연결 전) ──

/**
 * 백엔드 CreateReservationRequest (재예약 본문). 모든 필드 필수.
 * 시각은 시간대 없는 LocalDateTime 문자열(`YYYY-MM-DDTHH:mm[:ss[.fffffffff]]`)을 그대로 보낸다 (UTC 등으로 바꾸지 않는다).
 */
export interface RescheduleRequestDto {
  slotId: string;
  examInstitutionId: string;
  equipmentId: string;
  /** 백엔드 필드명은 examDate지만 타입은 LocalDateTime이다 (예시 값은 startTime과 같다) */
  examDate: string;
  startTime: string;
  endTime: string;
}

export type RescheduleRequestField = keyof RescheduleRequestDto;

/**
 * 재예약 요청 값 검증 (요청 전). 통과하면 백엔드 DTO 필드만 담은 본문을 돌려준다 (다른 속성은 버린다).
 * - ID 3개: UUID
 * - 시각 3개: 시간대 없는 LocalDateTime 형식이고 실제 있는 날짜·시각
 * - startTime < endTime (백엔드는 검사하지 않지만 슬롯 시간이 뒤집힌 요청은 보내지 않는다)
 */
export function validateRescheduleRequest(
  input: Record<RescheduleRequestField, unknown>,
): { ok: true; body: RescheduleRequestDto } | { ok: false; field: RescheduleRequestField; message: string } {
  for (const field of ["slotId", "examInstitutionId", "equipmentId"] as const) {
    if (!isUuid(input[field])) return { ok: false, field, message: `${RESCHEDULE_FIELD_LABELS[field]} 형식이 올바르지 않습니다.` };
  }
  for (const field of ["examDate", "startTime", "endTime"] as const) {
    if (!isValidLocalDateTime(input[field])) {
      return { ok: false, field, message: `${RESCHEDULE_FIELD_LABELS[field]} 형식이 올바르지 않습니다.` };
    }
  }
  const body: RescheduleRequestDto = {
    slotId: input.slotId as string,
    examInstitutionId: input.examInstitutionId as string,
    equipmentId: input.equipmentId as string,
    examDate: input.examDate as string,
    startTime: input.startTime as string,
    endTime: input.endTime as string,
  };
  if (toComparableDateTime(body.startTime) >= toComparableDateTime(body.endTime)) {
    return { ok: false, field: "endTime", message: "검사 종료 시간은 시작 시간보다 뒤여야 합니다." };
  }
  return { ok: true, body };
}

const RESCHEDULE_FIELD_LABELS: Record<RescheduleRequestField, string> = {
  slotId: "슬롯 ID",
  examInstitutionId: "검사기관 ID",
  equipmentId: "장비 ID",
  examDate: "검사 일자",
  startTime: "검사 시작 시간",
  endTime: "검사 종료 시간",
};

/**
 * 재예약 요청 `POST /api/v1/referrals/{referralId}/reschedule` (201, 응답 ReservationResponse).
 * Gateway 권한(origin/dev f6a0ad5 기준): REQUESTER·ADMIN. 서버가 의뢰 작성자 본인(X-User-Id)인지와
 * NEEDS_RESCHEDULE 상태인지 검사한다 (본인이 아니면 404 REFERRAL_NOT_FOUND, 상태가 다르면 409 INVALID_REFERRAL_STATUS).
 * 슬롯 확보(HOLD)는 서버가 비동기로 이어서 처리하므로 응답 예약은 REQUESTED 상태다.
 *
 * 요청 전 검증에 걸리면 요청하지 않고 설정 오류, 응답이 계약과 다르거나 요청과 다른 예약이면 PARSE 오류로 던진다.
 * 공통 클라이언트는 재시도하지 않는다. NETWORK·TIMEOUT·PARSE는 서버가 이미 접수했을 수 있으므로 다시 보내기 전에 목록을 확인해야 한다.
 */
export async function requestReschedule(
  referralId: string,
  input: Record<RescheduleRequestField, unknown>,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ReservationResponseDto> {
  requireApiFeature("referrals");
  if (!isUuid(referralId)) {
    throw new ApiError("CONFIG", "의뢰 ID 형식이 올바르지 않습니다.");
  }
  const checked = validateRescheduleRequest(input);
  if (!checked.ok) {
    throw new ApiError("CONFIG", checked.message);
  }
  const data = await apiRequestData<unknown>(`/api/v1/referrals/${referralId}/reschedule`, {
    ...options,
    method: "POST",
    body: checked.body,
  });
  if (!isReservationResponse(data) || !isRescheduledReservationOf(data, referralId, checked.body)) {
    throw new ApiError("PARSE", "재예약 요청 결과를 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 응답 예약이 이번 요청으로 만든 예약인지 (의뢰·슬롯·기관·장비가 같고 시각이 같은 순간인지) */
function isRescheduledReservationOf(data: ReservationResponseDto, referralId: string, body: RescheduleRequestDto): boolean {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    same(data.referralId, referralId) &&
    same(data.slotId, body.slotId) &&
    same(data.examInstitutionId, body.examInstitutionId) &&
    same(data.equipmentId, body.equipmentId) &&
    toComparableDateTime(data.examDate) === toComparableDateTime(body.examDate) &&
    toComparableDateTime(data.startTime) === toComparableDateTime(body.startTime) &&
    toComparableDateTime(data.endTime) === toComparableDateTime(body.endTime)
  );
}

/** 재예약 실패 분류 (다음 단계의 Server Action·화면 분기용) */
export type RescheduleFailureReason =
  /** 요청하지 않음: 기능 꺼짐·Mock 모드·요청 값 오류 */
  | "NOT_SENT"
  /** 400: 서버 검증 실패(VALIDATION_FAILED)·형식 오류(INVALID_INPUT)·헤더 누락(MISSING_HEADER) */
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  /** 403: Gateway 역할 거부 (EXAMINER 등) */
  | "FORBIDDEN"
  /** 404: 의뢰 없음 또는 작성자 본인이 아님 (REFERRAL_NOT_FOUND) */
  | "NOT_FOUND"
  /** 409: 재조정 필요 상태가 아님 (INVALID_REFERRAL_STATUS, 이미 재예약했거나 상태가 바뀜) */
  | "CONFLICT"
  | "SERVER_ERROR"
  /** 응답을 받지 못함 (연결 실패·시간 초과). 서버가 접수했을 수 있다 */
  | "NETWORK"
  /** 응답 형식 오류. 2xx였다면 접수됐을 수 있다 */
  | "INVALID_RESPONSE";

export function getRescheduleFailureReason(error: unknown): RescheduleFailureReason {
  if (!isApiError(error)) return "SERVER_ERROR";
  switch (error.kind) {
    case "CONFIG":
      return "NOT_SENT";
    case "NETWORK":
    case "TIMEOUT":
    case "ABORTED":
      return "NETWORK";
    case "PARSE":
      return "INVALID_RESPONSE";
    case "HTTP":
      if (error.status === 400) return "INVALID_REQUEST";
      if (error.status === 401) return "UNAUTHORIZED";
      if (error.status === 403) return "FORBIDDEN";
      if (error.status === 404) return "NOT_FOUND";
      if (error.status === 409) return "CONFLICT";
      return "SERVER_ERROR";
  }
}

/** 재예약 오류 코드별 안내 (백엔드 ErrorCode·Gateway 코드 기준) */
const RESCHEDULE_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "재예약 요청 값이 올바르지 않습니다. 슬롯을 다시 선택해 주세요.",
  INVALID_INPUT: "재예약 요청 형식이 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  ACCESS_DENIED: "재예약은 의뢰기관 담당자만 요청할 수 있습니다.",
  REFERRAL_NOT_FOUND: "의뢰를 찾을 수 없거나 재예약을 요청할 수 있는 의뢰가 아닙니다.",
  INVALID_REFERRAL_STATUS: "재조정이 필요한 상태가 아니어서 재예약할 수 없습니다. 목록을 새로 고쳐 상태를 확인해 주세요.",
};

const RESCHEDULE_UNKNOWN_RESULT_MESSAGE =
  "재예약 요청 결과를 확인하지 못했습니다. 이미 접수되었을 수 있으니 목록을 새로 고쳐 확인한 뒤 다시 시도해 주세요.";

export function getRescheduleErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "재예약을 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  const reason = getRescheduleFailureReason(error);
  if (reason === "NETWORK" || reason === "INVALID_RESPONSE") return RESCHEDULE_UNKNOWN_RESULT_MESSAGE;
  if (error.kind === "HTTP" && error.status !== 401 && error.code && RESCHEDULE_ERROR_MESSAGES[error.code]) {
    return RESCHEDULE_ERROR_MESSAGES[error.code];
  }
  return error.message;
}

/** LocalDateTime 문자열이 형식에 맞고 실제 있는 날짜·시각인지 (시간대 변환 없이 숫자만 확인) */
function isValidLocalDateTime(value: unknown): value is string {
  if (!isLocalDateTime(value)) return false;
  const [year, month, day, hour, minute, second = 0] = value.split(/[-T:.]/).slice(0, 6).map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59;
}

/** 비교용으로 초·소수 초를 채운 `YYYY-MM-DDTHH:mm:ss.fffffffff` (시간대 변환 없음) */
function toComparableDateTime(value: string): string {
  const [dateTime, fraction = ""] = value.split(".");
  return `${dateTime.length === 16 ? `${dateTime}:00` : dateTime}.${fraction.padEnd(9, "0")}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const isLocalDateTime = (value: unknown): value is string => typeof value === "string" && LOCAL_DATE_TIME_PATTERN.test(value);

function isReservationResponse(value: unknown): value is ReservationResponseDto {
  if (!isRecord(value)) return false;
  return (
    isUuid(value.id) &&
    isUuid(value.referralId) &&
    Number.isInteger(value.attemptNo) &&
    isUuid(value.slotId) &&
    isUuid(value.examInstitutionId) &&
    isUuid(value.equipmentId) &&
    isLocalDateTime(value.examDate) &&
    isLocalDateTime(value.startTime) &&
    isLocalDateTime(value.endTime) &&
    RESERVATION_STATUSES.includes(value.reservationStatus as ReservationStatusDto) &&
    (value.failureReason === null || FAILURE_REASONS.includes(value.failureReason as FailureReasonDto)) &&
    (value.confirmedAt === null || isLocalDateTime(value.confirmedAt)) &&
    (value.endedAt === null || isLocalDateTime(value.endedAt))
  );
}

function isReferralResponse(value: unknown): value is ReferralResponseDto {
  if (!isRecord(value)) return false;
  return (
    isUuid(value.id) &&
    isUuid(value.referringInstitutionId) &&
    isUuid(value.referrerId) &&
    isUuid(value.examTypeId) &&
    (value.currentReservationId === null || isUuid(value.currentReservationId)) &&
    REFERRAL_STATUSES.includes(value.referralStatus as ReferralStatusDto) &&
    typeof value.patientName === "string"
  );
}

function isExamType(value: unknown): value is ExamTypeDto {
  if (!isRecord(value)) return false;
  return (
    isUuid(value.id) &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    typeof value.modality === "string" &&
    typeof value.durationMinutes === "number"
  );
}

function isPage<T>(value: unknown, isItem: (item: unknown) => item is T): value is PagedResponseDto<T> {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.contents) &&
    value.contents.every(isItem) &&
    [value.totalElements, value.totalPages, value.size, value.number].every(Number.isInteger)
  );
}

/** 재조정 목록 조회 오류 코드별 안내 (401과 모르는 코드는 공통 문구) */
const RESCHEDULE_LIST_ERROR_MESSAGES: Record<string, string> = {
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  INVALID_INPUT: "재조정 목록 조회 조건이 올바르지 않습니다.",
  ACCESS_DENIED: "재조정 필요 목록은 의뢰기관 담당자만 조회할 수 있습니다.",
};

/** 의뢰 단건 조회 오류 코드별 안내 */
const REFERRAL_DETAIL_ERROR_MESSAGES: Record<string, string> = {
  REFERRAL_NOT_FOUND: "의뢰를 찾을 수 없거나 조회할 수 있는 기관의 의뢰가 아닙니다.",
  INVALID_INPUT: "의뢰 ID가 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  ACCESS_DENIED: "의뢰 정보를 조회할 권한이 없습니다.",
};

export function getReferralDetailErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "의뢰 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && REFERRAL_DETAIL_ERROR_MESSAGES[error.code]) {
    return REFERRAL_DETAIL_ERROR_MESSAGES[error.code];
  }
  return error.message;
}

/** 예약 단건 조회 오류 코드별 안내 */
const RESERVATION_ERROR_MESSAGES: Record<string, string> = {
  RESERVATION_NOT_FOUND: "예약 정보를 찾을 수 없거나 조회할 수 있는 기관의 예약이 아닙니다.",
  INVALID_INPUT: "예약 ID가 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  ACCESS_DENIED: "예약 정보를 조회할 권한이 없습니다.",
};

export function getReservationErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && RESERVATION_ERROR_MESSAGES[error.code]) {
    return RESERVATION_ERROR_MESSAGES[error.code];
  }
  return error.message;
}

export function getRescheduleListErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "재조정 필요 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && RESCHEDULE_LIST_ERROR_MESSAGES[error.code]) {
    return RESCHEDULE_LIST_ERROR_MESSAGES[error.code];
  }
  return error.message;
}
