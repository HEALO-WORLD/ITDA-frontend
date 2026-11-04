import "server-only";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import { fetchMyInfo, type MyInfoDto, type UserRoleDto } from "@/features/auth/remote";
import { isApiError } from "@/lib/api/errors";

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
export type UserRole = UserRoleDto;

/** 사용자 정보 API로 확인한 사용자 (화면 표시·역할 판단용. 토큰은 담지 않는다) */
export type VerifiedUser = MyInfoDto;

/**
 * 사용자 확인 실패 구분
 * - UNAUTHORIZED: 401 (토큰 만료·위조) → 다시 로그인
 * - FORBIDDEN: 403 (Gateway가 사용자 정보 조회를 허용하지 않음)
 * - NOT_FOUND: 404 (실행 중인 백엔드에 users/me가 없거나 사용자가 삭제됨)
 * - NETWORK: 연결 실패·시간 초과 (다시 시도할 수 있음)
 * - ERROR: 5xx·응답 형식 오류·설정 오류
 */
export type AuthFailureReason = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NETWORK" | "ERROR";

/**
 * 현재 요청의 인증 상태.
 * - signed-out: 토큰 쿠키 없음
 * - unverified: 토큰은 있지만 사용자 정보 API로 확인하지 못함 (권한을 허용하지 않는다)
 * - verified: 사용자 정보 API(`GET /api/v1/users/me`)가 확인한 사용자
 */
export type AuthState =
  | { status: "signed-out" }
  | { status: "unverified"; reason: AuthFailureReason; message: string }
  | { status: "verified"; role: UserRole; authorization: string; user: VerifiedUser };

const AUTH_FAILURE_MESSAGES: Record<AuthFailureReason, string> = {
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "사용자 정보를 확인할 권한이 없습니다. 관리자에게 문의해 주세요.",
  NOT_FOUND:
    "사용자 정보를 확인할 수 없습니다. 실행 중인 서버에 사용자 정보 확인 기능(GET /api/v1/users/me)이 아직 반영되지 않았을 수 있습니다.",
  NETWORK: "사용자 정보 확인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  ERROR: "사용자 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

/**
 * 토큰으로 사용자 정보 API를 불러 사용자를 확인한다 (getAuthState·로그인 Route Handler 공용).
 * 토큰을 해석해 역할을 추정하지 않는다. 확인에 실패하면 unverified이며, Mock 사용자로 대체하지 않는다.
 */
export async function verifyAccessToken(token: string): Promise<Exclude<AuthState, { status: "signed-out" }>> {
  const authorization = `Bearer ${token}`;
  try {
    const user = await fetchMyInfo({ Authorization: authorization });
    return { status: "verified", role: user.role, authorization, user };
  } catch (error) {
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않는다
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    const kind = isApiError(error) ? error.kind : null;
    const reason: AuthFailureReason =
      status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : kind === "NETWORK" || kind === "TIMEOUT"
              ? "NETWORK"
              : "ERROR";
    // 토큰·응답 본문은 남기지 않는다
    if (reason !== "UNAUTHORIZED") {
      console.error("[auth] 사용자 정보 확인 실패:", kind ? `${kind} ${status ?? ""} ${isApiError(error) ? (error.code ?? "") : ""}`.trim() : "unknown");
    }
    // 404 중 USER_NOT_FOUND는 API는 있지만 계정이 없는 경우다 (그 밖의 404는 API 미반영 가능성)
    const message =
      reason === "NOT_FOUND" && isApiError(error) && error.code === "USER_NOT_FOUND"
        ? "사용자 계정을 찾을 수 없습니다. 관리자에게 문의해 주세요."
        : AUTH_FAILURE_MESSAGES[reason];
    return { status: "unverified", reason, message };
  }
}

/**
 * 현재 사용자 확인 (Server Component·Route Handler·Server Function에서 호출. cookies()를 읽으므로 Server Component는 Suspense 안에서 부른다).
 * 토큰 쿠키가 있으면 `GET /api/v1/users/me`로 확인한다. 한 요청 안에서는 한 번만 조회한다 (React cache).
 * API 모드 전용이다: Mock 모드에서는 공통 API Client가 요청하지 않아 unverified(ERROR)가 된다 (Mock 화면은 이 함수를 쓰지 않는다).
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const token = await readAccessToken();
  if (!token) return { status: "signed-out" };
  return verifyAccessToken(token);
});

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
