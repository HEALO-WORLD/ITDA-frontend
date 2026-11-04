import "server-only";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import { ORGANIZATION_ROLE_BY_USER_ROLE } from "@/constants/navigation";
import { fetchMyInfo, type MyInfoDto, type UserRoleDto } from "@/features/auth/remote";
import { isApiError } from "@/lib/api/errors";
import type { OrganizationRole } from "@/types/auth";

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

/** 역할 화면 데이터 접근 실패 구분 */
export type RoleAccessFailureReason =
  /** 토큰 쿠키 없음 */
  | "SIGNED_OUT"
  /** users/me 401 (만료·위조 토큰) */
  | "UNAUTHORIZED"
  /** users/me 403·404·5xx·네트워크 등으로 사용자를 확인하지 못함 */
  | "UNVERIFIED"
  /** 확인된 역할이 이 화면 역할과 다름 (ADMIN 포함) */
  | "FORBIDDEN_ROLE";

export type RoleAccess =
  | { ok: true; headers: HeadersInit; user: VerifiedUser }
  | { ok: false; reason: RoleAccessFailureReason; message: string };

/**
 * 역할 화면 데이터 접근 확인 (중앙 권한 검증). 실제 API 요청 전에 부른다.
 *
 * 레이아웃의 ApiRoleGate만으로는 부족하다: Next는 레이아웃과 페이지를 함께 렌더링하므로 게이트가 막아도 페이지의
 * 데이터 조회는 실행된다. 그래서 데이터를 조회하는 서버 함수·Server Function이 각자 이 확인을 거친다.
 * - users/me로 확인한 역할만 쓴다 (getAuthState, 한 요청 안에서는 한 번만 조회). 클라이언트가 보낸 역할은 받지 않는다
 * - REQUESTER → 의뢰기관(REFERRING) 데이터만, EXAMINER → 검사기관(EXAMINING) 데이터만, ADMIN → 둘 다 불가
 *   (백엔드가 ADMIN에게 허용하는 API라도 프론트 역할 화면에서는 허용하지 않는다)
 * - role이 "ADMIN"이면 관리자 화면 데이터: users/me 역할이 ADMIN일 때만 허용 (REQUESTER·EXAMINER 불가)
 * - 확인에 실패하면 헤더를 주지 않는다 → 호출한 쪽은 요청을 보내지 않는다
 */
export async function requireRoleAccess(role: OrganizationRole | "ADMIN"): Promise<RoleAccess> {
  const state = await getAuthState();
  if (state.status === "signed-out") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
  if (state.status === "unverified") {
    return { ok: false, reason: state.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "UNVERIFIED", message: state.message };
  }
  // ADMIN: 관리자 화면 데이터는 users/me 역할이 ADMIN일 때만. 그 밖의 역할: 화면 역할과 같을 때만 (ADMIN은 업무 화면 불가)
  const allowed = role === "ADMIN" ? state.role === "ADMIN" : ORGANIZATION_ROLE_BY_USER_ROLE[state.role] === role;
  if (!allowed) {
    return { ok: false, reason: "FORBIDDEN_ROLE", message: "이 화면의 정보에 접근할 권한이 없는 계정입니다." };
  }
  return { ok: true, headers: toAuthorizationHeaders(state), user: state.user };
}

/**
 * 접근 실패 → 데이터 함수의 공통 실패 구분 (각 기능의 실패 결과에 그대로 쓴다).
 * 만료(401)는 UNAUTHORIZED, 다른 역할·사용자 확인 실패는 FORBIDDEN (요청을 보내지 않았으므로 code는 없다).
 */
export function toRoleAccessFailure(access: Extract<RoleAccess, { ok: false }>): {
  reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN";
  message: string;
  code: null;
} {
  const reason = access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN";
  return { reason, message: access.message, code: null };
}

/** requireRoleAccess를 통과했을 때만 인증 헤더 (아래 API별 헬퍼 공통). role은 서버 코드가 정한 업무 역할이다 */
async function roleScopedHeaders(role: OrganizationRole): Promise<HeadersInit | null> {
  const access = await requireRoleAccess(role);
  return access.ok ? access.headers : null;
}

