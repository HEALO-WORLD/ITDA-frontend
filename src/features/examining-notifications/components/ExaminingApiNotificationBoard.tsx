"use client";

import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useRef, useTransition } from "react";

import { UnreadSummary } from "@/features/notifications/components/ApiNotificationList";
import { useApiNotificationUnread } from "@/features/notifications/components/ApiNotificationUnreadProvider";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { useApiNotificationRead } from "@/features/notifications/components/useApiNotificationRead";
import { NOTIFICATION_UNREAD_FILTER, type ApiNotificationItem } from "@/features/notifications/types";

import { API_NOTIFICATION_META, FilterToggle, NotificationRow } from "./ExaminingNotificationBoard";

interface ExaminingApiNotificationBoardProps {
  notifications: ApiNotificationItem[];
  /** 0부터 */
  page: number;
  totalPages: number;
  /** 현재 필터 조건의 전체 건수 */
  totalElements: number;
  unreadOnly: boolean;
}

/**
 * 검사기관 알림 목록 (API 모드). 모양은 Mock 알림 목록(ExaminingNotificationBoard)과 같다.
 * - 읽음 상태 필터는 백엔드 조건(isRead=false)으로 다시 조회하고, 페이지는 백엔드 페이지 단위로 이동한다
 * - 배포 와이어프레임처럼 알림 유형 선택·초기화·모두 읽음 자리를 둔다. 백엔드에 없는 기능은 비활성으로 두고 이유를 보인다:
 *   알림 유형 필터(유형 값 미확정·조건 없음), 모두 읽음(전체 읽음 API 없음). 관련 화면 이동은 응답에 예약·장애 정보가 없어 두지 않는다
 */
export default function ExaminingApiNotificationBoard({
  notifications,
  page,
  totalPages,
  totalElements,
  unreadOnly,
}: ExaminingApiNotificationBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isFilterPending, startFilterTransition] = useTransition();
  const unreadCount = useApiNotificationUnread();
  const { markAsRead, pendingIds, errorMessage, announcement, locked } = useApiNotificationRead("examining-notifications");
  const listTitleRef = useRef<HTMLHeadingElement>(null);

  const changeFilter = (nextUnreadOnly: boolean) => {
    if (nextUnreadOnly === unreadOnly) return;
    // 필터를 바꾸면 첫 페이지부터 다시 조회한다
    startFilterTransition(() => {
      router.push(nextUnreadOnly ? `${pathname}?filter=${NOTIFICATION_UNREAD_FILTER}` : pathname);
    });
  };

  const handleMarkAsRead = async (item: ApiNotificationItem) => {
    // 읽음 처리하면 버튼이 사라지므로(읽지 않음 필터에서는 알림도 빠진다) 목록 제목으로 포커스를 옮긴다
    if (await markAsRead(item)) listTitleRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <section
        aria-label="알림 필터"
        aria-busy={isFilterPending}
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-white px-5 py-4 sm:px-6"
      >
        <div role="group" aria-label="읽음 상태" className="flex gap-1.5">
          <FilterToggle label="전체" count={unreadOnly ? undefined : totalElements} pressed={!unreadOnly} onClick={() => changeFilter(false)} />
          <FilterToggle label="읽지 않음" count={unreadOnly ? totalElements : undefined} pressed={unreadOnly} onClick={() => changeFilter(true)} />
        </div>
        <span aria-hidden="true" className="hidden h-6 w-px bg-line sm:block" />
        <div className="flex items-center gap-2">
          <label htmlFor="examining-notification-type" className="text-sm font-semibold text-gray-700">
            알림 유형
          </label>
          <div className="relative">
            <select
              id="examining-notification-type"
              disabled
              aria-describedby="examining-notification-unavailable"
              className="h-10 cursor-not-allowed appearance-none rounded-lg border border-line bg-gray-50 pl-3 pr-9 text-sm text-gray-400"
            >
              <option>전체 유형</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
          </div>
        </div>
        {unreadCount && (
          <p className="text-sm text-gray-500">
            <Suspense fallback="읽지 않은 알림 수를 확인하고 있습니다.">
              <UnreadSummary unreadCount={unreadCount} />
            </Suspense>
          </p>
        )}
        <button
          type="button"
          onClick={() => changeFilter(false)}
          disabled={!unreadOnly}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          초기화
        </button>
      </section>

      <section
        aria-labelledby="examining-notification-list-title"
        className="min-w-0 rounded-xl border border-line bg-white px-4 pb-2 pt-5 sm:px-6"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {/* 읽음 처리 후 포커스를 받을 수 있게 tabIndex -1 (Tab 순서에는 넣지 않는다) */}
          <h2
            id="examining-notification-list-title"
            ref={listTitleRef}
            tabIndex={-1}
            className="rounded text-lg font-bold text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            알림 목록
            <span className="ml-2 text-base font-semibold tabular-nums text-primary">{totalElements}건</span>
          </h2>
          <button
            type="button"
            disabled
            aria-describedby="examining-notification-unavailable"
            className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-gray-300"
          >
            <Check className="size-4" aria-hidden="true" />
            모두 읽음
          </button>
        </div>
        <p id="examining-notification-unavailable" className="mb-2 text-xs text-gray-500">
          알림 유형 검색과 모두 읽음은 서버 기능이 준비되면 사용할 수 있습니다. 알림은 하나씩 [읽음 처리]할 수 있습니다.
        </p>

        {errorMessage && (
          <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        {notifications.length === 0 ? (
          <p
            role="status"
            className="mb-4 mt-2 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[15px] text-gray-500"
          >
            {page > 0 ? "이 페이지에 알림이 없습니다." : unreadOnly ? "읽지 않은 알림이 없습니다." : "받은 알림이 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {notifications.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                meta={API_NOTIFICATION_META}
                link={null}
                pending={pendingIds.has(item.id)}
                locked={locked}
                onMarkAsRead={() => void handleMarkAsRead(item)}
              />
            ))}
          </ul>
        )}

        <div className="pb-4">
          <NotificationPagination
            page={page}
            totalPages={totalPages}
            query={unreadOnly ? { filter: NOTIFICATION_UNREAD_FILTER } : {}}
          />
        </div>
      </section>
    </div>
  );
}
