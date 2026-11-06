"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { apiRequestData } from "@/lib/api/client";
import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleAccess } from "@/lib/auth/session";

/**
 * 의뢰기관 검사결과 조회 Server Function (의뢰·예약 목록의 [검사결과], API 모드, 조회만).
 * `GET /api/v1/referrals/{referralId}/results` (referral-service ExaminationResultService.getResultByReferralId)
 * - 같은 출처 확인 → referrals 기능 확인 → users/me로 의뢰기관(REQUESTER) 확인 → 의뢰 ID 형식 → GET 1회
 * - 다른 의뢰기관의 의뢰는 백엔드가 막는다 (기관 불일치 403 EXAMINATION_RESULT_READ_ACCESS_DENIED, 없는 의뢰 404)
 * - JWT는 서버에서만 Gateway 요청에 붙인다 (X-Role·X-Institution-Id는 Gateway가 만든다)
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다. 실패해도 Mock 결과로 대신하지 않는다
 */

export interface ReferralExamResult {
  id: string;
  examinationId: string;
  referralId: string;
  summary: string;
  notes: string | null;
  /** 서울 LocalDateTime 원본 */
  registeredAt: string;
}

export type ResultLoadFailureReason =
  | "NOT_AVAILABLE"
  | "INVALID_INPUT"
  /** 404 EXAMINATION_RESULT_NOT_FOUND: 검사는 있지만 결과가 아직 없음 */
  | "NOT_REGISTERED"
  /** 404 EXAMINATION_NOT_FOUND·REFERRAL_NOT_FOUND 등: 검사 기록이 없거나 조회할 수 없음 */
  | "NOT_FOUND"
  | "SIGNED_OUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "ERROR";

export type ResultLoadResponse = { ok: true; data: ReferralExamResult } | { ok: false; reason: ResultLoadFailureReason; message: string };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_REGEX.test(value);

function isExamResult(value: unknown, referralId: string): value is ReferralExamResult {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    isUuid(data.id) &&
    isUuid(data.examinationId) &&
    isUuid(data.referralId) &&
    data.referralId.toLowerCase() === referralId.toLowerCase() &&
    typeof data.summary === "string" &&
    (data.notes === null || data.notes === undefined || typeof data.notes === "string") &&
    typeof data.registeredAt === "string" &&
    LOCAL_DATE_TIME.test(data.registeredAt)
  );
}

export async function loadReferralResultAction(referralId: unknown): Promise<ResultLoadResponse> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  if (!isApiFeature("referrals")) {
    return { ok: false, reason: "NOT_AVAILABLE", message: "검사결과 조회 기능이 아직 연결되지 않았습니다." };
  }
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) {
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다. 다시 로그인해 주세요." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인이 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "의뢰기관 계정만 검사결과를 조회할 수 있습니다." };
  }
  if (!isUuid(referralId)) {
    return { ok: false, reason: "INVALID_INPUT", message: "의뢰 ID 형식이 올바르지 않습니다. 화면을 새로고침해 주세요." };
  }

  try {
    const data = await apiRequestData<unknown>(`/api/v1/referrals/${encodeURIComponent(referralId)}/results`, { headers: access.headers });
    if (!isExamResult(data, referralId)) {
      return { ok: false, reason: "INVALID_RESPONSE", message: "검사결과 응답 형식을 확인할 수 없습니다." };
    }
    const { id, examinationId, summary, notes, registeredAt } = data;
    return { ok: true, data: { id, examinationId, referralId: data.referralId, summary, notes: notes ?? null, registeredAt } };
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    const code = isApiError(error) ? error.code : null;
    if (status !== 401 && !(status === 404 && code === "EXAMINATION_RESULT_NOT_FOUND")) {
      console.error("[referrals] 검사결과 조회 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}`.trim() : "unknown");
    }
    if (status === 404) {
      return code === "EXAMINATION_RESULT_NOT_FOUND"
        ? { ok: false, reason: "NOT_REGISTERED", message: "아직 등록된 검사결과가 없습니다." }
        : { ok: false, reason: "NOT_FOUND", message: "검사결과를 조회할 수 없습니다." };
    }
    if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: "로그인이 만료되었습니다. 다시 로그인해 주세요." };
    if (status === 403) return { ok: false, reason: "FORBIDDEN", message: "이 의뢰의 검사결과를 조회할 권한이 없습니다." };
    if (isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT")) {
      return { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." };
    }
    if (isApiError(error) && error.kind === "PARSE") return { ok: false, reason: "INVALID_RESPONSE", message: "검사결과 응답 형식을 확인할 수 없습니다." };
    return { ok: false, reason: "ERROR", message: "검사결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
