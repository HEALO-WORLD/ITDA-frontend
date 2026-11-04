"use client";

import { AlertCircle, Bell, CheckCircle2, FileCheck2, XCircle, type LucideIcon } from "lucide-react";

import { formatDateTimeWithWeekday, formatShortDateTime } from "@/lib/format/date";

import type { NotificationItem, NotificationType } from "../types";

import { useNotificationRead } from "./NotificationReadProvider";

interface NotificationTypeMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

/** 알림 유형별 아이콘·색상 (재조정=빨강, 확정=초록, 취소=회색, 결과 등록=파랑) */
const TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  RESCHEDULE_REQUIRED: { label: "재조정 필요", icon: AlertCircle, className: "bg-red-50 text-red-600" },
  RESERVATION_CONFIRMED: { label: "예약 확정", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  RESERVATION_CANCELLED: { label: "예약 취소", icon: XCircle, className: "bg-gray-100 text-gray-500" },
  RESULT_REGISTERED: { label: "검사 결과 등록", icon: FileCheck2, className: "bg-primary-soft text-primary" },
};

/** API 알림 표시. 백엔드 알림 유형 값 목록이 확정되지 않아 유형별 아이콘·문구를 붙이지 않는다 */
export const API_NOTIFICATION_META: NotificationTypeMeta = {
  label: "알림",
  icon: Bell,
  className: "bg-primary-soft text-primary",
};

/**
 * 알림 내역과 읽음 처리.
 * 읽음 처리는 알림 표시 상태에만 영향을 주며, 예약의 재조정 필요 상태는 그대로다.
 */
export default function NotificationList() {
  const context = useNotificationRead();
  if (!context) return null;
  const { notifications, unreadCount, markAsRead, markAllAsRead } = context;

  return (
    <section
      aria-labelledby="notification-list-title"
      className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id="notification-list-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
          알림 내역
        </h2>
        <button
          type="button"
          onClick={markAllAsRead}
          disabled={unreadCount === 0}
          className="rounded text-[15px] font-medium text-primary underline underline-offset-4 hover:text-primary-hover disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
        >
          모두 읽음 처리
        </button>
      </div>
      <p className="mb-3 text-sm text-gray-500" aria-live="polite">
        {unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}건` : "읽지 않은 알림이 없습니다."}
      </p>

      {notifications.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-[15px] text-gray-500">
          알림이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {notifications.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              meta={TYPE_META[item.type]}
              onMarkAsRead={() => markAsRead(item.id)}
            />
          ))}
        </ul>
      )}

      <p className="mt-4 rounded border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        개발용 예시 데이터입니다. 읽음 처리는 현재 화면에만 반영되며 새로고침하면 초기화됩니다.
      </p>
    </section>
  );
}

/** 알림 한 줄 (Mock 목록과 API 목록 공통). `pending`이면 읽음 처리 버튼을 잠근다 */
export function NotificationRow({
  item,
  meta,
  onMarkAsRead,
  pending,
}: {
  item: Pick<NotificationItem, "title" | "message" | "occurredAt" | "isRead">;
  meta: NotificationTypeMeta;
  onMarkAsRead: () => void;
  pending?: boolean;
}) {
  const { label, icon: Icon, className } = meta;

  return (
    <li className="flex gap-3 py-4">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${className}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[15px] text-gray-900 ${item.isRead ? "font-medium" : "font-bold"}`}>
            <span className="sr-only">{label} 알림: </span>
            {item.title}
          </p>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <time
              dateTime={item.occurredAt}
              title={formatDateTimeWithWeekday(item.occurredAt)}
              className="text-sm text-gray-500"
            >
              {formatShortDateTime(item.occurredAt)}
            </time>
            {!item.isRead && (
              <span className="size-2.5 rounded-full bg-primary" role="img" aria-label="읽지 않음" />
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-600">{item.message}</p>
        {!item.isRead && (
          <button
            type="button"
            onClick={onMarkAsRead}
            disabled={pending}
            aria-busy={pending}
            className={`mt-1.5 rounded text-sm font-medium text-primary hover:underline${
              pending === undefined ? "" : " disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
            }`}
          >
            {pending ? "처리 중" : "읽음 처리"}
          </button>
        )}
      </div>
    </li>
  );
}
