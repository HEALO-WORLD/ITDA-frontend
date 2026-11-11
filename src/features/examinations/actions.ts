"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleMutationAccess } from "@/lib/auth/session";

import {
  changeExaminationStatus,
  createExaminationResult,
  EXAMINATION_PAGE_SIZE_MAX,
  fetchExaminationPage,
  fetchExaminationResult,
  getExaminationResultErrorMessage,
  getExaminationStatusErrorMessage,
  isExaminationId,
  type ExaminationStatusDto,
} from "./remote";
import type { ExaminationActionResult } from "./types";

/**
 * 검사 상태 변경·결과 등록 Server Function (API 모드 검사 화면).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 토큰을 Gateway로 넘긴다. 아니면 요청하지 않는다
 *   (토큰 검증·EXAMINER 역할·검사 수행 기관 일치는 Gateway와 백엔드가 확인한다)
 * - 로그인 세션 정합성: 화면이 렌더링될 때의 로그인 세션(expectedLoginSession)과 지금 쿠키의 로그인 세션이 다르면
 *   (다른 탭에서 계정 전환·같은 계정 재로그인) 요청하지 않고 SESSION_CHANGED (requireRoleMutationAccess)
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다
 * 성공하면 화면을 다시 불러와(refresh) 목록을 서버 값으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 * 409는 화면이 서버 상태와 다르다는 뜻이라 안내와 함께 다시 불러오고, 그 밖의 실패는 화면 데이터를 그대로 둔다.
 * 결과 불명(응답 없음·시간 초과·응답 형식 오류·5xx): 변경 요청은 다시 보내지 않고, 서버 값을 조회(GET)해 반영됐는지 확인한다.
 * - 상태 변경: 검사 목록에서 이 검사의 현재 상태 확인 (단건 조회 API가 없다). 백엔드는 같은 상태 재요청을 기존 값으로 돌려준다(멱등)
 * - 결과 등록: 결과 단건 조회. 백엔드는 검사당 결과 1건만 허용한다(409 EXAMINATION_RESULT_ALREADY_EXISTS·DB 유니크) → 다시 등록해도 중복되지 않는다
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
  expectedLoginSession?: unknown,
): Promise<ExaminationActionResult> {
  const blocked = await checkRequest(examinationId);
  if (blocked) return blocked;
  if (!NEXT_STATUSES.includes(status as NextStatus)) {
    return { ok: false, reason: "INVALID", message: "변경할 검사 상태가 올바르지 않습니다." };
  }

  const access = await authorizeExaminer(expectedLoginSession);
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
    if (isResultUnknown(error)) return confirmUncertainStatus(error, examinationId as string, status as NextStatus, authorization);
    return toFailure(error, getExaminationStatusErrorMessage(error), "상태 변경");
  }
  refresh();
  return { ok: true, message };
}

export async function registerExaminationResultAction(
  examinationId: unknown,
  input: unknown,
  expectedLoginSession?: unknown,
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

  const access = await authorizeExaminer(expectedLoginSession);
  if (!access.ok) return access.failure;
  const authorization = access.headers;

  try {
    await createExaminationResult(examinationId as string, { summary, notes }, { headers: authorization });
  } catch (error) {
    if (isResultUnknown(error)) return confirmUncertainResult(error, examinationId as string, { summary, notes: typeof notes === "string" ? notes : null }, authorization);
    return toFailure(error, getExaminationResultErrorMessage(error), "결과 등록");
  }
  refresh();
  return { ok: true, message: "검사 결과를 등록했습니다." };
}

/**
 * 변경 요청의 결과를 알 수 없는 실패인지 (서버가 이미 반영했을 수 있어 다시 보내지 않고 조회로 확인한다).
 * 응답 없음(연결 실패·시간 초과·중단)·응답 형식 오류·5xx·알 수 없는 오류. 400·401·403·404·409는 서버가 거부한 확실한 실패다
 */
function isResultUnknown(error: unknown): boolean {
  if (!isApiError(error)) return true;
  if (error.kind === "NETWORK" || error.kind === "TIMEOUT" || error.kind === "ABORTED" || error.kind === "PARSE") return true;
  return error.kind === "HTTP" && error.status !== null && error.status >= 500;
}

const STATUS_LABELS: Record<NextStatus, string> = { IN_PROGRESS: "검사 중", COMPLETED: "검사 완료" };
/** 결과 불명 뒤 상태를 찾을 때 볼 검사 목록 최대 페이지 수 (요청 수 상한) */
const STATUS_LOOKUP_MAX_PAGES = 3;

