import { Suspense, type ReactNode } from "react";

import ApiRoleGate, { AuthChecking, isApiAuthMode } from "@/components/auth/ApiRoleGate";
import AppShell from "@/components/layout/AppShell";
import { getCurrentExaminingOrganizationId } from "@/features/equipment/api";
import { getExaminingNotifications } from "@/features/examining-notifications/api";
import ExaminingNotificationReadProvider from "@/features/examining-notifications/components/ExaminingNotificationReadProvider";
import ApiNotificationUnreadProvider from "@/features/notifications/components/ApiNotificationUnreadProvider";
import { loadUnreadNotificationCount } from "@/features/notifications/server";
import { isApiFeature } from "@/lib/api/config";
import { getMockSession } from "@/lib/dev/mockSession";

/**
 * 검사기관 화면 공통 레이아웃.
 * - API 모드: 사용자 정보 API로 확인한 검사기관(EXAMINER) 사용자만 연다 (ApiRoleGate, 쿠키를 읽으므로 Suspense 안).
 *   헤더에는 확인한 실제 기관명·역할을 표시한다
 * - Mock 모드: 기존 Mock 사용자·데모 화면 그대로
 */
export default async function ExaminingLayout({ children }: LayoutProps<"/examining">) {
  const shell = (content: ReactNode) =>
    isApiAuthMode() ? (
      <Suspense fallback={<AuthChecking />}>
        <ApiRoleGate role="EXAMINING">{content}</ApiRoleGate>
      </Suspense>
    ) : (
      <AppShell user={getMockSession("EXAMINING")}>{content}</AppShell>
    );

  if (isApiFeature("examining-notifications")) {
    // API 모드: 헤더 알림 점은 읽지 않은 알림 수 API로 표시한다 (Mock 기관 ID·알림·세션 값을 쓰지 않는다).
    // 기다리지 않고 Promise로 넘겨 쿠키를 읽는 조회가 화면 전체를 막지 않게 한다 (쓰는 쪽이 Suspense 안에서 읽는다)
    return (
      <ApiNotificationUnreadProvider unreadCount={loadUnreadNotificationCount("examining-notifications")}>
        {shell(children)}
      </ApiNotificationUnreadProvider>
    );
  }
  // 헤더 알림 표시와 알림 화면이 같은 알림 목록·읽음 상태를 공유한다 (현재 검사기관 알림만)
  const organizationId = await getCurrentExaminingOrganizationId();
  const notifications = organizationId ? await getExaminingNotifications(organizationId) : [];

  return (
    <ExaminingNotificationReadProvider initialNotifications={notifications}>{shell(children)}</ExaminingNotificationReadProvider>
  );
}
