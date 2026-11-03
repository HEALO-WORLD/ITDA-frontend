import "server-only";

import { cookies } from "next/headers";

/**
 * 로그인 세션 (서버 전용).
 *
 * 백엔드가 발급한 액세스 토큰(JWT)을 HttpOnly 쿠키에만 보관한다.
 * - 브라우저 스크립트는 토큰을 읽을 수 없다 (localStorage·sessionStorage·NEXT_PUBLIC_ 환경변수에 두지 않는다)
 * - 프론트는 토큰을 해석하거나 그 안의 역할·기관 값을 믿지 않는다. 검증은 Gateway가 하고,
 *   X-User-Id·X-Institution-Id·X-Role 헤더도 Gateway가 토큰에서 만든다 (프론트는 만들지 않는다)
 * - 쿠키가 있다는 것은 "토큰을 갖고 있다"는 뜻일 뿐 인증·권한 확인이 아니다 (getAuthState 참고)
 *
 * 쿠키 쓰기(set·delete)는 Route Handler·Server Function에서만 가능하다 (Server Component 렌더링 중에는 불가).
 */

const ACCESS_TOKEN_COOKIE = "itda_access_token";

/**
 * 토큰 쿠키 저장 (로그인 Route Handler에서 호출).
 * - Secure: HTTPS에서만 전송 (localhost는 브라우저가 안전한 출처로 보아 http에서도 동작한다. Safari는 예외일 수 있다)
 * - SameSite=Lax: 다른 사이트에서 보낸 POST·fetch에는 쿠키가 실리지 않는다. 변경 요청은 Origin 검사도 함께 한다
 * - maxAge: 백엔드 expiresIn과 같게 맞춰 토큰이 만료되면 쿠키도 사라지게 한다
 */
export async function setAccessTokenCookie(accessToken: string, expiresInSeconds: number): Promise<void> {
  (await cookies()).set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: expiresInSeconds,
  });
}

/** 토큰 쿠키 삭제 (로그아웃 Route Handler에서 호출) */
export async function clearAccessTokenCookie(): Promise<void> {
  (await cookies()).delete(ACCESS_TOKEN_COOKIE);
}

async function readAccessToken(): Promise<string | null> {
  const value = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  return value ? value : null;
}

/** 서버에서 확인한 사용자 역할 (백엔드 Role enum) */
export type UserRole = "REQUESTER" | "EXAMINER" | "ADMIN";

/**
 * 현재 요청의 인증 상태.
 * - signed-out: 토큰 쿠키 없음
 * - unverified: 토큰은 있지만 사용자를 서버에서 확인하지 못함
 * - verified: 서버(사용자 정보 API)가 확인한 사용자
 */
export type AuthState =
  | { status: "signed-out" }
  | { status: "unverified"; reason: string }
  | { status: "verified"; role: UserRole; authorization: string };

/**
 * 현재 사용자 확인 (Server Component·Route Handler에서 호출. cookies()를 읽으므로 Suspense 안에서 부른다).
 *
 * ⚠️ 사용자 정보 API(`GET /api/v1/users/me`)가 백엔드에 아직 없다 (Gateway 정책에만 규칙이 있고 컨트롤러가 없음).
 * 토큰 내용으로 역할을 추정하지 않으므로, 그 API가 생기기 전까지 토큰이 있으면 항상 unverified를 돌려준다.
 * TODO(auth): users/me 응답 DTO가 확정되면 Authorization 헤더로 호출해 역할을 확인하고 verified를 돌려준다
 * (401이면 만료·위조 토큰이므로 signed-out으로 본다).
 */
export async function getAuthState(): Promise<AuthState> {
  const token = await readAccessToken();
  if (!token) return { status: "signed-out" };
  return {
    status: "unverified",
    reason: "사용자 정보 확인 API(GET /api/v1/users/me)가 아직 준비되지 않아 권한을 확인할 수 없습니다.",
  };
}

/**
 * Gateway 요청용 인증 헤더 (`Authorization: Bearer <JWT>`).
 * verified 상태에서만 꺼낼 수 있게 해, 권한을 확인하지 않은 토큰으로 보호 API를 부르지 않게 한다.
 */
