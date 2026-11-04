import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AppHeader from "@/components/layout/AppHeader";
import AppShell from "@/components/layout/AppShell";
import { HOME_ROUTE_BY_ROLE, ORGANIZATION_ROLE_BY_USER_ROLE, ROUTES } from "@/constants/navigation";
import { getApiMode } from "@/lib/api/config";
import { getAuthState, type AuthFailureReason } from "@/lib/auth/session";
import type { OrganizationRole, SessionUser } from "@/types/auth";

/**
 * API 모드 역할별 화면 접근 확인 (서버 컴포넌트, 레이아웃의 Suspense 안에서 렌더링한다).
 *
 * 사용자 정보 API(users/me)로 확인한 역할만 믿는다 (토큰을 해석하지 않고, 실패하면 Mock 사용자로 대체하지 않는다).
 * - 미로그인 → 로그인 화면 · 401(만료·위조) → 로그인 화면(만료 안내)
 * - 다른 역할의 화면 → 그 사용자의 첫 화면 · ADMIN → 관리자 화면 미구현 안내 (역할 화면을 열지 않는다)
 * - 403·404·네트워크·그 밖의 실패 → 권한을 허용하지 않고 안내 (네트워크·오류는 다시 시도)
 * 화면 데이터 API의 권한은 이와 별개로 Gateway·백엔드와 각 Server Function이 다시 확인한다.
 */

/** API 모드인지 (설정 값이 잘못되면 API 모드로 보고 접근 확인을 한다: 설정 오류로 보호가 꺼지지 않게) */
export function isApiAuthMode(): boolean {
  try {
    return getApiMode() === "api";
  } catch {
    return true;
  }
}

const ROLE_LABELS: Record<OrganizationRole, string> = {
  REFERRING: "의뢰기관 담당자",
  EXAMINING: "검사기관 담당자",
};

export default async function ApiRoleGate({ role, children }: { role: OrganizationRole; children: ReactNode }) {
  const state = await getAuthState();
  if (state.status === "signed-out") redirect(ROUTES.login);
  if (state.status === "unverified") {
    if (state.reason === "UNAUTHORIZED") redirect(`${ROUTES.login}?reason=expired`);
    return <AuthProblem reason={state.reason} message={state.message} />;
  }

  const userRole = ORGANIZATION_ROLE_BY_USER_ROLE[state.role];
  if (userRole === null) {
    return <AuthProblem reason="ADMIN" message="관리자 계정입니다. 관리자 화면은 아직 준비되지 않아 의뢰기관·검사기관 화면을 열 수 없습니다." />;
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
      {children}
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

const PROBLEM_TITLES: Record<AuthFailureReason | "ADMIN", string> = {
  UNAUTHORIZED: "다시 로그인해 주세요.",
  FORBIDDEN: "접근 권한이 없습니다.",
  NOT_FOUND: "사용자 정보를 확인할 수 없습니다.",
  NETWORK: "사용자 정보를 확인하지 못했습니다.",
  ERROR: "사용자 정보를 확인하지 못했습니다.",
  ADMIN: "관리자 화면은 준비 중입니다.",
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
