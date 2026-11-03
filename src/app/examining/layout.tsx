import AppShell from "@/components/layout/AppShell";
import { getCurrentExaminingOrganizationId } from "@/features/equipment/api";
import { getExaminingNotifications } from "@/features/examining-notifications/api";
import ExaminingNotificationReadProvider from "@/features/examining-notifications/components/ExaminingNotificationReadProvider";
import ApiNotificationUnreadProvider from "@/features/notifications/components/ApiNotificationUnreadProvider";
import { loadUnreadNotificationCount } from "@/features/notifications/server";
import { isApiFeature } from "@/lib/api/config";
import { getMockSession } from "@/lib/dev/mockSession";

export default async function ExaminingLayout({ children }: LayoutProps<"/examining">) {
  // TODO(auth): 인증 연동 시 서버 세션으로 교체하고, 검사기관 권한이 없으면 접근을 차단한다.
  const user = getMockSession("EXAMINING");

  if (isApiFeature("examining-notifications")) {
    // API 모드: 헤더 알림 점은 읽지 않은 알림 수 API로 표시한다 (Mock 기관 ID·알림·세션 값을 쓰지 않는다).
    // 기다리지 않고 Promise로 넘겨 쿠키를 읽는 조회가 화면 전체를 막지 않게 한다 (쓰는 쪽이 Suspense 안에서 읽는다)
    return (
      <ApiNotificationUnreadProvider unreadCount={loadUnreadNotificationCount("examining-notifications")}>
        <AppShell user={user}>{children}</AppShell>
      </ApiNotificationUnreadProvider>
    );
  }
  // 헤더 알림 표시와 알림 화면이 같은 알림 목록·읽음 상태를 공유한다 (현재 검사기관 알림만)
  const organizationId = await getCurrentExaminingOrganizationId();
  const notifications = organizationId ? await getExaminingNotifications(organizationId) : [];

  return (
    <ExaminingNotificationReadProvider initialNotifications={notifications}>
      <AppShell user={user}>{children}</AppShell>
    </ExaminingNotificationReadProvider>
  );
}
