import type { ReissueFailureReason, ReissueResult } from "@/features/auth/types";
import { getApiMode } from "@/lib/api/config";
import { isSameOriginRequest } from "@/lib/auth/csrf";
import { reissueFailure, reissueSessionTokens } from "@/lib/auth/reissue";

/**
 * 토큰 재발급 `POST /auth/reissue` (화면 → Next 서버 → Gateway `POST /api/v1/auth/reissue`).
 *
 * 요청 본문은 읽지 않는다: Refresh Token은 서버의 HttpOnly 쿠키에서만 꺼낸다.
 * 성공하면 Access·Refresh 쿠키를 모두 새 값으로 바꾸고 브라우저에는 성공 여부(ReissueResult)만 돌려준다.
 * GET으로는 받지 않는다 (링크·이미지로 토큰을 회전시키는 요청을 막는다). 자동 재발급은 이 단계에서 시작하지 않는다.
 */

const STATUS_BY_REASON: Record<ReissueFailureReason, number> = {
  FORBIDDEN_ORIGIN: 403,
  MOCK_MODE: 409,
  CONFIG: 500,
  NO_REFRESH_TOKEN: 401,
  INVALID_REFRESH_TOKEN: 401,
  REFRESH_TOKEN_REUSED: 401,
  NETWORK: 503,
  TIMEOUT: 504,
  SERVER_ERROR: 502,
  INVALID_RESPONSE: 502,
  REJECTED: 400,
};

function respond(result: ReissueResult): Response {
  const status = result.ok ? 200 : STATUS_BY_REASON[result.reason];
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return respond(reissueFailure("FORBIDDEN_ORIGIN"));
  let mode: ReturnType<typeof getApiMode>;
  try {
    mode = getApiMode();
  } catch {
    return respond(reissueFailure("CONFIG"));
  }
  if (mode !== "api") return respond(reissueFailure("MOCK_MODE"));
  return respond(await reissueSessionTokens());
}
