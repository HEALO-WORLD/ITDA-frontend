"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import {
  approveUser,
  createInstitution,
  deleteInstitution,
  isAdminEntityId,
  isRegistrableInstitutionType,
  updateInstitution,
  validateCareInstitutionCode,
  validateInstitutionAddress,
  validateInstitutionName,
} from "./remote";
import { toAdminFailure } from "./server";
import type { AdminActionResult } from "./types";

/**
 * 관리자 변경 Server Function (가입 승인, 기관 등록·수정·삭제).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: users/me로 ADMIN 역할을 확인한 뒤에만 토큰을 Gateway로 넘긴다 (requireRoleAccess("ADMIN")). 아니면 요청하지 않는다
 *   (Gateway도 ADMIN 그룹 규칙으로 다시 막는다)
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다 (알려진 오류 코드만 정해 둔 문구로 안내)
 * 성공하면 화면을 다시 불러와(refresh) 목록·건수를 서버 값으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 * 409(이미 승인됨 등)도 서버 상태가 화면과 달라졌다는 뜻이라 다시 불러온다.
 */

export async function approveUserAction(userId: unknown): Promise<AdminActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isAdminEntityId(userId)) return invalid("사용자 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
  return run("approve", () => "가입을 승인했습니다.", (headers) => approveUser(userId, { headers }), "가입 승인에 실패했습니다.");
}

export async function createInstitutionAction(input: unknown): Promise<AdminActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  const { name, type, address, careInstitutionCode } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fieldErrors = {
    name: validateInstitutionName(name),
    type: isRegistrableInstitutionType(type) ? null : "기관 유형을 선택해 주세요.",
    address: validateInstitutionAddress(address),
    careInstitutionCode: validateCareInstitutionCode(careInstitutionCode),
  };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors };
  return run(
    "create",
    () => "기관을 등록했습니다.",
    (headers) =>
      createInstitution(
        { name: name as string, type: type as "REQUESTER" | "EXAM", address: address as string, careInstitutionCode: careInstitutionCode as string },
        { headers },
      ),
    "기관 등록에 실패했습니다.",
  );
}

export async function updateInstitutionAction(institutionId: unknown, input: unknown): Promise<AdminActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isAdminEntityId(institutionId)) return invalid("기관 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
  // 유형·요양기관기호·활성 상태는 받지 않는다 (백엔드 수정 대상은 이름·주소뿐)
  const { name, address } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fieldErrors = { name: validateInstitutionName(name), address: validateInstitutionAddress(address) };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors };
  return run(
    "update",
    () => "기관 정보를 수정했습니다.",
    (headers) => updateInstitution(institutionId, { name: name as string, address: address as string }, { headers }),
    "기관 수정에 실패했습니다.",
  );
}

export async function deleteInstitutionAction(institutionId: unknown): Promise<AdminActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isAdminEntityId(institutionId)) return invalid("기관 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
  return run("delete", () => "기관을 삭제했습니다.", (headers) => deleteInstitution(institutionId, { headers }), "기관 삭제에 실패했습니다.");
}

async function checkOrigin(): Promise<AdminActionResult | null> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  return null;
}

const invalid = (message: string): AdminActionResult => ({ ok: false, reason: "INVALID", message });

/** 관리자 확인 → 요청 → 결과. 성공·409는 화면을 다시 불러온다 */
async function run(
  action: string,
  successMessage: () => string,
  request: (headers: HeadersInit) => Promise<unknown>,
  fallback: string,
): Promise<AdminActionResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) {
    const failure = toRoleAccessFailure(access);
    return { ok: false, reason: failure.reason, message: failure.reason === "SIGNED_OUT" ? "로그인이 필요합니다. 다시 로그인해 주세요." : failure.message };
  }
  try {
    await request(access.headers);
  } catch (error) {
    const failure = toAdminFailure(error, action, fallback);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status === 409 || status === 404) refresh();
    return {
      ok: false,
      reason: status === 409 ? "CONFLICT" : status === 404 ? "NOT_FOUND" : status === 400 ? "INVALID" : failure.reason,
      message: failure.message,
    };
  }
  refresh();
  return { ok: true, message: successMessage() };
}
