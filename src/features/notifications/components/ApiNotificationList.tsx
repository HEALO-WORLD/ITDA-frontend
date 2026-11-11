"use client";

import { Suspense, use } from "react";

import type { ApiNotificationItem, UnreadNotificationCountResult } from "../types";

import { useApiNotificationUnread } from "./ApiNotificationUnreadProvider";
import { API_NOTIFICATION_META, NotificationRow } from "./NotificationList";
import NotificationPagination from "./NotificationPagination";
import { useApiNotificationRead } from "./useApiNotificationRead";

interface ApiNotificationListProps {
  notifications: ApiNotificationItem[];
  /** 0부터 */
  page: number;
  totalPages: number;
  /**
   * 목록과 같은 요청 시점에 조회한 읽지 않은 알림 수 (전체 알림 기준, 백엔드 unread-count).
   * 없으면 레이아웃의 조회 결과(헤더 알림 점과 같은 값)를 쓴다
   */
  unreadCount?: UnreadNotificationCountResult;
}

/**
 * 의뢰기관 알림 내역 (API 모드). 모양은 Mock 알림 내역(NotificationList)과 같다.
 * - 백엔드 페이지 단위로 보여 주고, 읽지 않은 알림 수는 레이아웃의 조회 결과(헤더 알림 점과 같은 값)를 쓴다
 * - 개별 읽음 처리만 한다: 백엔드에 전체 읽음 API가 없어 '모두 읽음 처리'는 두지 않는다
 * - 알림 유형별 표시·재조정 원인 장비는 응답에 없어 두지 않는다
 */
export default function ApiNotificationList({ notifications, page, totalPages, unreadCount: pageUnreadCount }: ApiNotificationListProps) {
  const layoutUnreadCount = useApiNotificationUnread();
  const { markAsRead, pendingIds, errorMessage, announcement, locked } = useApiNotificationRead("notifications");

  return (
    <section
      aria-labelledby="notification-list-title"
      className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <h2 id="notification-list-title" className="mb-1 text-lg font-semibold text-gray-900 sm:text-xl">
        알림 내역
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        {pageUnreadCount ? (
          <UnreadSummaryText result={pageUnreadCount} />
        ) : (
          layoutUnreadCount && (
            <Suspense fallback="읽지 않은 알림 수를 확인하고 있습니다.">
              <UnreadSummary unreadCount={layoutUnreadCount} />
            </Suspense>
          )
        )}
      </p>

      {errorMessage && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      {notifications.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-[15px] text-gray-500">
          {page === 0 ? "알림이 없습니다." : "이 페이지에 알림이 없습니다."}
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {notifications.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              meta={API_NOTIFICATION_META}
              pending={pendingIds.has(item.id)}
              locked={locked}
              onMarkAsRead={() => void markAsRead(item)}
            />
          ))}
        </ul>
      )}

      <NotificationPagination page={page} totalPages={totalPages} />
    </section>
  );
}

/** 읽지 않은 알림 수 문구 (레이아웃 조회 결과. 실패해도 Mock 값으로 대신하지 않는다) */
export function UnreadSummary({ unreadCount }: { unreadCount: Promise<UnreadNotificationCountResult> }) {
  return <UnreadSummaryText result={use(unreadCount)} />;
}

/** 읽지 않은 알림 수 문구 (조회 결과 그대로. 실패하면 0건으로 바꾸지 않는다) */
function UnreadSummaryText({ result }: { result: UnreadNotificationCountResult }) {
  if (!result.ok) return <>읽지 않은 알림 수를 확인할 수 없습니다.</>;
  return <>{result.unreadCount > 0 ? `읽지 않은 알림 ${result.unreadCount}건` : "읽지 않은 알림이 없습니다."}</>;
}
