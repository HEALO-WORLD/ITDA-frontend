import { isSameOriginRequest } from "@/lib/auth/csrf";
import { clearAccessTokenCookie } from "@/lib/auth/session";

/**
 * 로그아웃 `POST /auth/logout` (폼 전송). 토큰 쿠키를 지우고 로그인 화면으로 보낸다.
 * 백엔드에 로그아웃 API가 없어 서버 측 토큰 무효화는 하지 않는다 (토큰은 만료 시간까지 유효하다).
 * GET으로는 받지 않는다 (링크·이미지로 강제 로그아웃시키는 요청을 막는다).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false, message: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  await clearAccessTokenCookie();
  // 303: POST 뒤 GET으로 로그인 화면을 연다
  return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
}
