import "server-only";

import { unstable_rethrow } from "next/navigation";

import {
  fetchIncidentDetail,
  fetchIncidentPage,
  fetchIncidentReferralPage,
  INCIDENT_STATUSES,
  type EquipmentIncidentDetailDto,
  type EquipmentIncidentDto,
  type IncidentProcessingStatusDto,
  type IncidentReferralDto,
  type IncidentReferralItem,
} from "@/features/incidents/remote";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { toAdminFailure, type AdminLoadFailure } from "./server";

/**
 * 관리자 장비 장애 조회 (서버 전용). 기존 장애 API 통신 함수(features/incidents/remote.ts)를 함께 쓴다.
 *
 * 인증: users/me로 ADMIN 역할을 확인한 뒤에만 요청한다 (requireRoleAccess("ADMIN")). Gateway도 EXAMINER·ADMIN만 허용한다.
 * 백엔드는 ADMIN에게 전체 기관의 장애를 주고, institutionId 조건으로 기관을 고를 수 있다 (ADMIN 전용 조건).
 * 영향 의뢰의 lastError(후속 처리 실패 진단)는 ADMIN에게만 오는 값이라 관리자 화면에서만 보여 준다
 * (검사기관 화면의 로더 features/incidents/server.ts는 이 값을 계속 버린다).
 */

export const ADMIN_INCIDENT_PAGE_SIZE = 10;

export type AdminIncidentPageResult =
  | { ok: true; incidents: EquipmentIncidentDto[]; totalElements: number; totalPages: number; page: number }
  | AdminLoadFailure;

export interface AdminIncidentListQuery {
  /** 0부터 */
  page: number;
  institutionId?: string;
  equipmentId?: string;
  status?: (typeof INCIDENT_STATUSES)[number];
}

export async function loadAdminIncidentPage(query: AdminIncidentListQuery): Promise<AdminIncidentPageResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchIncidentPage({ ...query, size: ADMIN_INCIDENT_PAGE_SIZE }, { headers: access.headers });
    return { ok: true, incidents: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number };
  } catch (error) {
    unstable_rethrow(error);
    return toIncidentFailure(error, "incidents", "장비 장애 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function loadAdminIncidentDetail(incidentId: string): Promise<{ ok: true; incident: EquipmentIncidentDetailDto } | AdminLoadFailure> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    return { ok: true, incident: await fetchIncidentDetail(incidentId, { headers: access.headers }) };
  } catch (error) {
    unstable_rethrow(error);
    return toIncidentFailure(error, "incident-detail", "장비 장애 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 영향 의뢰 처리 현황 1건 (관리자용: lastError 포함, manualReviewRequired는 항상 boolean) */
export type AdminIncidentReferral = IncidentReferralItem & { lastError: string | null };

export type AdminIncidentReferralPageResult =
  | { ok: true; referrals: AdminIncidentReferral[]; totalElements: number; totalPages: number; page: number }
  | AdminLoadFailure;

export async function loadAdminIncidentReferrals(
  incidentId: string,
  page: number,
  status?: IncidentProcessingStatusDto,
): Promise<AdminIncidentReferralPageResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchIncidentReferralPage(incidentId, { page, size: ADMIN_INCIDENT_PAGE_SIZE, status }, { headers: access.headers });
    // lastError는 ADMIN 응답에만 있는 값: 문자열 또는 null만 받는다 (형식이 다르면 일부만 보이지 않게 전체 실패)
    const referrals = data.contents.map((item) => {
      const lastError = (item as IncidentReferralDto & { lastError?: unknown }).lastError;
      if (lastError !== null && lastError !== undefined && typeof lastError !== "string") throw new TypeError("lastError");
      // manualReviewRequired는 이전 백엔드 응답에 없을 수 있어 false로 채운다 (형식은 fetchIncidentReferralPage가 이미 확인)
      return {
        ...item,
        lastError: typeof lastError === "string" ? lastError : null,
        manualReviewRequired: item.manualReviewRequired ?? false,
      };
    });
    return { ok: true, referrals, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number };
  } catch (error) {
    unstable_rethrow(error);
    return toIncidentFailure(error, "incident-referrals", "영향받은 의뢰 처리 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

function toIncidentFailure(error: unknown, action: string, fallback: string): AdminLoadFailure {
  const failure = toAdminFailure(error, action, fallback);
  if (isApiError(error) && error.kind === "HTTP" && error.status === 404) {
    return { ...failure, message: "장비 장애를 찾을 수 없습니다. 삭제되었거나 올바르지 않은 장애입니다." };
  }
  return failure;
}
