"use server";

import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { loadExaminationResult, type ExaminationResultLoadResult } from "./lookups";
import { isExaminationId } from "./remote";

/**
 * 검사 결과 조회 Server Function (API 모드 검사 상세 대화상자). 조회만 한다.
 * 같은 출처·검사 ID 형식을 확인하고, 검사기관 역할 확인은 loadExaminationResult가 요청 전에 한다.
 * 다른 기관 검사는 백엔드가 403으로 막는다. 기존 상태 변경·결과 등록 Server Function(actions.ts)과는 따로 둔다.
 */
export async function loadExaminationResultAction(examinationId: unknown): Promise<ExaminationResultLoadResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null };
  }
  if (!isExaminationId(examinationId)) {
    return { ok: false, reason: "ERROR", message: "검사 정보가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null };
  }
  return loadExaminationResult(examinationId);
}