const logUnknown = (error: unknown, action: string) =>
  console.error(`[examinations] 검사 ${action} 결과 불명:`, isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}`.trim() : "unknown");

/**
 * 상태 변경 결과 불명: PATCH는 다시 보내지 않고 검사 목록(GET, 최대 STATUS_LOOKUP_MAX_PAGES페이지)에서 이 검사의 현재 상태를 확인한다.
 * - 요청한 상태(또는 그 다음 상태)로 바뀌어 있으면 반영된 것으로 안내 (화면을 서버 값으로 다시 그린다)
 * - 아직 이전 상태면 실패로 단정하지 않는다: 처리 중일 수 있어 결과 불명으로 안내 (같은 상태 재요청은 서버가 한 번만 반영한다)
 * - 조회도 실패하면 결과 불명 (조회가 안 되는 상황에서 화면을 다시 그리지 않는다)
 */
async function confirmUncertainStatus(error: unknown, examinationId: string, requested: NextStatus, authorization: HeadersInit): Promise<ExaminationActionResult> {
  logUnknown(error, "상태 변경");
  let current: ExaminationStatusDto | null = null;
  try {
    for (let page = 0; page < STATUS_LOOKUP_MAX_PAGES && current === null; page++) {
      const data = await fetchExaminationPage({ page, size: EXAMINATION_PAGE_SIZE_MAX }, { headers: authorization });
      current = data.contents.find((item) => item.examinationId.toLowerCase() === examinationId.toLowerCase())?.status ?? null;
      if (page + 1 >= data.totalPages) break;
    }
  } catch {
    current = null;
  }
  if (current === null) {
    return {
      ok: false,
      reason: "UNCERTAIN",
      message: "상태 변경 결과를 확인하지 못했고 최신 상태도 불러오지 못했습니다. 이미 반영되었을 수 있으니 목록을 새로 고쳐 상태를 확인한 뒤 필요할 때만 다시 시도해 주세요.",
    };
  }
  refresh();
  if (current === requested || (requested === "IN_PROGRESS" && current === "COMPLETED")) {
    return { ok: true, message: `응답을 받지 못했지만 서버에서 검사 상태가 '${STATUS_LABELS[requested]}'(으)로 바뀐 것을 확인했습니다.` };
  }
  return {
    ok: false,
    reason: "UNCERTAIN",
    message:
      "상태 변경 결과를 확인하지 못했습니다. 지금 서버에는 이전 상태로 보이지만 처리 중일 수 있습니다. 잠시 후 목록을 새로 고쳐 확인하고, 그대로일 때만 다시 시도해 주세요(같은 상태로 다시 요청해도 서버는 한 번만 반영합니다).",
  };
}

/**
 * 결과 등록 결과 불명: POST는 다시 보내지 않고 결과 단건(GET)을 조회한다.
 * - 같은 내용의 결과가 있으면 등록된 것으로 안내 · 다른 내용이 있으면 이미 등록된 결과가 있다고 안내 (다시 등록하지 않는다)
 * - 결과가 없으면(404) 처리 중일 수 있어 결과 불명 (다시 등록해도 이미 등록된 경우 서버가 409로 막는다) · 조회 실패도 결과 불명
 */
async function confirmUncertainResult(
  error: unknown,
  examinationId: string,
  input: { summary: string; notes: string | null },
  authorization: HeadersInit,
): Promise<ExaminationActionResult> {
  logUnknown(error, "결과 등록");
  let saved: Awaited<ReturnType<typeof fetchExaminationResult>> | null = null;
  try {
    saved = await fetchExaminationResult(examinationId, { headers: authorization });
  } catch (lookupError) {
    const notFound = isApiError(lookupError) && lookupError.kind === "HTTP" && lookupError.status === 404;
    return {
      ok: false,
      reason: "UNCERTAIN",
      message: notFound
        ? "결과 등록을 확인하지 못했습니다. 아직 등록되지 않은 것으로 보이지만 처리 중일 수 있습니다. 잠시 후 검사 상세에서 결과를 확인하고, 없을 때만 다시 등록해 주세요(이미 등록된 경우 서버가 중복 등록을 막습니다)."
        : "결과 등록을 확인하지 못했고 등록된 결과도 불러오지 못했습니다. 이미 등록되었을 수 있으니 검사 상세에서 결과를 먼저 확인해 주세요.",
    };
  }
  refresh();
  const same = saved.summary.trim() === input.summary.trim() && (saved.notes ?? "").trim() === (input.notes ?? "").trim();
  if (same) return { ok: true, message: "응답을 받지 못했지만 검사 결과가 등록된 것을 확인했습니다." };
  return { ok: false, reason: "CONFLICT", message: "이미 다른 내용의 검사 결과가 등록되어 있습니다. 검사 상세에서 등록된 결과를 확인해 주세요." };
}

const SIGNED_OUT: ExaminationActionResult = {
  ok: false,
  reason: "SIGNED_OUT",
  message: "로그인이 필요합니다. 다시 로그인해 주세요.",
};

/**
 * 검사기관(EXAMINER) 역할을 users/me로 확인하고, 렌더링 시점 로그인 세션이 지금과 같은지 확인한다 (변경 요청 전용).
 * 아니면 요청하지 않는다. 이 파일의 두 변경 Action만 부른다 (조회 Action은 각자 requireRoleAccess를 쓴다)
 */
async function authorizeExaminer(expectedLoginSession: unknown): Promise<{ ok: true; headers: HeadersInit } | { ok: false; failure: ExaminationActionResult }> {
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (access.ok) return { ok: true, headers: access.headers };
  // 다른 계정 쿠키로 바뀐 화면: 목록을 다시 그리지 않고 새로고침 안내만 한다
  if (access.reason === "SESSION_CHANGED") return { ok: false, failure: { ok: false, reason: "SESSION_CHANGED", message: access.message } };
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
