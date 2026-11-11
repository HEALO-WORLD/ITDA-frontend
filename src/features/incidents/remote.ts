import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";
import { compareInstants, parseOffsetDateTime } from "@/features/referrals/offsetDateTime";

import { DOWNTIME_REASON_MAX_LENGTH } from "./downtimeRules";

/**
 * 장비 장애 조회 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 EquipmentIncidentController·EquipmentIncidentResponse·EquipmentIncidentDetailResponse·
 * IncidentReferralResponse·검색 조건을 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * - 백엔드는 Gateway가 만든 X-Institution-Id·X-Role로 범위를 정한다 (EXAMINER: 자기 기관, ADMIN: 전체, REQUESTER: 403).
 *   프론트는 기관 ID를 보내지 않는다 (institutionId 검색 조건은 ADMIN 전용이라 쓰지 않는다)
 * - 인증 헤더는 서버 전용 모듈(server.ts)이 `headers`로 넘긴다
 * Gateway 정책(origin/dev 기준): 목록·현황 집계·상세·영향 의뢰 GET 모두 EXAMINER·ADMIN 허용 (REQUESTER는 403).
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
  /**
   * 검사기관 담당자의 수동 확인 필요 여부 (백엔드가 판단한 값을 그대로 쓴다).
   * 검사 진행 중 장비 장애로 자동 재조정에서 제외됐고 지금도 같은 예약의 검사가 진행 중이면 true.
   * 이 필드가 없던 이전 백엔드 응답도 받을 수 있도록 선택 값으로 둔다 (화면에는 IncidentReferralItem으로 넘긴다)
   */
  manualReviewRequired?: boolean;
}

/** 화면에 넘기는 영향 의뢰 항목: manualReviewRequired를 항상 boolean으로 채운다 (응답에 없으면 false) */
export type IncidentReferralItem = IncidentReferralDto & { manualReviewRequired: boolean };

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

/**
 * 장비 장애 현황 집계 (백엔드 EquipmentIncidentSummaryResponse). 세 건수는 같은 기관·같은 기준 시각(asOf)으로 계산한다.
 * - activeDowntimeEquipmentCount: 기준 시각에 등록된 중단 구간(시작 포함·종료 미포함)에 있는 장비 수. 실제 고장·복구 상태가 아니다
 * - affectedReferralCount: 전체 장애 이력에서 영향 대상으로 탐지된 의뢰 수 (누적)
 * - needsRescheduleReferralCount: 지금 재조정이 필요하고(NEEDS_RESCHEDULE) 가장 최근 차단 예약이 이 기관인 의뢰 수 (현재 상태)
 * 복구 완료 장애 수는 제공하지 않는다. 장애 이벤트(Kafka) 반영이 늦으면 Slot Service 원본과 잠시 다를 수 있다.
 */
export interface EquipmentIncidentSummaryDto {
  institutionId: string;
  /** 집계 기준 시각 (KST LocalDateTime 문자열, 시간대 표기 없음). Date로 바꾸지 않고 원본 그대로 둔다 */
  asOf: string;
  activeDowntimeEquipmentCount: number;
  affectedReferralCount: number;
  needsRescheduleReferralCount: number;
}

/**
 * 장비 장애 현황 `GET /api/v1/equipment-incidents/summary`.
 * 검사기관(EXAMINER) 전용 호출: institutionId 쿼리는 보내지 않는다 (백엔드가 Gateway의 X-Institution-Id로 자기 기관을 정하고,
 * 요청 값은 무시한다. 지정이 필요한 ADMIN 조회는 이 함수의 범위가 아니다). 인증 헤더는 다른 조회와 같이 options.headers로 받는다.
 */
export async function fetchIncidentSummary(options: RequestOptions = {}): Promise<EquipmentIncidentSummaryDto> {
  requireApiFeature("incidents");
  const data = await apiRequestData<unknown>("/api/v1/equipment-incidents/summary", options);
  if (!isIncidentSummary(data)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

// ── 응답 형식 검증 (모르는 형태를 추측해 바꾸지 않는다) ──

/** 백엔드 LocalDateTime 직렬화 형식 (초·소수 초는 생략될 수 있다. 시간대 표기 없음) */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;

/** LocalDateTime 문자열이 형식에 맞고 실제 있는 날짜·시각인지 (시간대 변환 없이 숫자만 확인) */
function isLocalDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !LOCAL_DATE_TIME.test(value)) return false;
  const [year, month, day, hour, minute, second = 0] = value.split(/[-T:.]/).slice(0, 6).map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59;
}

function isIncidentSummary(value: unknown): value is EquipmentIncidentSummaryDto {
  return (
    isRecord(value) &&
    isUuid(value.institutionId) &&
    isLocalDateTime(value.asOf) &&
    [value.activeDowntimeEquipmentCount, value.affectedReferralCount, value.needsRescheduleReferralCount].every(isCount)
  );
}

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
    (value.resultCode === null || isNonEmptyString(value.resultCode)) &&
    // 없으면(이전 백엔드) 통과, 있으면 boolean만 받는다 (null·문자열 등은 형식 오류)
    (value.manualReviewRequired === undefined || typeof value.manualReviewRequired === "boolean")
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
  summary: "장비 장애 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
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

