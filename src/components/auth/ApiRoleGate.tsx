import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import Link from "next/link";

import AdminShell from "@/components/layout/AdminShell";
import AppHeader from "@/components/layout/AppHeader";
import AppShell from "@/components/layout/AppShell";
import { ADMIN_HOME_ROUTE, HOME_ROUTE_BY_ROLE, ORGANIZATION_ROLE_BY_USER_ROLE, ROUTES } from "@/constants/navigation";
import { getAuthState, readLoginSessionTag, readRefreshToken, type AuthFailureReason } from "@/lib/auth/session";
import type { OrganizationRole, SessionUser } from "@/types/auth";

import SessionGuard from "./SessionGuard";
import type { RestoreReason } from "@/features/auth/sessionRestore";

import SessionRestore from "./SessionRestore";

/**
 * API 모드 역할별 화면 접근 확인 (서버 컴포넌트, 레이아웃의 Suspense 안에서 렌더링한다).
 *
 * 사용자 정보 API(users/me)로 확인한 역할만 믿는다 (토큰을 해석하지 않고, 실패하면 Mock 사용자로 대체하지 않는다).
 * - 미로그인 → 로그인 화면 · 401(만료·위조) → 로그인 화면(만료 안내)
 * - 단, Access Token이 없거나 401인데 Refresh 쿠키가 있으면 현재 주소 그대로 자동 복구 화면을 보여 준다 (SessionRestore가 재발급 후 다시 확인).
 *   서버 컴포넌트는 쿠키를 바꾸지 않는다. 403·404·네트워크·5xx는 Refresh Token 문제가 아니므로 복구하지 않는다
 * - 확인을 통과한 화면은 SessionGuard로 감싼다: 같은 영역 안의 이동은 이 게이트를 다시 실행하지 않으므로 이동 뒤 쿠키 상태를 확인한다.
 *   이 렌더링의 로그인 세션 구분 값을 넘겨, 다른 탭에서 계정이 바뀌면(헤더는 이전 사용자) 문서를 다시 불러오게 한다
 * - 다른 역할의 화면 → 그 사용자의 첫 화면 · ADMIN이 업무 화면 → 안내 + 관리자 화면 링크 (역할 화면을 열지 않는다)
 * - role="ADMIN"(관리자 화면): users/me 역할이 ADMIN일 때만 관리자 틀(AdminShell)로 연다. REQUESTER·EXAMINER는 자기 첫 화면으로
 * - 403·404·네트워크·그 밖의 실패 → 권한을 허용하지 않고 안내 (네트워크·오류는 다시 시도)
 * 화면 데이터 API의 권한은 이와 별개로 Gateway·백엔드와 각 Server Function이 다시 확인한다.
 */

const ROLE_LABELS: Record<OrganizationRole, string> = {
  REFERRING: "의뢰기관 담당자",
  EXAMINING: "검사기관 담당자",
};

export default async function ApiRoleGate({ role, children }: { role: OrganizationRole | "ADMIN"; children: ReactNode }) {
  const state = await getAuthState();
  if (state.status === "signed-out") {
    if (await readRefreshToken()) return <SessionRestoreScreen reason="access-missing" />;
    redirect(ROUTES.login);
  }
  if (state.status === "unverified") {
    if (state.reason === "UNAUTHORIZED") {
      if (await readRefreshToken()) return <SessionRestoreScreen reason="access-rejected" />;
      redirect(`${ROUTES.login}?reason=expired`);
    }
    return <AuthProblem reason={state.reason} message={state.message} />;
  }

  const loginSession = await readLoginSessionTag();
  const userRole = ORGANIZATION_ROLE_BY_USER_ROLE[state.role];
  // 관리자 화면: users/me 역할이 ADMIN일 때만 연다. 다른 역할은 자기 첫 화면으로 보낸다
  if (role === "ADMIN") {
    if (state.role !== "ADMIN" || userRole !== null) redirect(userRole ? HOME_ROUTE_BY_ROLE[userRole] : ROUTES.login);
    return (
      <AdminShell organizationName={state.user.institutionName} roleLabel={`관리자 · ${state.user.loginId}`} showLogout>
        <SessionGuard loginSession={loginSession}>{children}</SessionGuard>
      </AdminShell>
    );
  }
  if (userRole === null) {
    return <AuthProblem reason="ADMIN" message="관리자 계정은 의뢰기관·검사기관 화면을 열 수 없습니다. 관리자 화면을 이용해 주세요." />;
  }
  if (userRole !== role) redirect(HOME_ROUTE_BY_ROLE[userRole]);

  const user: SessionUser = {
    role: userRole,
    organizationName: state.user.institutionName,
    roleLabel: `${ROLE_LABELS[userRole]} · ${state.user.loginId}`,
    hasUnreadNotifications: false,
  };
  return (
    <AppShell user={user} showLogout>
      <SessionGuard loginSession={loginSession}>{children}</SessionGuard>
    </AppShell>
  );
}

/** 사용자 확인 중 (레이아웃 Suspense fallback) */
export function AuthChecking() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader subtitle="의료기관 검사 의뢰·예약 플랫폼" />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <p role="status" className="text-[15px] text-gray-500">
          로그인 정보를 확인하고 있습니다.
        </p>
      </main>
    </div>
  );
}

/** 로그인 상태 자동 복구 (Access Token 만료, Refresh 쿠키 있음). 주소는 그대로 두고 화면만 바꾼다 */
/** reason: Access 쿠키 없음(access-missing) / Access 쿠키는 있지만 users/me 401(access-rejected) */
function SessionRestoreScreen({ reason }: { reason: RestoreReason }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader subtitle="의료기관 검사 의뢰·예약 플랫폼" />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <SessionRestore reason={reason} />
      </main>
    </div>
  );
}

const PROBLEM_TITLES: Record<AuthFailureReason | "ADMIN", string> = {
  UNAUTHORIZED: "다시 로그인해 주세요.",
  FORBIDDEN: "접근 권한이 없습니다.",
  NOT_FOUND: "사용자 정보를 확인할 수 없습니다.",
  NETWORK: "사용자 정보를 확인하지 못했습니다.",
  ERROR: "사용자 정보를 확인하지 못했습니다.",
  ADMIN: "관리자 계정입니다.",
};

const actionClass =
  "inline-flex h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-[15px] font-semibold text-gray-800 hover:bg-gray-50";

function AuthProblem({ reason, message }: { reason: AuthFailureReason | "ADMIN"; message: string }) {
  const canRetry = reason === "NETWORK" || reason === "ERROR";
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader subtitle="의료기관 검사 의뢰·예약 플랫폼" />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <section
          role="alert"
          className="flex w-full max-w-[560px] flex-col items-center gap-3 rounded-xl border border-line bg-white px-8 py-10 text-center"
        >
          <h1 className="text-xl font-bold text-gray-900">{PROBLEM_TITLES[reason]}</h1>
          <p className="text-[15px] text-gray-600">{message}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {reason === "ADMIN" && (
              <Link href={ADMIN_HOME_ROUTE} className={actionClass}>
                관리자 화면으로
              </Link>
            )}
            {canRetry && (
              // 같은 주소를 다시 요청해 사용자 확인을 다시 한다
              <form method="get">
                <button type="submit" className={actionClass}>
                  다시 시도
                </button>
              </form>
            )}
            <form action="/auth/logout" method="post">
              <button type="submit" className={actionClass}>
                로그아웃
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
