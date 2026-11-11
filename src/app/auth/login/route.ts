import { getLoginFailureReason, LOGIN_FAILURE_MESSAGES, requestLogin } from "@/features/auth/remote";
import type { LoginFailureReason, LoginResult } from "@/features/auth/types";
import { isSameOriginRequest } from "@/lib/auth/csrf";
import { setAccessTokenCookie, setRefreshTokenCookie, startLoginSession, verifyAccessToken } from "@/lib/auth/session";
import { getHomeRouteForUserRole } from "@/constants/navigation";

/**
 * 로그인 `POST /auth/login` (화면 → Next 서버 → Gateway `POST /api/v1/auth/login`).
 *
 * 브라우저는 토큰을 받지 않는다: 서버가 받은 Access·Refresh 토큰을 각각 HttpOnly 쿠키에 저장하고 결과(LoginResult)만 돌려준다.
 * 토큰을 받으면 `GET /api/v1/users/me`로 사용자를 확인하고, 확인된 경우에만 쿠키를 저장해 역할별 첫 화면 경로를 돌려준다.
 */

const STATUS_BY_REASON: Record<LoginFailureReason, number> = {
  INVALID_INPUT: 400,
  INVALID_CREDENTIALS: 401,
  NOT_APPROVED: 403,
  FORBIDDEN_ORIGIN: 403,
  CONFIG: 500,
  SERVER_ERROR: 502,
  USER_INFO_FAILED: 502,
};

const LOGIN_ID_MAX_LENGTH = 50;

function respond(result: LoginResult): Response {
  const status = result.ok ? 200 : STATUS_BY_REASON[result.reason];
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

const fail = (reason: LoginFailureReason) => respond({ ok: false, reason, message: LOGIN_FAILURE_MESSAGES[reason] });

/** 요청 본문 검증: 로그인 ID(공백 없음, 50자 이하)와 비밀번호(빈 값 아님)만 받는다 */
function parseCredentials(body: unknown): { loginId: string; password: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { loginId, password } = body as Record<string, unknown>;
  if (typeof loginId !== "string" || typeof password !== "string") return null;
  const id = loginId.trim();
  if (!id || id.length > LOGIN_ID_MAX_LENGTH || /\s/.test(id) || password === "") return null;
  return { loginId: id, password };
}

export async function POST(request: Request) {
  // 다른 출처에서 보낸 요청(로그인 CSRF)과 JSON이 아닌 본문(폼 전송)을 거부한다
  if (!isSameOriginRequest(request)) return fail("FORBIDDEN_ORIGIN");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return fail("INVALID_INPUT");
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 본문이 JSON이 아니면 아래 검증에서 거부한다
  }
  const credentials = parseCredentials(body);
  if (!credentials) return fail("INVALID_INPUT");

  let token: Awaited<ReturnType<typeof requestLogin>>;
  try {
    token = await requestLogin(credentials);
  } catch (error) {
    const reason = getLoginFailureReason(error);
    // 비밀번호·토큰은 기록하지 않는다
    if (reason === "SERVER_ERROR" || reason === "CONFIG") {
      console.error("[auth] 로그인 요청 실패:", error instanceof Error ? error.message : error);
    }
    return fail(reason);
  }

  // 사용자 정보(users/me)로 역할을 확인한 뒤에만 쿠키를 저장한다 (토큰을 해석해 역할을 정하지 않는다)
  const verified = await verifyAccessToken(token.accessToken);
  if (verified.status !== "verified") {
    return respond({ ok: false, reason: "USER_INFO_FAILED", message: verified.message });
  }
  await setAccessTokenCookie(token.accessToken, token.expiresIn);
  await setRefreshTokenCookie(token.refreshToken, token.refreshExpiresIn);
  // 로그인할 때마다 새 로그인 세션 (다른 탭이 계정 전환을 알아챈다)
  await startLoginSession(token.refreshExpiresIn);
  const redirectTo = getHomeRouteForUserRole(verified.role);
  return respond({
    ok: true,
    redirectTo,
    message: redirectTo ? null : "로그인했지만 이 계정으로 이동할 화면이 없습니다.",
  });
}
