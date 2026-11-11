import "server-only";

import { unstable_rethrow } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { fetchAdminUsers, fetchInstitutions, getAdminErrorMessage, type AdminUserDto, type InstitutionDto } from "./remote";

/**
 * 관리자 화면 데이터 (서버 전용).
 *
 * 인증: users/me로 ADMIN 역할을 확인한 뒤에만 토큰을 Gateway로 넘긴다 (requireRoleAccess("ADMIN")).
 * 레이아웃의 관리자 게이트만 믿지 않는다 (레이아웃과 페이지는 함께 렌더링된다). 확인에 실패하면 요청하지 않는다.
 * 결과에는 토큰을 담지 않는다. 실패해도 Mock으로 대체하지 않는다. 응답 본문은 로그에 남기지 않는다. JSX는 만들지 않는다.
 */

/**
 * 실패 원인.
 * - SIGNED_OUT: 로그인 쿠키 없음 · UNAUTHORIZED: 401(만료·위조) · FORBIDDEN: 403 또는 ADMIN이 아님 (요청하지 않음)
 * - NETWORK: 연결 실패·시간 초과 · ERROR: 그 밖의 실패 (4xx·5xx·응답 형식 오류)
 */
export interface AdminLoadFailure {
  ok: false;
  reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NETWORK" | "ERROR";
  message: string;
  code: string | null;
}

/** 회원 목록 탭: 승인 대기(active=false) · 승인 완료(active=true) · 전체 */
export const ADMIN_USER_TABS = ["pending", "approved", "all"] as const;
export type AdminUserTab = (typeof ADMIN_USER_TABS)[number];

export type AdminUserListResult = { ok: true; users: AdminUserDto[] } | AdminLoadFailure;

/** 회원 목록 (탭 기준으로 백엔드 active 조건을 정한다) */
export async function loadAdminUsers(tab: AdminUserTab): Promise<AdminUserListResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const active = tab === "pending" ? false : tab === "approved" ? true : undefined;
    return { ok: true, users: await fetchAdminUsers(active, { headers: access.headers }) };
  } catch (error) {
    unstable_rethrow(error);
    return toAdminFailure(error, "users", "회원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 승인 대기 건수 (탭 표시용). 전체 목록을 받아 센다 (백엔드에 건수 API가 없다) */
export async function loadPendingUserCount(): Promise<number | null> {
  const result = await loadAdminUsers("pending");
  return result.ok ? result.users.length : null;
}

export type InstitutionListResult = { ok: true; institutions: InstitutionDto[] } | AdminLoadFailure;

/** 기관 목록 (삭제되지 않은 전체 기관) */
export async function loadInstitutions(): Promise<InstitutionListResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    return { ok: true, institutions: await fetchInstitutions({ headers: access.headers }) };
  } catch (error) {
    unstable_rethrow(error);
    return toAdminFailure(error, "institutions", "기관 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** ApiError → 실패 결과. 401 외의 실패는 서버 로그에 종류·상태·코드만 남긴다 (토큰·응답 본문은 남기지 않는다) */
export function toAdminFailure(error: unknown, action: string, fallback: string): AdminLoadFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[admin] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : "unknown");
  }
  return {
    ok: false,
    reason: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : isNetwork ? "NETWORK" : "ERROR",
    message: getAdminErrorMessage(error, fallback),
    code,
  };
}
