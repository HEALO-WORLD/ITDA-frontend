"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { Suspense, use } from "react";

import { useExaminingNotificationRead } from "@/features/examining-notifications/components/ExaminingNotificationReadProvider";

import type { UnreadNotificationCountResult } from "../types";

import { useApiNotificationUnread } from "./ApiNotificationUnreadProvider";
import { useNotificationRead } from "./NotificationReadProvider";

interface NotificationBellLinkProps {
  href: string;
  /** 알림 읽음 상태 Provider가 없는 화면에서 쓰는 값 */
  fallbackHasUnread: boolean;
}

const linkClass = "relative inline-flex size-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900";

/** 헤더 알림 아이콘. 읽지 않은 알림이 있으면 점을 표시한다 */
export default function NotificationBellLink({ href, fallbackHasUnread }: NotificationBellLinkProps) {
  // 의뢰기관·검사기관은 각자의 레이아웃에 자기 Provider만 두므로 둘 중 하나만 값이 있다
  const referringContext = useNotificationRead();
  const examiningContext = useExaminingNotificationRead();
  // API 모드: 읽지 않은 알림 수 API 결과만 쓴다 (실패·로그인 전이면 점을 표시하지 않는다. Mock 세션 값으로 대신하지 않는다)
  const apiUnreadCount = useApiNotificationUnread();

  if (apiUnreadCount) {
    return (
      <Link href={href} className={linkClass}>
        <Bell className="size-5" strokeWidth={1.8} aria-hidden="true" />
        <Suspense fallback={<span className="sr-only">알림</span>}>
          <ApiUnreadIndicator unreadCount={apiUnreadCount} />
        </Suspense>
      </Link>
    );
  }

  const context = referringContext ?? examiningContext;
  const hasUnread = context ? context.unreadCount > 0 : fallbackHasUnread;

  return (
    <Link
      href={href}
      className={linkClass}
      aria-label={hasUnread ? "알림 (읽지 않은 알림 있음)" : "알림"}
    >
      <Bell className="size-5" strokeWidth={1.8} aria-hidden="true" />
      {hasUnread && <UnreadDot />}
    </Link>
  );
}

function ApiUnreadIndicator({ unreadCount }: { unreadCount: Promise<UnreadNotificationCountResult> }) {
  const result = use(unreadCount);
  const hasUnread = result.ok && result.unreadCount > 0;
  return (
    <>
      <span className="sr-only">{hasUnread ? "알림 (읽지 않은 알림 있음)" : "알림"}</span>
      {hasUnread && <UnreadDot />}
    </>
  );
}

function UnreadDot() {
  return <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-white" />;
}