export function toAuthorizationHeaders(state: Extract<AuthState, { status: "verified" }>): HeadersInit {
  return { Authorization: state.authorization };
}

/**
 * 본인 데이터로 제한된 API 전용 인증 헤더 (`Authorization: Bearer <JWT>`). 토큰 쿠키가 없으면 null.
 *
 * 사용자 확인(getAuthState의 verified) 없이 토큰을 Gateway로 넘긴다. 아래 조건을 모두 만족하는 API에만 쓴다.
 * - Gateway가 JWT 서명·만료와 역할을 검증한다 (Gateway 정책에 경로 규칙이 있다)
 * - 백엔드가 Gateway의 X-User-Id로 요청자 본인의 데이터만 조회·변경한다 (다른 사용자·기관의 데이터를 돌려주지 않는다)
 * 현재 대상: 알림 API (`/api/v1/notifications/**`, features/notifications/server.ts·actions.ts에서만 호출).
 *
 * 제약
 * - 반환값이 있다고 로그인·권한이 확인된 것이 아니다. 화면 접근 허용·역할 판단에 쓰지 않는다 (그것은 getAuthState)
 * - 기관 단위 데이터·역할별 화면 데이터에는 쓰지 않는다: 그런 API는 verified 상태의 toAuthorizationHeaders나 해당 API 전용 함수를 쓴다
 * - 서버에서 Gateway 요청에만 붙인다. Client Component props·응답 JSON·로그로 내보내지 않는다
 */
export async function getOwnerScopedAuthorizationHeaders(): Promise<HeadersInit | null> {
  const token = await readAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/**
 * 토큰의 기관으로 범위가 정해지는 조회 API 전용 인증 헤더 (`Authorization: Bearer <JWT>`). 토큰 쿠키가 없으면 null.
 *
 * 사용자 확인(getAuthState의 verified) 없이 토큰을 Gateway로 넘긴다. 아래 조건을 모두 만족하는 API에만 쓴다.
 * - 조회(GET)만 한다
 * - Gateway가 JWT 서명·만료와 역할을 검증한다 (Gateway 정책에 경로 규칙이 있다)
 * - 백엔드가 Gateway의 X-Institution-Id·X-Role로 범위를 정한다 (다른 기관 데이터는 403·404, 프론트는 기관 ID를 보내지 않는다)
 * 현재 대상: 장비 장애 조회 API (`GET /api/v1/equipment-incidents/**`, features/incidents/server.ts에서만 호출).
 * 검사 API는 대상이 아니다 (getExaminationAuthorizationHeaders를 쓴다).
 *
 * 제약은 getOwnerScopedAuthorizationHeaders와 같다: 화면 접근·역할 판단에 쓰지 않고, 브라우저로 내보내지 않는다.
 */
export async function getInstitutionScopedAuthorizationHeaders(): Promise<HeadersInit | null> {
  const token = await readAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/**
 * 검사 API 전용 인증 헤더 (`Authorization: Bearer <JWT>`). 토큰 쿠키가 없으면 null.
 *
 * 사용자 확인(getAuthState의 verified) 없이 토큰을 Gateway로 넘긴다. getAuthState는 바꾸지 않는다.
 * 대상 API와 근거 (origin/dev 기준)
 * - `GET /api/v1/examinations`, `PATCH /api/v1/examinations/{id}/status`, `POST /api/v1/examinations/{id}/results`
 * - Gateway가 JWT 서명·만료를 검증하고 세 경로 모두 EXAMINER만 허용한다
 * - 백엔드가 Gateway의 X-Institution-Id로 범위를 정한다 (다른 기관의 검사는 403, 프론트는 기관 ID를 보내지 않는다)
 * 호출 위치: features/examinations의 ExaminationApiSection(목록)·actions.ts(상태 변경·결과 등록)에서만 쓴다.
 * 변경 요청(PATCH·POST)은 Server Function에서 같은 출처 확인을 거친 뒤에만 이 헤더를 붙인다.
 *
 * 제약은 getOwnerScopedAuthorizationHeaders와 같다: 화면 접근·역할 판단에 쓰지 않고, 브라우저로 내보내지 않는다.
 */
export async function getExaminationAuthorizationHeaders(): Promise<HeadersInit | null> {
  const token = await readAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}
