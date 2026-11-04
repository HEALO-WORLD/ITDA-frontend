import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

/**
 * 장비 장애 조회 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 EquipmentIncidentController·EquipmentIncidentResponse·EquipmentIncidentDetailResponse·
 * IncidentReferralResponse·검색 조건을 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * - 백엔드는 Gateway가 만든 X-Institution-Id·X-Role로 범위를 정한다 (EXAMINER: 자기 기관, ADMIN: 전체, REQUESTER: 403).
 *   프론트는 기관 ID를 보내지 않는다 (institutionId 검색 조건은 ADMIN 전용이라 쓰지 않는다)
 * - 인증 헤더는 서버 전용 모듈(server.ts)이 `headers`로 넘긴다
 * ⚠️ origin/dev Gateway 정책에는 목록(ADMIN 전용)만 있고 상세·영향 의뢰 규칙이 없어 지금은 EXAMINER가 모두 403을 받는다.
 * ⚠️ 장애를 만드는 Consumer가 origin/dev에 없어 실제 목록은 비어 있을 수 있다.
 *
 * Mock 구현으로 대신하지 않는다: incidents가 API 대상이 아니거나 입력이 계약과 다르면 요청 없이 설정 오류,
 * 호출 실패는 ApiError 그대로, 응답 형태가 계약과 다르면 PARSE 오류로 던진다.
 */

/** 장애 상태. 백엔드 확정값은 OCCURRED 하나이고 추가 상태는 미확정이라 문자열로 받는다 */
export type EquipmentIncidentStatusDto = string;

/** 장애 목록 항목 (백엔드 EquipmentIncidentResponse, ID는 UUID, 시각은 시간대 표기 없는 LocalDateTime 문자열) */
export interface EquipmentIncidentDto {
  incidentId: string;
  equipmentId: string;
  institutionId: string;
  reason: string;
  status: EquipmentIncidentStatusDto;
  occurredAt: string;
  /** 장애 영향 구간 (이 구간과 겹치는 확정 예약이 영향 의뢰가 된다) */
  startAt: string;
  endAt: string;
  createdAt: string;
}

/** 장애 상세 (백엔드 EquipmentIncidentDetailResponse). completedCount는 후속 처리 SUCCEEDED 건수 */
export interface EquipmentIncidentDetailDto extends EquipmentIncidentDto {
  totalReferrals: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  processingCount: number;
  updatedAt: string;
}

/** 영향 의뢰 후속 처리 상태 (백엔드 IncidentProcessingStatus) */
export const INCIDENT_PROCESSING_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const;
export type IncidentProcessingStatusDto = (typeof INCIDENT_PROCESSING_STATUSES)[number];

/**
 * 영향 의뢰 처리 현황 항목 (백엔드 IncidentReferralResponse).
 * lastError(ADMIN 전용 내부 진단 정보)는 화면에 쓰지 않으므로 타입에 두지 않는다.
 */
export interface IncidentReferralDto {
  id: string;
  incidentId: string;
  referralId: string;
  reservationId: string;
  processingStatus: IncidentProcessingStatusDto;
  retryCount: number;
  nextRetryAt: string | null;
  lockedUntil: string | null;
  /** 처리 결과 코드. 값 목록 미확정이라 문자열 그대로 (성공 전에는 null) */
  resultCode: string | null;
  processedAt: string | null;
}

/** 백엔드가 받는 페이지 크기 (그 밖의 값은 서버가 조용히 10으로 바꾸므로 보내기 전에 막는다) */
export const INCIDENT_PAGE_SIZES = [10, 30, 50] as const;
export type IncidentPageSize = (typeof INCIDENT_PAGE_SIZES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

type RequestOptions = Pick<ApiRequestOptions, "headers" | "signal">;

function assertPage(page: number, size: number) {
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new ApiError("CONFIG", `페이지 번호가 올바르지 않습니다: ${page}`);
  }
  if (!(INCIDENT_PAGE_SIZES as readonly number[]).includes(size)) {
    throw new ApiError("CONFIG", `페이지 크기는 ${INCIDENT_PAGE_SIZES.join("·")} 중 하나여야 합니다: ${size}`);
  }
}

function assertUuid(value: string, label: string) {
  if (!isUuid(value)) throw new ApiError("CONFIG", `${label} 형식이 올바르지 않습니다: "${value}"`);
}

/** 장애 상태 값 (백엔드 EquipmentIncidentStatus, origin/dev c38ed96 기준 OCCURRED 하나) */
export const INCIDENT_STATUSES = ["OCCURRED"] as const;

/**
 * 장애 목록 `GET /api/v1/equipment-incidents?institutionId&equipmentId&status&page&size` (최신 발생순 고정).
 * institutionId·status는 관리자 화면에서만 넘긴다 (institutionId는 ADMIN 전용 조건: 검사기관은 서버가 자기 기관으로 정한다).
 */