// ── 장비 장애(중단) 등록 POST /api/v1/equipment-downtimes (slot-service) ──

/**
 * 백엔드 EquipmentDowntimeCreateRequest (로컬 itda feat/equipment-downtime 기준, dev 미병합).
 * 시각은 오프셋을 포함한 OffsetDateTime 문자열 (`+09:00`을 명시한다). 기관 ID·역할은 보내지 않는다 (Gateway가 JWT로 붙인다).
 */
export interface CreateEquipmentDowntimeRequestDto {
  equipmentId: string;
  startedAt: string;
  endedAt: string;
  reason: string;
}

/** 등록으로 상태를 유지한 HELD·BOOKED 슬롯 (예약·의뢰 후속 처리는 referral-service가 비동기로 한다) */
export interface DowntimeConflictedSlotDto {
  slotId: string;
  status: "HELD" | "BOOKED";
  reservationId: string | null;
}

/**
 * 백엔드 EquipmentDowntimeCreateResponse (201). id는 slot-service 중단 ID다:
 * referral-service 장애 조회 ID(incidentId)와 다르므로 장애 상세 조회에 쓰지 않는다.
 */
export interface EquipmentDowntimeCreateResponseDto {
  id: string;
  equipmentId: string;
  startedAt: string;
  endedAt: string;
  reason: string;
  /** 이번 등록으로 AVAILABLE → UNAVAILABLE이 된 슬롯 수 */
  affectedSlotCount: number;
  conflictedSlots: DowntimeConflictedSlotDto[];
}

const sameUuid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function sameInstant(a: unknown, b: string): boolean {
  const left = parseOffsetDateTime(a);
  const right = parseOffsetDateTime(b);
  return left !== null && right !== null && compareInstants(left, right) === 0;
}

function isConflictedSlot(value: unknown): value is DowntimeConflictedSlotDto {
  return (
    isRecord(value) &&
    isUuid(value.slotId) &&
    (value.status === "HELD" || value.status === "BOOKED") &&
    (value.reservationId === null || isUuid(value.reservationId))
  );
}

/** 응답이 계약 형태이고 이번 요청(장비·구간·사유)의 결과인지 (다르면 보정하지 않고 PARSE) */
export function isDowntimeCreateResponseOf(value: unknown, request: CreateEquipmentDowntimeRequestDto): value is EquipmentDowntimeCreateResponseDto {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.equipmentId) &&
    sameUuid(value.equipmentId, request.equipmentId) &&
    sameInstant(value.startedAt, request.startedAt) &&
    sameInstant(value.endedAt, request.endedAt) &&
    value.reason === request.reason &&
    isCount(value.affectedSlotCount) &&
    Array.isArray(value.conflictedSlots) &&
    value.conflictedSlots.every(isConflictedSlot)
  );
}

/**
 * 요청 전 검증 (UUID·OffsetDateTime·구간·사유). 통과하면 백엔드 필드만 담은 본문 (사유는 앞뒤 공백 제거).
 * 종료 > 현재 조건은 시각에 따라 바뀌므로 서버 처리(downtimeServer)가 화면 규칙으로 확인하고, 최종 판단은 백엔드가 한다.
 */
export function validateCreateDowntimeRequest(
  input: Record<keyof CreateEquipmentDowntimeRequestDto, unknown>,
): { ok: true; body: CreateEquipmentDowntimeRequestDto } | { ok: false; field: keyof CreateEquipmentDowntimeRequestDto; message: string } {
  if (!isUuid(input.equipmentId)) return { ok: false, field: "equipmentId", message: "장비 정보가 올바르지 않습니다." };
  const start = parseOffsetDateTime(input.startedAt);
  if (!start) return { ok: false, field: "startedAt", message: "장애 시작 일시 형식이 올바르지 않습니다." };
  const end = parseOffsetDateTime(input.endedAt);
  if (!end) return { ok: false, field: "endedAt", message: "장애 종료 예정 일시 형식이 올바르지 않습니다." };
  if (compareInstants(start, end) >= 0) return { ok: false, field: "endedAt", message: "종료 예정 일시는 장애 시작 일시 이후여야 합니다." };
  if (typeof input.reason !== "string" || input.reason.trim() === "") return { ok: false, field: "reason", message: "장애 사유를 입력해 주세요." };
  const reason = input.reason.trim();
  if (reason.length > DOWNTIME_REASON_MAX_LENGTH) return { ok: false, field: "reason", message: `장애 사유는 ${DOWNTIME_REASON_MAX_LENGTH}자 이하로 입력해 주세요.` };
  return { ok: true, body: { equipmentId: input.equipmentId, startedAt: input.startedAt as string, endedAt: input.endedAt as string, reason } };
}

