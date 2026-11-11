import { requestLogout } from "@/features/auth/remote";
import { isApiError } from "@/lib/api/errors";
import { isSameOriginRequest } from "@/lib/auth/csrf";
import { clearSessionCookies, readRefreshToken } from "@/lib/auth/session";

/** 백엔드 로그아웃이 늦어도 화면 로그아웃이 오래 걸리지 않게 짧게 기다린다 */
const LOGOUT_TIMEOUT_MS = 3_000;

/**
 * 로그아웃 `POST /auth/logout` (폼 전송). 토큰 쿠키를 지우고 로그인 화면으로 보낸다.
 * Refresh Token 쿠키가 있으면 백엔드 `POST /api/v1/auth/logout`으로 Refresh Token(family)을 폐기한다.
 * 백엔드 호출이 실패해도 두 쿠키는 반드시 지운다 (Access Token은 만료 시간까지 유효하다). Refresh Token이 없는 기존 세션은 쿠키만 지운다.
 * GET으로는 받지 않는다 (링크·이미지로 강제 로그아웃시키는 요청을 막는다).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false, message: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const refreshToken = await readRefreshToken();
  if (refreshToken) {
    try {
      await requestLogout(refreshToken, { timeoutMs: LOGOUT_TIMEOUT_MS });
    } catch (error) {
      // 토큰·응답 본문은 남기지 않는다
      console.error("[auth] 백엔드 로그아웃 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
    }
  }
  await clearSessionCookies();
  // 303: POST 뒤 GET으로 로그인 화면을 연다
  return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
}
