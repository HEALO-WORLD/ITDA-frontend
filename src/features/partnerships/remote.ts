import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";

import { isPartnershipStatus, type PartnershipStatus } from "./types";

/**
 * 기관 협약 실제 API (institution-service, Gateway 경유).
 * - GET   /api/v1/partnerships/me[?status]        내 기관 협약 (REQUESTER·EXAMINER, 범위: 로그인 기관)
 * - POST  /api/v1/partnerships {examInstitutionId} 협약 요청 (REQUESTER. 요청 기관 ID는 보내지 않는다: 서버가 로그인 기관을 쓴다)
 * - PATCH /api/v1/partnerships/{id}/approve·reject 승인·거절 (EXAMINER, 요청받은 검사기관만, PENDING만)
 * - PATCH /api/v1/partnerships/{id}/terminate      종료 (REQUESTER·EXAMINER·ADMIN, 당사자만, ACTIVE만)
 * - GET   /api/v1/institutions/public             활성·미삭제 기관 (공개)
 * 다른 기관 협약 ID를 넣어도 서비스가 403으로 막는다. 응답이 계약과 다르면 PARSE (Mock으로 대체하지 않는다).
 *
 * referrals/remote.ts의 fetchMyPartnerships는 의뢰 화면의 검사기관 이름 표시용(필드 일부, referrals 기능)으로 그대로 둔다.
 * 협약 관리 화면은 날짜·상태까지 엄격히 확인하는 이 모듈을 쓴다.
 */

type RequestOptions = Pick<ApiRequestOptions, "headers" | "signal">;

export type PartnerInstitutionType = "REQUESTER" | "EXAM" | "PLATFORM";

/** 내 기관 협약 한 건 (MyPartnershipResponse). 날짜는 시간대 표기 없는 LocalDateTime(한국 시간) */
export interface MyPartnershipItemDto {
  partnershipId: string;
  partnerInstitutionId: string;
  partnerInstitutionName: string;
  partnerInstitutionType: PartnerInstitutionType;
  status: PartnershipStatus;
  requestedAt: string;
  approvedAt: string | null;
  terminatedAt: string | null;
}

/** 쓰기 응답 (PartnershipResponse) */
export interface PartnershipDto {
  id: string;
  requesterInstitutionId: string;
  examInstitutionId: string;
  status: PartnershipStatus;
  requestedAt: string;
  approvedAt: string | null;
  terminatedAt: string | null;
}

