import { Suspense } from "react";

import ApiRoleGate, { AuthChecking } from "@/components/auth/ApiRoleGate";

/**
 * 관리자 화면 공통 레이아웃.
 * - API 모드: 사용자 정보 API(users/me)로 확인한 ADMIN만 연다 (ApiRoleGate role="ADMIN", 쿠키를 읽으므로 Suspense 안).
 *   REQUESTER·EXAMINER는 자기 첫 화면으로, 미로그인·만료는 로그인 화면으로 간다.
 *   레이아웃과 페이지는 함께 렌더링되므로 관리자 데이터 조회·변경 함수도 각자 ADMIN을 다시 확인한다 (features/admin/server.ts·actions.ts)
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AuthChecking />}>
      <ApiRoleGate role="ADMIN">{children}</ApiRoleGate>
    </Suspense>
  );
}
