import AppShell from "@/components/layout/AppShell";
import { getNotifications } from "@/features/notifications/api";
import ApiNotificationUnreadProvider from "@/features/notifications/components/ApiNotificationUnreadProvider";
import NotificationReadProvider from "@/features/notifications/components/NotificationReadProvider";
import { loadUnreadNotificationCount } from "@/features/notifications/server";
import { isApiFeature } from "@/lib/api/config";
import { getMockSession } from "@/lib/dev/mockSession";

export default async function ReferringLayout({ children }: LayoutProps<"/referring">) {
  // TODO(auth): 인증 연동 시 서버 세션으로 교체하고, 의뢰기관 권한이 없으면 접근을 차단한다.
  const user = getMockSession("REFERRING");

  if (isApiFeature("notifications")) {
    // API 모드: 헤더 알림 점은 읽지 않은 알림 수 API로 표시한다 (Mock 알림·세션 값을 쓰지 않는다).
    // 기다리지 않고 Promise로 넘겨 쿠키를 읽는 조회가 화면 전체를 막지 않게 한다 (쓰는 쪽이 Suspense 안에서 읽는다)
    return (
      <ApiNotificationUnreadProvider unreadCount={loadUnreadNotificationCount("notifications")}>
        <AppShell user={user}>{children}</AppShell>
      </ApiNotificationUnreadProvider>
    );
  }

  // 헤더 알림 표시와 재조정·알림 화면이 같은 알림 목록·읽음 상태를 공유한다
  const notifications = await getNotifications();

  return (
    <NotificationReadProvider initialNotifications={notifications}>
      <AppShell user={user}>{children}</AppShell>
    </NotificationReadProvider>
  );
}