/**
 * 본인 데이터로 제한된 API 전용 인증 헤더 (`Authorization: Bearer <JWT>`).
 * 업무 역할(role)이 users/me로 확인된 경우에만 돌려주고, 그 밖에는 null (requireRoleAccess). 쿠키만으로는 주지 않는다.
 *
 * 아래 조건을 모두 만족하는 API에만 쓴다.
 * - Gateway가 JWT 서명·만료와 역할을 검증한다 (Gateway 정책에 경로 규칙이 있다)
 * - 백엔드가 Gateway의 X-User-Id로 요청자 본인의 데이터만 조회·변경한다 (다른 사용자·기관의 데이터를 돌려주지 않는다)
 * 현재 호출 위치: 없음 (알림 API는 features/notifications/server.ts·actions.ts에서 requireRoleAccess를 직접 쓴다).
 *
 * 제약
 * - role은 서버 코드가 정한 값만 넘긴다 (브라우저 입력을 그대로 넘기지 않는다)
 * - 화면 역할 확인만 한다. 데이터 범위(본인·기관)와 API별 권한은 Gateway·백엔드가 다시 확인한다
 * - 서버에서 Gateway 요청에만 붙인다. Client Component props·응답 JSON·로그로 내보내지 않는다
 */
export async function getOwnerScopedAuthorizationHeaders(role: OrganizationRole): Promise<HeadersInit | null> {
  return roleScopedHeaders(role);
}

/**
 * 토큰의 기관으로 범위가 정해지는 조회 API 전용 인증 헤더 (`Authorization: Bearer <JWT>`).
 * 업무 역할(role)이 users/me로 확인된 경우에만 돌려주고, 그 밖에는 null (requireRoleAccess). 쿠키만으로는 주지 않는다.
 *
 * 아래 조건을 모두 만족하는 API에만 쓴다.
 * - 조회(GET)만 한다
 * - Gateway가 JWT 서명·만료와 역할을 검증한다 (Gateway 정책에 경로 규칙이 있다)
 * - 백엔드가 Gateway의 X-Institution-Id·X-Role로 범위를 정한다 (다른 기관 데이터는 403·404, 프론트는 기관 ID를 보내지 않는다)
 * 현재 호출 위치: 없음 (장비 장애 조회 API는 features/incidents/server.ts에서 requireRoleAccess를 직접 쓴다).
 * 검사 API는 대상이 아니다 (getExaminationAuthorizationHeaders를 쓴다).
 *
 * 제약은 getOwnerScopedAuthorizationHeaders와 같다.
 */
export async function getInstitutionScopedAuthorizationHeaders(role: OrganizationRole): Promise<HeadersInit | null> {
  return roleScopedHeaders(role);
}

/**
 * 검사 API 전용 인증 헤더 (`Authorization: Bearer <JWT>`).
 * 검사기관(EXAMINING) 역할이 users/me로 확인된 경우에만 돌려주고, 그 밖에는 null (requireRoleAccess). 쿠키만으로는 주지 않는다.
 * 대상 API와 근거 (origin/dev 기준)
 * - `GET /api/v1/examinations`, `PATCH /api/v1/examinations/{id}/status`, `POST /api/v1/examinations/{id}/results`
 * - Gateway가 JWT 서명·만료를 검증하고 세 경로 모두 EXAMINER만 허용한다
 * - 백엔드가 Gateway의 X-Institution-Id로 범위를 정한다 (다른 기관의 검사는 403, 프론트는 기관 ID를 보내지 않는다)
 * 호출 위치: features/examinations의 ExaminationApiSection(목록). 상태 변경·결과 등록(actions.ts)은 실패 원인을 안내하려고
 * requireRoleAccess를 직접 쓴다.
 *
 * 제약은 getOwnerScopedAuthorizationHeaders와 같다.
 */
export async function getExaminationAuthorizationHeaders(): Promise<HeadersInit | null> {
  return roleScopedHeaders("EXAMINING");
}
