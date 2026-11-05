import "server-only";

import { unstable_rethrow } from "next/navigation";

import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { ADMIN_EXAM_TYPE_PAGE_SIZE, fetchAdminExamTypePage, type AdminExamTypeDto, type AdminExamTypeModality } from "./remote";
import { toAdminFailure, type AdminLoadFailure } from "./server";

/**
 * 관리자 공통 검사 유형 조회 (서버 전용, 조회만).
 * users/me로 ADMIN을 확인한 뒤에만 요청한다 (레이아웃 게이트만 믿지 않는다). 실패해도 Mock으로 대체하지 않는다.
 */

export type AdminExamTypePageResult =
  | { ok: true; items: AdminExamTypeDto[]; totalElements: number; totalPages: number; page: number }
  | AdminLoadFailure;

/** 검사 유형 한 페이지 (요청 1회, 서버 페이지네이션·종류 필터, 이름순) */
export async function loadAdminExamTypePage(query: { modality?: AdminExamTypeModality; page: number }): Promise<AdminExamTypePageResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchAdminExamTypePage({ modality: query.modality, page: query.page, size: ADMIN_EXAM_TYPE_PAGE_SIZE }, { headers: access.headers });
    return { ok: true, items: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number };
  } catch (error) {
    unstable_rethrow(error);
    return toAdminFailure(error, "exam-types", "검사 유형 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
