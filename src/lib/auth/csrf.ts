import "server-only";

/**
 * 쿠키 인증 변경 요청(로그인·로그아웃 Route Handler)의 CSRF 방어.
 *
 * 쿠키가 SameSite=Lax라 다른 사이트의 POST에는 쿠키가 실리지 않지만, 로그인 CSRF(공격자 계정으로 로그인시키기)와
 * 같은 사이트의 다른 출처(하위 도메인 등)를 막기 위해 요청 출처를 직접 확인한다 (Server Actions의 Origin 검사와 같은 방식).
 * - Origin이 없거나 이 앱의 호스트와 다르면 거부한다
 * - 브라우저가 Sec-Fetch-Site를 보냈다면 same-origin이어야 한다
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  // 프록시 뒤에서는 원래 호스트가 x-forwarded-host로 온다
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}
