import "server-only";

import { redirect } from "next/navigation";

import { ROUTES } from "@/constants/navigation";
import { requestReissue } from "@/features/auth/remote";
import type { ReissueFailureReason, ReissueResult } from "@/features/auth/types";
import { isApiError } from "@/lib/api/errors";

import { clearSessionCookies, extendLoginSession, readRefreshToken, setAccessTokenCookie, setRefreshTokenCookie } from "./session";

/**
 * 토큰 재발급(RTR) 처리 (서버 전용. 쿠키를 쓰므로 Route Handler·Server Function에서만 부른다).
 *
 * HttpOnly Refresh 쿠키만 쓴다 (브라우저가 보낸 값은 받지 않는다). 성공하면 Access·Refresh 쿠키를 모두 새 값으로 바꾼다.
 * - 401 INVALID_REFRESH_TOKEN·REFRESH_TOKEN_REUSED: 세션을 이어 갈 수 없어 두 쿠키를 지운다
 * - 네트워크·시간 초과·5xx·응답 형식 오류: Refresh Token이 아직 유효할 수 있어 쿠키를 그대로 둔다 (지우면 다시 로그인해야 한다)
 * 중복 호출을 막는 잠금은 두지 않는다 (사용자 간 공유 상태를 만들지 않는다). 자동 재발급의 중복 제어는 호출하는 쪽에서 정한다.
 * 결과에는 토큰을 담지 않는다.
 */

export const REISSUE_FAILURE_MESSAGES: Record<ReissueFailureReason, string> = {
  FORBIDDEN_ORIGIN: "허용되지 않은 요청입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  MOCK_MODE: "Mock 모드에서는 로그인 연장을 하지 않습니다.",
  CONFIG: "로그인 연장 기능을 사용할 수 없는 환경입니다. (API 모드·주소 설정 확인)",
  NO_REFRESH_TOKEN: "로그인이 필요합니다. 다시 로그인해 주세요.",
  INVALID_REFRESH_TOKEN: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
  REFRESH_TOKEN_REUSED: "보안을 위해 로그인이 해제되었습니다. 다시 로그인해 주세요.",
  NETWORK: "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  TIMEOUT: "인증 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
  SERVER_ERROR: "인증 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
  INVALID_RESPONSE: "인증 서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  REJECTED: "로그인 연장 요청이 거부되었습니다. 다시 로그인해 주세요.",
};

const RETRYABLE: ReadonlySet<ReissueFailureReason> = new Set(["NETWORK", "TIMEOUT", "SERVER_ERROR", "INVALID_RESPONSE"]);
const RELOGIN_REQUIRED: ReadonlySet<ReissueFailureReason> = new Set(["NO_REFRESH_TOKEN", "INVALID_REFRESH_TOKEN", "REFRESH_TOKEN_REUSED"]);

/**
 * 재발급으로 복구할 수 없을 때(Refresh 만료·재사용) 로그인 화면의 만료 안내로 보낸다 (Server Function 안에서만. 보호 화면의 기존 만료 주소와 같다).
 * rotateSessionTokens가 이미 쿠키를 지운 뒤에 부른다
 */
export function redirectToExpiredLogin(): never {
  redirect(`${ROUTES.login}?reason=expired`);
}

export function reissueFailure(reason: ReissueFailureReason): Extract<ReissueResult, { ok: false }> {
  return { ok: false, reason, message: REISSUE_FAILURE_MESSAGES[reason], retryable: RETRYABLE.has(reason), reloginRequired: RELOGIN_REQUIRED.has(reason) };
}

/** 백엔드 재발급 실패 분류. 401은 코드로 구분하고, 코드가 없거나 모르는 401은 만료로 본다 */
function getReissueFailureReason(error: unknown): ReissueFailureReason {
  if (!isApiError(error)) return "SERVER_ERROR";
  switch (error.kind) {
    case "CONFIG":
      return "CONFIG";
    case "NETWORK":
    case "ABORTED":
      return "NETWORK";
    case "TIMEOUT":
      return "TIMEOUT";
    case "PARSE":
      return "INVALID_RESPONSE";
  }
  if (error.status === 401) return error.code === "REFRESH_TOKEN_REUSED" ? "REFRESH_TOKEN_REUSED" : "INVALID_REFRESH_TOKEN";
  if (error.status !== null && error.status >= 500) return "SERVER_ERROR";
  return "REJECTED";
}

/** Refresh 쿠키로 두 토큰을 재발급받아 쿠키를 교체한다 (API 모드 확인은 호출한 쪽이 먼저 한다). 브라우저에는 성공 여부만 돌려준다 */
export async function reissueSessionTokens(): Promise<ReissueResult> {
  const result = await rotateSessionTokens();
  return result.ok ? { ok: true } : result;
}

/**
 * 재발급 + 쿠키 교체 (reissueSessionTokens와 같은 처리). 새 Access Token을 서버 안에서만 돌려준다:
 * 같은 요청에서 바로 사용자 확인(users/me)을 다시 할 때 쓴다 (requireRoleMutationAccess의 인증 복구). 브라우저로 넘기지 않는다
 */
export async function rotateSessionTokens(): Promise<{ ok: true; accessToken: string } | Extract<ReissueResult, { ok: false }>> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) return reissueFailure("NO_REFRESH_TOKEN");

  let tokens: Awaited<ReturnType<typeof requestReissue>>;
  try {
    tokens = await requestReissue(refreshToken);
  } catch (error) {
    const reason = getReissueFailureReason(error);
    // 토큰·응답 본문은 남기지 않는다
    if (reason !== "INVALID_REFRESH_TOKEN") {
      console.error("[auth] 토큰 재발급 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
    }
    if (reason === "INVALID_REFRESH_TOKEN" || reason === "REFRESH_TOKEN_REUSED") await clearSessionCookies();
    return reissueFailure(reason);
  }
  await setAccessTokenCookie(tokens.accessToken, tokens.expiresIn);
  await setRefreshTokenCookie(tokens.refreshToken, tokens.refreshExpiresIn);
  // 회전은 같은 로그인 세션: 식별 값은 그대로 두고 수명만 맞춘다
  await extendLoginSession(tokens.refreshExpiresIn);
  return { ok: true, accessToken: tokens.accessToken };
}