/** 공개 기관 (PublicInstitutionResponse) */
export interface PublicInstitutionDto {
  id: string;
  name: string;
  type: "REQUESTER" | "EXAM";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPartnershipEntityId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/** 내 기관 협약 목록 (페이지 없이 전체가 온다) */
export async function fetchMyPartnershipList(
  { status }: { status?: PartnershipStatus } = {},
  options: RequestOptions = {},
): Promise<MyPartnershipItemDto[]> {
  requireApiFeature("partnerships");
  if (status !== undefined && !isPartnershipStatus(status)) throw new ApiError("CONFIG", "협약 상태 조건이 올바르지 않습니다.");
  const data = await apiRequestData<unknown>("/api/v1/partnerships/me", { ...options, query: status ? { status } : undefined });
  if (!Array.isArray(data) || !data.every(isMyPartnershipItem)) throw parseError(data);
  if (status && data.some((item) => item.status !== status)) throw parseError(data);
  return data;
}

/** 공개 기관 목록 (활성·미삭제) */
export async function fetchPublicInstitutions(options: RequestOptions = {}): Promise<PublicInstitutionDto[]> {
  requireApiFeature("partnerships");
  const data = await apiRequestData<unknown>("/api/v1/institutions/public", options);
  if (!Array.isArray(data) || !data.every(isPublicInstitution)) throw parseError(data);
  return data;
}

/** 협약 요청. 응답이 이 검사기관에 대한 PENDING 협약이어야 성공으로 본다 (재요청이면 기존 협약 ID가 그대로 온다) */
export async function requestPartnership(examInstitutionId: string, options: RequestOptions = {}): Promise<PartnershipDto> {
  requireApiFeature("partnerships");
  assertId(examInstitutionId, "검사기관 ID");
  const data = await apiRequestData<unknown>("/api/v1/partnerships", { ...options, method: "POST", body: { examInstitutionId } });
  if (!isPartnership(data) || data.examInstitutionId.toLowerCase() !== examInstitutionId.toLowerCase() || data.status !== "PENDING") throw parseError(data);
  return data;
}

export type PartnershipTransition = "approve" | "reject" | "terminate";
const EXPECTED_STATUS: Record<PartnershipTransition, PartnershipStatus> = { approve: "ACTIVE", reject: "REJECTED", terminate: "TERMINATED" };

/** 승인·거절·종료 (본문 없음). 응답 협약 ID와 바뀐 상태가 맞아야 성공으로 본다 */
export async function changePartnershipStatus(partnershipId: string, transition: PartnershipTransition, options: RequestOptions = {}): Promise<PartnershipDto> {
  requireApiFeature("partnerships");
  assertId(partnershipId, "협약 ID");
  if (!(transition in EXPECTED_STATUS)) throw new ApiError("CONFIG", "협약 처리 종류가 올바르지 않습니다.");
  const data = await apiRequestData<unknown>(`/api/v1/partnerships/${encodeURIComponent(partnershipId)}/${transition}`, { ...options, method: "PATCH" });
  if (!isPartnership(data) || data.id.toLowerCase() !== partnershipId.toLowerCase() || data.status !== EXPECTED_STATUS[transition]) throw parseError(data);
  return data;
}

// ── 응답 확인 ──

function assertId(value: string, label: string) {
  if (!isPartnershipEntityId(value)) throw new ApiError("CONFIG", `${label} 형식이 올바르지 않습니다.`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const parseError = (body: unknown) => new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body });
const isName = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** 시간대 표기 없는 LocalDateTime (`YYYY-MM-DDTHH:mm[:ss[.fraction]]`) */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const isLocalDateTime = (value: unknown): value is string => typeof value === "string" && LOCAL_DATE_TIME.test(value);
/** null 또는 LocalDateTime. 필드가 아예 없으면(undefined) 계약 위반으로 본다 */
const isNullableLocalDateTime = (value: unknown) => value === null || isLocalDateTime(value);

/** 날짜 3개: 요청일은 필수, 승인·종료일은 null 가능 */
const hasPartnershipDates = (value: Record<string, unknown>) =>
  isLocalDateTime(value.requestedAt) && isNullableLocalDateTime(value.approvedAt) && isNullableLocalDateTime(value.terminatedAt);

function isMyPartnershipItem(value: unknown): value is MyPartnershipItemDto {
  return (
    isRecord(value) &&
    isPartnershipEntityId(value.partnershipId) &&
    isPartnershipEntityId(value.partnerInstitutionId) &&
    isName(value.partnerInstitutionName) &&
    (value.partnerInstitutionType === "REQUESTER" || value.partnerInstitutionType === "EXAM" || value.partnerInstitutionType === "PLATFORM") &&
    isPartnershipStatus(value.status) &&
    hasPartnershipDates(value)
  );
}

function isPartnership(value: unknown): value is PartnershipDto {
  return (
    isRecord(value) &&
    [value.id, value.requesterInstitutionId, value.examInstitutionId].every(isPartnershipEntityId) &&
    isPartnershipStatus(value.status) &&
    hasPartnershipDates(value)
  );
}

function isPublicInstitution(value: unknown): value is PublicInstitutionDto {
  return isRecord(value) && isPartnershipEntityId(value.id) && isName(value.name) && (value.type === "REQUESTER" || value.type === "EXAM");
}

// ── 오류 안내 ──

/** 백엔드·Gateway 오류 코드별 안내 (institution-service ErrorCode). 서버 메시지 본문은 보여 주지 않는다 */
const ERROR_MESSAGES: Record<string, string> = {
  PARTNERSHIP_ALREADY_IN_PROGRESS: "이미 승인 대기 중이거나 협약 중인 검사기관입니다.",
  INVALID_PARTNERSHIP_STATUS: "협약 상태가 바뀌어 처리할 수 없습니다. 최신 목록을 다시 불러옵니다.",
  INVALID_PARTNERSHIP_INSTITUTION: "협약은 의료기관이 검사기관에 요청해야 합니다. 검사기관을 다시 선택해 주세요.",
  PARTNERSHIP_NOT_FOUND: "협약을 찾을 수 없습니다. 최신 목록을 다시 불러옵니다.",
  INSTITUTION_NOT_FOUND: "기관을 찾을 수 없습니다. 삭제되었거나 비활성 기관일 수 있습니다.",
  FORBIDDEN: "이 협약을 처리할 권한이 없습니다. 우리 기관의 협약만 처리할 수 있습니다.",
  ACCESS_DENIED: "이 기능을 사용할 수 있는 계정이 아닙니다.",
  UNSUPPORTED_REQUEST: "서버에서 협약 기능을 처리하지 못했습니다. 서버에 협약 기능이 배포되었는지 확인해 주세요.",
  VALIDATION_FAILED: "요청 값이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  INVALID_INPUT: "요청 값이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
};

export function getPartnershipErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error) || error.kind === "CONFIG" || error.kind === "PARSE") return fallback;
  if (error.kind === "HTTP" && error.status !== 401 && error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
  return error.message;
}
