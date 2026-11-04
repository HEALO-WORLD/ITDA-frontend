"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleAccess } from "@/lib/auth/session";

import {
  changeExaminationStatus,
  createExaminationResult,
  getExaminationResultErrorMessage,
  getExaminationStatusErrorMessage,
  isExaminationId,
} from "./remote";
import type { ExaminationActionResult } from "./types";

/**
 * 검사 상태 변경·결과 등록 Server Function (API 모드 검사 화면).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 토큰을 Gateway로 넘긴다 (requireRoleAccess). 아니면 요청하지 않는다
 *   (토큰 검증·EXAMINER 역할·검사 수행 기관 일치는 Gateway와 백엔드가 확인한다)
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다
 * 성공하면 화면을 다시 불러와(refresh) 목록을 서버 값으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 * 409는 화면이 서버 상태와 다르다는 뜻이라 안내와 함께 다시 불러오고, 그 밖의 실패는 화면 데이터를 그대로 둔다.
 */

const NEXT_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;
type NextStatus = (typeof NEXT_STATUSES)[number];

const STATUS_SUCCESS_MESSAGES: Record<NextStatus, string> = {
  IN_PROGRESS: "검사를 시작했습니다.",
  COMPLETED: "검사를 완료 처리했습니다.",
};

export async function changeExaminationStatusAction(
  examinationId: unknown,
  status: unknown,
): Promise<ExaminationActionResult> {
  const blocked = await checkRequest(examinationId);
  if (blocked) return blocked;
  if (!NEXT_STATUSES.includes(status as NextStatus)) {
    return { ok: false, reason: "INVALID", message: "변경할 검사 상태가 올바르지 않습니다." };
  }

  const access = await authorizeExaminer();
  if (!access.ok) return access.failure;
  const authorization = access.headers;

  let message: string;
  try {
    const data = await changeExaminationStatus(examinationId as string, status as NextStatus, { headers: authorization });
    // 같은 상태를 다시 요청한 경우(다른 화면에서 먼저 처리 등) 서버는 기존 값을 그대로 돌려준다
    message =
      data.previousStatus === data.currentStatus
        ? "이미 처리된 상태입니다. 최신 목록을 불러왔습니다."
        : STATUS_SUCCESS_MESSAGES[status as NextStatus];
  } catch (error) {
    return toFailure(error, getExaminationStatusErrorMessage(error), "상태 변경");
  }
  refresh();
  return { ok: true, message };
}

export async function registerExaminationResultAction(
  examinationId: unknown,
  input: unknown,
): Promise<ExaminationActionResult> {
  const blocked = await checkRequest(examinationId);
  if (blocked) return blocked;
  const { summary, notes } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof summary !== "string" || !summary.trim()) {
    return { ok: false, reason: "INVALID", message: "검사 결과 요약을 입력해 주세요." };
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return { ok: false, reason: "INVALID", message: "추가 소견 입력값이 올바르지 않습니다." };
  }

  const access = await authorizeExaminer();
  if (!access.ok) return access.failure;
  const authorization = access.headers;

  try {
    await createExaminationResult(examinationId as string, { summary, notes }, { headers: authorization });
  } catch (error) {
    return toFailure(error, getExaminationResultErrorMessage(error), "결과 등록");
  }
  refresh();
  return { ok: true, message: "검사 결과를 등록했습니다." };
}

const SIGNED_OUT: ExaminationActionResult = {
  ok: false,
  reason: "SIGNED_OUT",
  message: "로그인이 필요합니다. 다시 로그인해 주세요.",
};

/** 검사기관(EXAMINER) 역할을 users/me로 확인한다. 아니면 요청하지 않는다 (requireRoleAccess) */
async function authorizeExaminer(): Promise<{ ok: true; headers: HeadersInit } | { ok: false; failure: ExaminationActionResult }> {
  const access = await requireRoleAccess("EXAMINING");
  if (access.ok) return { ok: true, headers: access.headers };
  if (access.reason === "SIGNED_OUT") return { ok: false, failure: SIGNED_OUT };
  if (access.reason === "UNAUTHORIZED") {
    return { ok: false, failure: { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요." } };
  }
  return { ok: false, failure: { ok: false, reason: "FORBIDDEN", message: access.message } };
}

/** 같은 출처·검사 ID 확인. 통과하면 null */
async function checkRequest(examinationId: unknown): Promise<ExaminationActionResult | null> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  if (!isExaminationId(examinationId)) {
    return { ok: false, reason: "INVALID", message: "검사 정보가 올바르지 않습니다. 화면을 새로고침해 주세요." };
  }
  return null;
}

function toFailure(error: unknown, message: string, action: string): ExaminationActionResult {
  const kind = isApiError(error) ? error.kind : null;
  const status = isApiError(error) && kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  // 토큰·요청 본문·서버 오류 본문은 남기지 않는다
  if (status !== 401) console.error(`[examinations] 검사 ${action} 실패:`, kind ? `${kind} ${status ?? ""} ${code ?? ""}` : error);

  if (status === 401) {
    return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요." };
  }
  if (status === 409) {
    refresh();
    return { ok: false, reason: "CONFLICT", message };
  }
  const reason =
    status === 403
      ? "FORBIDDEN"
      : status === 404
        ? "NOT_FOUND"
        : status === 400
          ? "INVALID"
          : kind === "NETWORK" || kind === "TIMEOUT"
            ? "NETWORK"
            : "ERROR";
  return { ok: false, reason, message };
}