export async function fetchIncidentPage(
  {
    page = 0,
    size = 10,
    equipmentId,
    institutionId,
    status,
  }: { page?: number; size?: IncidentPageSize; equipmentId?: string; institutionId?: string; status?: (typeof INCIDENT_STATUSES)[number] } = {},
  options: RequestOptions = {},
): Promise<PagedResponseDto<EquipmentIncidentDto>> {
  requireApiFeature("incidents");
  assertPage(page, size);
  if (equipmentId !== undefined) assertUuid(equipmentId, "장비 ID");
  if (institutionId !== undefined) assertUuid(institutionId, "기관 ID");
  if (status !== undefined && !(INCIDENT_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError("CONFIG", `장애 상태 값이 올바르지 않습니다: "${status}"`);
  }
  const data = await apiRequestData<unknown>("/api/v1/equipment-incidents", {
    ...options,
    query: { page, size, equipmentId, institutionId, status },
  });
  if (!isPage(data, isIncident)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

/** 장애 상세 `GET /api/v1/equipment-incidents/{incidentId}` */
export async function fetchIncidentDetail(
  incidentId: string,
  options: RequestOptions = {},
): Promise<EquipmentIncidentDetailDto> {
  requireApiFeature("incidents");
  assertUuid(incidentId, "장애 ID");
  const data = await apiRequestData<unknown>(`/api/v1/equipment-incidents/${encodeURIComponent(incidentId)}`, options);
  if (!isIncidentDetail(data) || data.incidentId.toLowerCase() !== incidentId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 영향 의뢰 처리 현황 `GET /api/v1/equipment-incidents/{incidentId}/referrals?status&page&size` (작업 생성순 고정) */
export async function fetchIncidentReferralPage(
  incidentId: string,
  {
    page = 0,
    size = 10,
    status,
  }: { page?: number; size?: IncidentPageSize; status?: IncidentProcessingStatusDto } = {},
  options: RequestOptions = {},
): Promise<PagedResponseDto<IncidentReferralDto>> {
  requireApiFeature("incidents");
  assertUuid(incidentId, "장애 ID");
  assertPage(page, size);
  if (status !== undefined && !INCIDENT_PROCESSING_STATUSES.includes(status)) {
    throw new ApiError("CONFIG", `후속 처리 상태 값이 올바르지 않습니다: "${status}"`);
  }
  const data = await apiRequestData<unknown>(
    `/api/v1/equipment-incidents/${encodeURIComponent(incidentId)}/referrals`,
    { ...options, query: { page, size, status } },
  );
  if (!isPage(data, isIncidentReferral)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

// ── 응답 형식 검증 (모르는 형태를 추측해 바꾸지 않는다) ──

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";
const isNullableTime = (value: unknown) => value === null || isNonEmptyString(value);
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

function isIncident(value: unknown): value is EquipmentIncidentDto {
  return (
    isRecord(value) &&
    isUuid(value.incidentId) &&
    isUuid(value.equipmentId) &&
    isUuid(value.institutionId) &&
    typeof value.reason === "string" &&
    isNonEmptyString(value.status) &&
    [value.occurredAt, value.startAt, value.endAt, value.createdAt].every(isNonEmptyString)
  );
}

function isIncidentDetail(value: unknown): value is EquipmentIncidentDetailDto {
  if (!isIncident(value)) return false;
  const detail = value as unknown as Record<string, unknown>;
  return (
    [detail.totalReferrals, detail.completedCount, detail.failedCount, detail.pendingCount, detail.processingCount].every(
      isCount,
    ) && isNonEmptyString(detail.updatedAt)
  );
}

function isIncidentReferral(value: unknown): value is IncidentReferralDto {
  return (
    isRecord(value) &&
    [value.id, value.incidentId, value.referralId, value.reservationId].every(isUuid) &&
    INCIDENT_PROCESSING_STATUSES.includes(value.processingStatus as IncidentProcessingStatusDto) &&
    isCount(value.retryCount) &&
    [value.nextRetryAt, value.lockedUntil, value.processedAt].every(isNullableTime) &&
    (value.resultCode === null || isNonEmptyString(value.resultCode))
  );
}

function isPage<T>(value: unknown, isItem: (item: unknown) => item is T): value is PagedResponseDto<T> {
  return (
    isRecord(value) &&
    Array.isArray(value.contents) &&
    value.contents.every(isItem) &&
    [value.totalElements, value.totalPages, value.size, value.number].every(isCount)
  );
}

// ── 오류 안내 ──

/** 백엔드·Gateway 오류 코드별 안내 (origin/dev 기준) */
const ERROR_MESSAGES: Record<string, string> = {
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  INVALID_INPUT: "장비 장애 조회 요청이 올바르지 않습니다.",
  VALIDATION_FAILED: "장비 장애 검색 조건이 올바르지 않습니다.",
  ACCESS_DENIED: "장비 장애는 검사기관 담당자만 조회할 수 있습니다.",
  EQUIPMENT_INCIDENT_ACCESS_DENIED: "장비 장애는 검사기관 담당자만 조회할 수 있습니다.",
  EQUIPMENT_INCIDENT_NOT_FOUND: "장비 장애를 찾을 수 없습니다. 우리 기관의 장애가 아니거나 삭제되었을 수 있습니다.",
};

const FALLBACK_MESSAGES = {
  list: "장비 장애 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  detail: "장비 장애 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  referrals: "영향받은 의뢰 처리 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

export type IncidentApiAction = keyof typeof FALLBACK_MESSAGES;

/**
 * 장비 장애 조회 실패 안내 문구.
 * 401(토큰 없음·만료)은 공통 문구(ApiError.message)를 쓰고, 400·403·404는 오류 코드로 원인을 구분한다.
 * 설정·응답 형식 오류는 내부 내용을 보여 주지 않고 기능별 문구를 쓴다.
 */
export function getIncidentErrorMessage(error: unknown, action: IncidentApiAction): string {
  if (!isApiError(error) || error.kind === "CONFIG" || error.kind === "PARSE") return FALLBACK_MESSAGES[action];
  if (error.kind === "HTTP" && error.status !== 401 && error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  return error.message;
}
