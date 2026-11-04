import { Suspense } from "react";

import ApiRoleGate, { AuthChecking, isApiAuthMode } from "@/components/auth/ApiRoleGate";
import AdminShell from "@/components/layout/AdminShell";

/**
 * 관리자 화면 공통 레이아웃.
 * - API 모드: 사용자 정보 API(users/me)로 확인한 ADMIN만 연다 (ApiRoleGate role="ADMIN", 쿠키를 읽으므로 Suspense 안).
 *   REQUESTER·EXAMINER는 자기 첫 화면으로, 미로그인·만료는 로그인 화면으로 간다.
 *   레이아웃과 페이지는 함께 렌더링되므로 관리자 데이터 조회·변경 함수도 각자 ADMIN을 다시 확인한다 (features/admin/server.ts·actions.ts)
 * - Mock 모드: 관리자 화면은 실제 API에서만 제공한다 (데모 틀만 보이고, 가짜 관리자 데이터는 만들지 않는다)
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  if (isApiAuthMode()) {
    return (
      <Suspense fallback={<AuthChecking />}>
        <ApiRoleGate role="ADMIN">{children}</ApiRoleGate>
      </Suspense>
    );
  }
  return (
    <AdminShell organizationName="관리자 화면 (데모)" roleLabel="관리자 · 데모">
      {children}
    </AdminShell>
  );
}
