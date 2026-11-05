"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { changePartnershipStatus, fetchMyPartnershipList, isPartnershipEntityId, requestPartnership, type PartnershipTransition } from "./remote";
import { loadPartnershipTargets, toPartnershipFailure, type PartnershipTargetsResult } from "./server";
import { IN_PROGRESS_STATUSES, type PartnershipActionResult, type PartnershipScreenRole } from "./types";

/**
 * 기관 협약 Server Function (요청 대상 조회, 협약 요청, 승인·거절·종료).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 역할: 함수마다 정해진 화면 역할을 users/me로 확인한 뒤에만 토큰을 넘긴다 (역할·기관 ID 인자는 받지 않는다)
 *   요청 = 의뢰기관, 승인·거절 = 검사기관, 종료 = 각 화면 역할별 함수
 * - 기관: 요청 기관은 서버가 로그인 기관으로 정하고, 다른 기관 협약 ID는 서비스가 403으로 막는다
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다 (알려진 오류 코드만 정해 둔 문구로 안내)
 * 성공·404·409는 화면을 다시 불러와(refresh) 서버 값으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 */

const FORBIDDEN_ORIGIN = "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.";
const INVALID_PARTNERSHIP = "협약 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.";

/** 협약 요청 대상 검사기관 (의뢰기관, 조회만) */
export async function loadPartnershipTargetsAction(): Promise<PartnershipTargetsResult> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN", message: FORBIDDEN_ORIGIN };
  return loadPartnershipTargets();
}

/**
 * 협약 요청 (의뢰기관). 보내기 전에 내 기관 협약을 조회해 같은 검사기관과 승인 대기·협약 중이면 요청하지 않는다
 * (서버도 409로 막는다). 거절·종료된 협약은 다시 요청할 수 있고, 서버가 기존 협약을 PENDING으로 바꾼다.
 */
export async function requestPartnershipAction(examInstitutionId: unknown): Promise<PartnershipActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isPartnershipEntityId(examInstitutionId)) return { ok: false, reason: "INVALID", message: "협약을 요청할 검사기관을 선택해 주세요." };
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return toAccessFailure(access);

  let previous: string | null = null;
  try {
    const existing = (await fetchMyPartnershipList({}, { headers: access.headers })).find(
      (item) => item.partnerInstitutionId.toLowerCase() === examInstitutionId.toLowerCase(),
    );
    if (existing && IN_PROGRESS_STATUSES.includes(existing.status)) {
      refresh();
      return {
        ok: false,
        reason: "CONFLICT",
        message: existing.status === "ACTIVE" ? "이미 협약 중인 검사기관입니다." : "이미 승인을 기다리는 협약 요청이 있습니다.",
      };
    }
    previous = existing?.status ?? null;
  } catch (error) {
    return toActionFailure(error, "request-check", "기존 협약을 확인하지 못해 요청하지 않았습니다. 잠시 후 다시 시도해 주세요.");
  }

  try {
    await requestPartnership(examInstitutionId, { headers: access.headers });
  } catch (error) {
    return toActionFailure(error, "request", "협약 요청에 실패했습니다.");
  }
  refresh();
  return {
    ok: true,
    message: `${previous ? "협약을 다시 요청했습니다." : "협약을 요청했습니다."} 검사기관이 승인하면 협력 검사기관으로 검사를 의뢰할 수 있습니다.`,
  };
}

/** 협약 승인 (검사기관, 승인 대기만) */
export async function approvePartnershipAction(partnershipId: unknown): Promise<PartnershipActionResult> {
  return transition("EXAMINING", partnershipId, "approve", "협약을 승인했습니다. 이제 이 의료기관이 검사를 의뢰할 수 있습니다.", "협약 승인에 실패했습니다.");
}

/** 협약 거절 (검사기관, 승인 대기만) */
export async function rejectPartnershipAction(partnershipId: unknown): Promise<PartnershipActionResult> {
  return transition("EXAMINING", partnershipId, "reject", "협약 요청을 거절했습니다.", "협약 거절에 실패했습니다.");
}

/** 협약 종료 (의뢰기관 화면, 협약 중만) */
export async function terminateReferringPartnershipAction(partnershipId: unknown): Promise<PartnershipActionResult> {
  return transition("REFERRING", partnershipId, "terminate", "협약을 종료했습니다. 이 검사기관에는 더 이상 새 검사를 의뢰할 수 없습니다.", "협약 종료에 실패했습니다.");
}

/** 협약 종료 (검사기관 화면, 협약 중만) */
export async function terminateExaminingPartnershipAction(partnershipId: unknown): Promise<PartnershipActionResult> {
  return transition("EXAMINING", partnershipId, "terminate", "협약을 종료했습니다. 이 의료기관은 더 이상 새 검사를 의뢰할 수 없습니다.", "협약 종료에 실패했습니다.");
}

async function transition(
  role: PartnershipScreenRole,
  partnershipId: unknown,
  kind: PartnershipTransition,
  successMessage: string,
  fallback: string,
): Promise<PartnershipActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isPartnershipEntityId(partnershipId)) return { ok: false, reason: "INVALID", message: INVALID_PARTNERSHIP };
  const access = await requireRoleAccess(role);
  if (!access.ok) return toAccessFailure(access);
  try {
    await changePartnershipStatus(partnershipId, kind, { headers: access.headers });
  } catch (error) {
    return toActionFailure(error, kind, fallback);
  }
  refresh();
  return { ok: true, message: successMessage };
}

async function checkOrigin(): Promise<PartnershipActionResult | null> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN", message: FORBIDDEN_ORIGIN };
  return null;
}

function toAccessFailure(access: Extract<Awaited<ReturnType<typeof requireRoleAccess>>, { ok: false }>): PartnershipActionResult {
  const failure = toRoleAccessFailure(access);
  return { ok: false, reason: failure.reason, message: failure.reason === "SIGNED_OUT" ? "로그인이 필요합니다. 다시 로그인해 주세요." : failure.message };
}

/** HTTP 오류 → 결과 (404·409는 서버 상태가 화면과 달라졌다는 뜻이라 다시 불러온다) */
function toActionFailure(error: unknown, action: string, fallback: string): PartnershipActionResult {
  const failure = toPartnershipFailure(error, action, fallback);
  // 쓰기 응답이 계약과 다르면 서버에서는 처리됐을 수 있다: 실패로 단정하지 않고 목록을 서버 값으로 다시 맞춘다
  if (isApiError(error) && error.kind === "PARSE" && action !== "request-check") {
    refresh();
    return { ok: false, reason: "ERROR", message: "처리 결과를 확인하지 못했습니다. 최신 목록을 다시 불러왔으니 상태를 확인해 주세요." };
  }
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  if (status === 404 || status === 409) refresh();
  return {
    ok: false,
    reason: status === 409 ? "CONFLICT" : status === 404 ? "NOT_FOUND" : status === 400 ? "INVALID" : failure.reason === "NOT_FOUND" ? "ERROR" : failure.reason,
    message: failure.message,
  };
}
