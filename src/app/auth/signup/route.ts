import { describeError, getSignupFailureReason, requestSignup, SIGNUP_FAILURE_MESSAGES } from "@/features/auth/signup";
import { validateSignupRequest } from "@/features/auth/signupRules";
import type { SignupFailureReason, SignupResult } from "@/features/auth/types";
import { getApiMode } from "@/lib/api/config";
import { isSameOriginRequest } from "@/lib/auth/csrf";

/**
 * 회원가입 `POST /auth/signup` (화면 → Next 서버 → Gateway `POST /api/v1/auth/signup`).
 *
 * 공개 API라 인증 헤더·쿠키를 쓰지 않는다. 가입 계정은 관리자 승인 전이라 토큰이 없고, 자동 로그인하지 않는다.
 * API 모드에서만 동작한다. Mock 모드에서는 백엔드를 부르지 않고 거부한다 (Mock 가입을 만들지 않는다).
 * 입력값은 바꾸지(trim) 않고 백엔드 규칙(signupRules)으로만 다시 확인한 뒤 그대로 보낸다.
 * 비밀번호는 응답·로그에 남기지 않는다.
 */

const STATUS_BY_REASON: Record<SignupFailureReason, number> = {
  INVALID_INPUT: 400,
  INSTITUTION_NOT_ALLOWED: 400,
  INSTITUTION_NOT_FOUND: 404,
  DUPLICATE_LOGIN_ID: 409,
  FORBIDDEN_ORIGIN: 403,
  MOCK_MODE: 409,
  CONFIG: 500,
  NETWORK: 502,
  SERVER_ERROR: 502,
};

function respond(result: SignupResult): Response {
  const status = result.ok ? 201 : STATUS_BY_REASON[result.reason];
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

const fail = (reason: SignupFailureReason) => respond({ ok: false, reason, message: SIGNUP_FAILURE_MESSAGES[reason] });

/** 요청 본문 검증: 세 값이 모두 문자열이고 백엔드 규칙을 만족해야 한다 (다른 필드는 보내지 않는다) */
function parseSignupBody(body: unknown): { loginId: string; password: string; institutionId: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { loginId, password, institutionId } = body as Record<string, unknown>;
  if (typeof loginId !== "string" || typeof password !== "string" || typeof institutionId !== "string") return null;
  const request = { loginId, password, institutionId };
  return Object.keys(validateSignupRequest(request)).length === 0 ? request : null;
}

export async function POST(request: Request) {
  // 다른 출처에서 보낸 요청과 JSON이 아닌 본문(폼 전송)을 거부한다
  if (!isSameOriginRequest(request)) return fail("FORBIDDEN_ORIGIN");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return fail("INVALID_INPUT");
  }

  let mode: ReturnType<typeof getApiMode>;
  try {
    mode = getApiMode();
  } catch {
    return fail("CONFIG");
  }
  if (mode !== "api") return fail("MOCK_MODE");

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 본문이 JSON이 아니면 아래 검증에서 거부한다
  }
  const signup = parseSignupBody(body);
  if (!signup) return fail("INVALID_INPUT");

  try {
    const data = await requestSignup(signup);
    return respond({ ok: true, loginId: data.loginId });
  } catch (error) {
    const reason = getSignupFailureReason(error);
    // 비밀번호·요청 본문은 기록하지 않는다 (예상 가능한 입력 오류는 기록하지 않는다)
    if (reason === "SERVER_ERROR" || reason === "NETWORK" || reason === "CONFIG") {
      console.error("[auth] 회원가입 요청 실패:", describeError(error));
    }
    return fail(reason);
  }
}