/**
 * 장비 장애(중단) 등록 `POST /api/v1/equipment-downtimes` (201). Gateway: EXAMINER·ADMIN.
 * 백엔드: EXAMINER는 자기 기관 장비만(아니면 403), 겹치는 중단이 있으면 409 DOWNTIME_OVERLAP.
 * 공통 클라이언트는 재시도하지 않는다. 멱등 키가 없으므로 NETWORK·TIMEOUT·PARSE·5xx 뒤에는 자동으로 다시 보내지 않는다.
 */
export async function createEquipmentDowntime(
  input: Record<keyof CreateEquipmentDowntimeRequestDto, unknown>,
  options: RequestOptions = {},
): Promise<EquipmentDowntimeCreateResponseDto> {
  requireApiFeature("incidents");
  const checked = validateCreateDowntimeRequest(input);
  if (!checked.ok) throw new ApiError("CONFIG", checked.message);
  const data = await apiRequestData<unknown>("/api/v1/equipment-downtimes", { ...options, method: "POST", body: checked.body });
  if (!isDowntimeCreateResponseOf(data, checked.body)) {
    throw new ApiError("PARSE", "장애 등록 결과를 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 장애 등록 실패 분류 */
export type DowntimeCreateFailureReason =
  | "NOT_SENT"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  /** 409 DOWNTIME_OVERLAP: 같은 장비에 기간이 겹치는 중단이 이미 있음 (앞서 보낸 등록일 수도 있다) */
  | "OVERLAP"
  | "CONFLICT"
  /** 502·503 REFERENCE_*: 기관 서비스 확인 실패. 저장 전 단계라 등록되지 않았다 */
  | "REFERENCE_UNAVAILABLE"
  /** 그 밖의 5xx: 처리 여부를 알 수 없다 */
  | "SERVER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE";

/** 등록됐을 수 있어 목록 확인이 필요한 실패 (자동 재전송 금지) */
export const DOWNTIME_CREATE_UNCERTAIN: ReadonlySet<DowntimeCreateFailureReason> = new Set(["SERVER_ERROR", "NETWORK", "TIMEOUT", "INVALID_RESPONSE"]);

const UNCERTAIN_MESSAGE =
  "등록 결과를 확인하지 못했습니다. 이미 등록되었을 수 있으니 다시 등록하기 전에 장애 목록을 새로고침해 확인해 주세요. (장애 목록 반영에는 시간이 걸릴 수 있습니다)";

export function getDowntimeCreateFailure(error: unknown): { reason: DowntimeCreateFailureReason; message: string; field?: "startedAt" | "endedAt" | "reason" | "equipmentId" } {
  if (!isApiError(error)) return { reason: "SERVER_ERROR", message: UNCERTAIN_MESSAGE };
  switch (error.kind) {
    case "CONFIG":
      return { reason: "NOT_SENT", message: error.message };
    case "NETWORK":
    case "ABORTED":
      return { reason: "NETWORK", message: UNCERTAIN_MESSAGE };
    case "TIMEOUT":
      return { reason: "TIMEOUT", message: UNCERTAIN_MESSAGE };
    case "PARSE":
      return { reason: "INVALID_RESPONSE", message: UNCERTAIN_MESSAGE };
    case "HTTP": {
      const status = error.status ?? 0;
      const code = error.code;
      if (status === 400) {
        if (code === "DOWNTIME_INVALID_TIME_RANGE") return { reason: "INVALID_REQUEST", field: "endedAt", message: "종료 예정 일시는 장애 시작 일시 이후여야 합니다." };
        if (code === "DOWNTIME_END_NOT_FUTURE") return { reason: "INVALID_REQUEST", field: "endedAt", message: "종료 예정 일시는 현재 시각 이후여야 합니다. 종료 예정 일시를 다시 입력해 주세요." };
        if (code === "MISSING_HEADER") return { reason: "UNAUTHORIZED", message: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요." };
        return { reason: "INVALID_REQUEST", message: "입력값이 올바르지 않습니다. 장비·시각·사유를 확인해 주세요." };
      }
      if (status === 401) return { reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
      if (status === 403) return { reason: "FORBIDDEN", message: "장비 장애를 등록할 권한이 없거나 우리 기관 장비가 아닙니다." };
      if (status === 404) return { reason: "NOT_FOUND", message: "장비를 찾을 수 없습니다. 장비 목록을 새로고침해 주세요." };
      if (status === 409) {
        return code === "DOWNTIME_OVERLAP"
          ? {
              reason: "OVERLAP",
              message: "같은 장비에 기간이 겹치는 장애가 이미 등록되어 있어 등록하지 않았습니다. 앞서 보낸 등록이 처리되었을 수 있으니 장애 목록을 확인해 주세요.",
            }
          : { reason: "CONFLICT", message: "현재 상태에서는 장애를 등록할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
      }
      if ((status === 502 || status === 503) && (code === "REFERENCE_SERVICE_UNAVAILABLE" || code === "REFERENCE_RESPONSE_INVALID")) {
        return { reason: "REFERENCE_UNAVAILABLE", message: "장비 소속을 확인하지 못해 장애를 등록하지 않았습니다. 잠시 후 다시 시도해 주세요." };
      }
      return { reason: "SERVER_ERROR", message: UNCERTAIN_MESSAGE };
    }
  }
}
