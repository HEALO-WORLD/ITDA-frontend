import "server-only";

import type { PagedResponseDto } from "@/lib/api/types";
import { isApiError } from "@/lib/api/errors";
import { getInstitutionScopedAuthorizationHeaders } from "@/lib/auth/session";

import {
  fetchIncidentDetail,
  fetchIncidentPage,
  fetchIncidentReferralPage,
  getIncidentErrorMessage,
  type EquipmentIncidentDetailDto,
  type EquipmentIncidentDto,
  type IncidentApiAction,
  type IncidentProcessingStatusDto,
  type IncidentReferralDto,
} from "./remote";

/**
 * 장비 장애 조회 API 화면용 데이터 (서버 전용).
 *
 * 인증: 로그인 쿠키의 토큰을 Gateway로 넘기고(getInstitutionScopedAuthorizationHeaders),
 * 토큰·역할·기관 범위 검증은 Gateway와 백엔드에 맡긴다. 쿠키가 없으면 요청하지 않는다.
 * 결과에는 토큰과 ADMIN 전용 진단값(lastError)을 담지 않는다. 실패해도 Mock으로 대체하지 않는다. JSX는 만들지 않는다.
 */

/** 화면 페이지 크기 (백엔드 기본값과 같다) */
export const INCIDENT_API_PAGE_SIZE = 10;

/**
 * 실패 원인.
 * - SIGNED_OUT: 로그인 쿠키 없음 (요청하지 않음)
 * - UNAUTHORIZED: 401 → 다시 로그인
 * - FORBIDDEN: 403 (역할이 맞지 않음, 또는 Gateway 정책에 경로 규칙이 없음)
 * - NOT_FOUND: 404 (장애가 없거나 다른 기관의 장애)
 * - NETWORK: 연결 실패·시간 초과
 * - ERROR: 그 밖의 실패 (400·5xx·응답 형식 오류·설정 오류)
 */
export interface IncidentLoadFailure {
  ok: false;
  reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NETWORK" | "ERROR";
  message: string;
  /** Gateway·백엔드 오류 코드 (원인을 덧붙일 때만 쓴다) */
  code: string | null;
}

type PageResult<T> =
  | { ok: true; items: T[]; totalElements: number; totalPages: number; /** 0부터 */ page: number }
  | IncidentLoadFailure;

const SIGNED_OUT: IncidentLoadFailure = { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다.", code: null };

export async function loadIncidentPage(page: number, equipmentId?: string): Promise<PageResult<EquipmentIncidentDto>> {
  const headers = await getInstitutionScopedAuthorizationHeaders();
  if (!headers) return SIGNED_OUT;
  try {
    const data = await fetchIncidentPage({ page, size: INCIDENT_API_PAGE_SIZE, equipmentId }, { headers });
    return toPageResult(data, pickIncident);
  } catch (error) {
    return toFailure(error, "list");
  }
}

export async function loadIncidentDetail(
  incidentId: string,
): Promise<{ ok: true; incident: EquipmentIncidentDetailDto } | IncidentLoadFailure> {
  const headers = await getInstitutionScopedAuthorizationHeaders();
  if (!headers) return SIGNED_OUT;
  try {
    const data = await fetchIncidentDetail(incidentId, { headers });
    return {
      ok: true,
      incident: {
        ...pickIncident(data),
        totalReferrals: data.totalReferrals,
        completedCount: data.completedCount,
        failedCount: data.failedCount,
        pendingCount: data.pendingCount,
        processingCount: data.processingCount,
        updatedAt: data.updatedAt,
      },
    };
  } catch (error) {
    return toFailure(error, "detail");
  }
}

export async function loadIncidentReferralPage(
  incidentId: string,
  page: number,
  status?: IncidentProcessingStatusDto,
): Promise<PageResult<IncidentReferralDto>> {
  const headers = await getInstitutionScopedAuthorizationHeaders();
  if (!headers) return SIGNED_OUT;
  try {
    const data = await fetchIncidentReferralPage(incidentId, { page, size: INCIDENT_API_PAGE_SIZE, status }, { headers });
    return toPageResult(data, pickReferral);
  } catch (error) {
    return toFailure(error, "referrals");
  }
}

// 응답에 있는 필드만 골라 담는다 (lastError 등 화면에 쓰지 않는 값은 넘기지 않는다)
function pickIncident(dto: EquipmentIncidentDto): EquipmentIncidentDto {
  const { incidentId, equipmentId, institutionId, reason, status, occurredAt, startAt, endAt, createdAt } = dto;
  return { incidentId, equipmentId, institutionId, reason, status, occurredAt, startAt, endAt, createdAt };
}

function pickReferral(dto: IncidentReferralDto): IncidentReferralDto {
  const { id, incidentId, referralId, reservationId, processingStatus, retryCount, nextRetryAt, lockedUntil, resultCode, processedAt } = dto;
  return { id, incidentId, referralId, reservationId, processingStatus, retryCount, nextRetryAt, lockedUntil, resultCode, processedAt };
}

function toPageResult<D, T>(data: PagedResponseDto<D>, pick: (item: D) => T): PageResult<T> {
  return {
    ok: true,
    items: data.contents.map(pick),
    totalElements: data.totalElements,
    totalPages: data.totalPages,
    page: data.number,
  };
}

/** ApiError → 화면 실패 결과. 401 외의 실패는 서버 로그에 남긴다 (토큰·응답 본문은 남기지 않는다) */
function toFailure(error: unknown, action: IncidentApiAction): IncidentLoadFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[incidents] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : error);
  }
  return {
    ok: false,
    reason:
      status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404 && action !== "list"
            ? "NOT_FOUND"
            : isNetwork
              ? "NETWORK"
              : "ERROR",
    message: getIncidentErrorMessage(error, action),
    code,
  };
}
