import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";

import ApiRoleGate, { AuthChecking } from "@/components/auth/ApiRoleGate";
import ApiNotificationUnreadProvider from "@/features/notifications/components/ApiNotificationUnreadProvider";
import { loadUnreadNotificationCount } from "@/features/notifications/server";


/**
 * 의뢰기관 화면 공통 레이아웃.
 * 사용자 정보 API로 확인한 의뢰기관(REQUESTER) 사용자만 연다.
 */
export default async function ReferringLayout({ children }: LayoutProps<"/referring">) {
  return (
    <Suspense fallback={<AuthChecking />}>
      <ReferringApiNotifications>
        <Suspense fallback={<AuthChecking />}>
          <ApiRoleGate role="REFERRING">{children}</ApiRoleGate>
        </Suspense>
      </ReferringApiNotifications>
    </Suspense>
  );
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
