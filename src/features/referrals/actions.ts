"use server";

import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { loadReferralDetail, type ReferralDetailLoadResult } from "./server";

/**
 * 의뢰 상세 조회 Server Function (API 모드 의뢰 목록의 상세 대화상자). 조회만 하고 아무것도 바꾸지 않는다.
 * - 목록 전체를 다시 그리지 않고 대화상자를 열 때 한 건만 불러오려고 Server Function으로 둔다
 * - 같은 출처인지 확인하고, 의뢰기관 역할 확인(requireRoleAccess("REFERRING"))은 loadReferralDetail이 요청 전에 한다
 * - 인자(의뢰 ID)는 브라우저에서 오므로 형식을 다시 확인한다. 범위(우리 기관 의뢰인지)는 백엔드가 확인한다 (아니면 404)
 * - 결과에는 토큰·내부 ID(예약·장비·기관·작성자)를 담지 않는다
 */
export async function loadReferralDetailAction(referralId: unknown): Promise<ReferralDetailLoadResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null };
  }
  return loadReferralDetail(referralId);
}
