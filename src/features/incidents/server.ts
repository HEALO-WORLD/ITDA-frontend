import "server-only";

import { unstable_rethrow } from "next/navigation";

import { EQUIPMENT_PAGE_MAX_SIZE, fetchEquipmentPage } from "@/features/equipment/remote";
import type { PagedResponseDto } from "@/lib/api/types";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import {
  fetchIncidentDetail,
  fetchIncidentPage,
  fetchIncidentReferralPage,
  fetchIncidentSummary,
  getIncidentErrorMessage,
  type EquipmentIncidentDetailDto,
  type EquipmentIncidentDto,
  type EquipmentIncidentSummaryDto,
  type IncidentApiAction,
  type IncidentProcessingStatusDto,
  type IncidentReferralDto,
  type IncidentReferralItem,
} from "./remote";

/**
 * 장비 장애 조회 API 화면용 데이터 (서버 전용).
 *
 * 인증: users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 토큰을 Gateway로 넘긴다(requireRoleAccess("EXAMINING")).
 * 기관 범위는 Gateway와 백엔드가 다시 확인한다. 확인에 실패하면(로그인 안 함·다른 역할·users/me 실패) 요청하지 않는다.
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

export async function loadIncidentPage(page: number, equipmentId?: string): Promise<PageResult<EquipmentIncidentDto>> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const headers = access.headers;
  try {
    const data = await fetchIncidentPage({ page, size: INCIDENT_API_PAGE_SIZE, equipmentId }, { headers });
    return toPageResult(data, pickIncident);
  } catch (error) {
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않고 다시 던져 Next가 처리하게 한다
    unstable_rethrow(error);
    return toFailure(error, "list");
  }
}

export async function loadIncidentDetail(
  incidentId: string,
): Promise<{ ok: true; incident: EquipmentIncidentDetailDto } | IncidentLoadFailure> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const headers = access.headers;
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
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않고 다시 던져 Next가 처리하게 한다
    unstable_rethrow(error);
    return toFailure(error, "detail");
  }
}

export async function loadIncidentReferralPage(
  incidentId: string,
  page: number,
  status?: IncidentProcessingStatusDto,
): Promise<PageResult<IncidentReferralItem>> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const headers = access.headers;
  try {
    const data = await fetchIncidentReferralPage(incidentId, { page, size: INCIDENT_API_PAGE_SIZE, status }, { headers });
    return toPageResult(data, pickReferral);
  } catch (error) {
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않고 다시 던져 Next가 처리하게 한다
    unstable_rethrow(error);
    return toFailure(error, "referrals");
  }
}

/**
 * 장비 장애 현황 집계 `GET /api/v1/equipment-incidents/summary` (요청: users/me 1 + 집계 1).
 * 검사기관 역할을 users/me로 확인한 뒤에만 요청하고, 기관 ID는 보내지 않는다 (Gateway·백엔드가 토큰의 기관으로 정한다).
 * 실패는 0건으로 바꾸지 않고 실패 결과로 돌려준다 (화면은 집계를 '확인 불가'로 보여 줘야 한다).
 */
export async function loadIncidentSummary(): Promise<{ ok: true; summary: EquipmentIncidentSummaryDto } | IncidentLoadFailure> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const headers = access.headers;
  try {
    const data = await fetchIncidentSummary({ headers });
    const { institutionId, asOf, activeDowntimeEquipmentCount, affectedReferralCount, needsRescheduleReferralCount } = data;
    return { ok: true, summary: { institutionId, asOf, activeDowntimeEquipmentCount, affectedReferralCount, needsRescheduleReferralCount } };
  } catch (error) {
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않고 다시 던져 Next가 처리하게 한다
    unstable_rethrow(error);
    return toFailure(error, "summary");
  }
}

// 응답에 있는 필드만 골라 담는다 (lastError 등 화면에 쓰지 않는 값은 넘기지 않는다)
function pickIncident(dto: EquipmentIncidentDto): EquipmentIncidentDto {
  const { incidentId, equipmentId, institutionId, reason, status, occurredAt, startAt, endAt, createdAt } = dto;
  return { incidentId, equipmentId, institutionId, reason, status, occurredAt, startAt, endAt, createdAt };
}

// manualReviewRequired는 이전 백엔드 응답에 없을 수 있어 false로 채운다 (화면에 undefined를 넘기지 않는다)
function pickReferral(dto: IncidentReferralDto): IncidentReferralItem {
  const { id, incidentId, referralId, reservationId, processingStatus, retryCount, nextRetryAt, lockedUntil, resultCode, processedAt } = dto;
  return {
    id,
    incidentId,
    referralId,
    reservationId,
    processingStatus,
    retryCount,
    nextRetryAt,
    lockedUntil,
    resultCode,
    processedAt,
    manualReviewRequired: dto.manualReviewRequired ?? false,
  };
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
          : status === 404 && (action === "detail" || action === "referrals")
            ? "NOT_FOUND"
            : isNetwork
              ? "NETWORK"
              : "ERROR",
    message: getIncidentErrorMessage(error, action),
    code,
  };
}

/** 장비 이름·종류 (장애 목록 표시·장비 필터 선택지용). 실패하면 null (목록은 그대로 보여 주고 장비 ID로 표시한다) */
export type IncidentEquipmentLookup = Record<string, { name: string; modality: "CT" | "MRI" }> | null;

/**
 * 우리 기관 장비 목록 1회 `GET /api/v1/institutions/{users/me 기관}/equipments?size=100`.
 * 행마다 장비 단건을 부르지 않는다. 기관 ID는 users/me 값만 쓴다.
 */
export async function loadIncidentEquipmentLookup(): Promise<IncidentEquipmentLookup> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return null;
  try {
    const own = access.user.institutionId.toLowerCase();
    const data = await fetchEquipmentPage(access.user.institutionId, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, { headers: access.headers });
    return Object.fromEntries(
      data.contents.filter((item) => item.institutionId.toLowerCase() === own).map((item) => [item.id.toLowerCase(), { name: item.name, modality: item.modality }]),
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("[incidents] 장비 이름 조회 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
    return null;
  }
}
