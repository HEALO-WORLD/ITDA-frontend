import "server-only";

import { unstable_rethrow } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { fetchMyPartnershipList, fetchPublicInstitutions, getPartnershipErrorMessage, type MyPartnershipItemDto } from "./remote";
import type { PartnershipLoadFailure, PartnershipScreenRole, PartnershipStatus } from "./types";

/**
 * 기관 협약 화면 데이터 (서버 전용, 조회만).
 * 함수마다 users/me로 화면 역할(의뢰기관 REQUESTER·검사기관 EXAMINER)을 확인한 뒤에만 요청한다.
 * 협약 범위는 서버(Gateway·서비스)가 로그인 기관으로 정한다 (브라우저가 보낸 기관 ID를 쓰지 않는다).
 * 실패해도 Mock으로 대체하지 않는다. 로그에는 종류·상태·코드만 남긴다.
 */

export type PartnershipListResult = { ok: true; partnerships: MyPartnershipItemDto[] } | PartnershipLoadFailure;

/** 내 기관 협약 전체 (요청 1회). 최근 요청 순. 상태 필터·건수는 받은 목록으로 계산한다 */
export async function loadPartnerships(role: PartnershipScreenRole): Promise<PartnershipListResult> {
  const access = await requireRoleAccess(role);
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const list = await fetchMyPartnershipList({}, { headers: access.headers });
    return { ok: true, partnerships: [...list].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) };
  } catch (error) {
    unstable_rethrow(error);
    return toPartnershipFailure(error, "list", "협약 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 협약 요청 대상 검사기관 한 곳. status: 이 기관과의 기존 협약 상태 (없으면 null) */
export interface PartnershipTarget {
  id: string;
  name: string;
  status: PartnershipStatus | null;
}

export type PartnershipTargetsResult = { ok: true; targets: PartnershipTarget[] } | PartnershipLoadFailure;

/**
 * 협약 요청 대상 (의뢰기관만, 요청 2회 병렬: 공개 기관 목록 + 내 기관 협약).
 * 검사기관(EXAM)만 고를 수 있고, 기존 협약 상태를 붙여 승인 대기·협약 중인 곳은 화면에서 고르지 못하게 한다.
 */
export async function loadPartnershipTargets(): Promise<PartnershipTargetsResult> {
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const [institutions, partnerships] = await Promise.all([
      fetchPublicInstitutions({ headers: access.headers }),
      fetchMyPartnershipList({}, { headers: access.headers }),
    ]);
    const statusByInstitution = new Map(partnerships.map((item) => [item.partnerInstitutionId.toLowerCase(), item.status]));
    const targets = institutions
      .filter((item) => item.type === "EXAM")
      .map((item) => ({ id: item.id, name: item.name, status: statusByInstitution.get(item.id.toLowerCase()) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return { ok: true, targets };
  } catch (error) {
    unstable_rethrow(error);
    return toPartnershipFailure(error, "targets", "검사기관 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 조회·변경 실패 → 화면 안내 (토큰·응답 본문은 담지 않는다) */
export function toPartnershipFailure(error: unknown, action: string, fallback: string): PartnershipLoadFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[partnerships] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : "unknown");
  }
  const message =
    status === 401
      ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
      : isNetwork
        ? "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요."
        : getPartnershipErrorMessage(error, fallback);
  const reason =
    status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : isNetwork ? "NETWORK" : "ERROR";
  return { ok: false, reason, message };
}
