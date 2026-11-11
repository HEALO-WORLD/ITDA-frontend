import { Suspense } from "react";

import ApiRoleGate, { AuthChecking } from "@/components/auth/ApiRoleGate";
import ApiNotificationUnreadProvider from "@/features/notifications/components/ApiNotificationUnreadProvider";
import { loadUnreadNotificationCount } from "@/features/notifications/server";

/**
 * 검사기관 화면 공통 레이아웃.
 * 사용자 정보 API로 확인한 검사기관(EXAMINER) 사용자만 연다.
 */
export default async function ExaminingLayout({ children }: LayoutProps<"/examining">) {
  return (
    <ApiNotificationUnreadProvider unreadCount={loadUnreadNotificationCount("examining-notifications")}>
      <Suspense fallback={<AuthChecking />}>
        <ApiRoleGate role="EXAMINING">{children}</ApiRoleGate>
      </Suspense>
    </ApiNotificationUnreadProvider>
  );
}
