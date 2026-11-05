import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";

import ApiRoleGate, { AuthChecking, isApiAuthMode } from "@/components/auth/ApiRoleGate";
import AppShell from "@/components/layout/AppShell";
import { getNotifications } from "@/features/notifications/api";
import ApiNotificationUnreadProvider from "@/features/notifications/components/ApiNotificationUnreadProvider";
import NotificationReadProvider from "@/features/notifications/components/NotificationReadProvider";
import { loadUnreadNotificationCount } from "@/features/notifications/server";
import { getScreenDataSource, isApiFeature } from "@/lib/api/config";
import { getMockSession } from "@/lib/dev/mockSession";


/**
 * 의뢰기관 화면 공통 레이아웃.
 * - API 모드: 사용자 정보 API로 확인한 의뢰기관(REQUESTER) 사용자만 연다 (ApiRoleGate, 쿠키를 읽으므로 Suspense 안).
 *   헤더에는 확인한 실제 기관명·역할을 표시한다
 * - Mock 모드: 기존 Mock 사용자·데모 화면 그대로
 */
export default async function ReferringLayout({ children }: LayoutProps<"/referring">) {
  const shell = (content: ReactNode) =>
    isApiAuthMode() ? (
      <Suspense fallback={<AuthChecking />}>
        <ApiRoleGate role="REFERRING">{content}</ApiRoleGate>
      </Suspense>
    ) : (
      <AppShell user={getMockSession("REFERRING")}>{content}</AppShell>
    );

  if (isApiFeature("notifications")) {
    return (
      <Suspense fallback={<AuthChecking />}>
        <ReferringApiNotifications>
          {shell(children)}
        </ReferringApiNotifications>
      </Suspense>
    );
  }

  // 헤더 알림 표시와 재조정·알림 화면이 같은 알림 목록·읽음 상태를 공유한다.
  // Mock 알림은 Mock 모드에서만 쓴다 (API 모드에서 알림 기능이 꺼져 있으면 빈 목록: Mock으로 채우지 않는다)
  const notifications = getScreenDataSource("notifications") === "mock" ? await getNotifications() : [];

  return <NotificationReadProvider initialNotifications={notifications}>{shell(children)}</NotificationReadProvider>;
}

async function ReferringApiNotifications({
  children,
}: {
  children: ReactNode;
}) {
  await connection();

  return (
    <ApiNotificationUnreadProvider
      unreadCount={loadUnreadNotificationCount("notifications")}
    >
      {children}
    </ApiNotificationUnreadProvider>
  );
}
