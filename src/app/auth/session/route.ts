import { readAccessTokenPresence, readLoginSessionTag, readRefreshToken, toSessionTag } from "@/lib/auth/session";

/**
 * 세션 쿠키 상태 `GET /auth/session` (보호 화면의 SessionGuard·세션 복구가 확인한다).
 *
 * 쿠키가 있는지만 본다 (백엔드 요청·토큰 해석 없음, 토큰·사용자 정보는 돌려주지 않는다). 아무것도 바꾸지 않는다.
 * - active: Access 쿠키 있음 · restorable: Access 쿠키 없음 + Refresh 쿠키 있음(재발급으로 복구 가능) · signed-out: 둘 다 없음
 * - tag: 현재 Refresh 쿠키를 구분하는 값 (SHA-256 해시 앞 16자, 토큰으로 되돌릴 수 없다). 재발급·로그인으로 쿠키가 바뀌면 달라진다.
 *   세션 복구가 잠금을 기다리는 동안 다른 탭이 회전시켰는지 확인하는 데만 쓴다. Refresh 쿠키가 없으면 null
 * - loginSession: 로그인 세션 구분 값 (로그인마다 바뀌고 재발급으로는 바뀌지 않는다). 다른 탭의 계정 전환·로그아웃 감지용. 없으면 null
 * Access 쿠키는 있지만 백엔드가 401로 거부하는 경우는 여기서 알 수 없다 (전체 로드 시 ApiRoleGate가 처리한다).
 */
export async function GET() {
  const refreshToken = await readRefreshToken();
  const status = (await readAccessTokenPresence()) ? "active" : refreshToken ? "restorable" : "signed-out";
  const tag = refreshToken ? toSessionTag(refreshToken) : null;
  return Response.json({ status, tag, loginSession: await readLoginSessionTag() }, { headers: { "Cache-Control": "no-store" } });
}
