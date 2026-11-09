"use client";

import { AlertCircle, Bell, Check, CheckCircle2, FileCheck2, XCircle, type LucideIcon } from "lucide-react";

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
  RESULT_REGISTERED: { label: "검사 결과 등록", icon: FileCheck2, className: "bg-info-soft text-info" },
};

/** API 알림 표시. 백엔드 알림 유형 값 목록이 확정되지 않아 유형별 아이콘·문구를 붙이지 않는다 */
export const API_NOTIFICATION_META: NotificationTypeMeta = {
  label: "알림",
  icon: Bell,
  className: "bg-info-soft text-info",
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

/**
 * 알림 한 줄 (Mock 목록과 API 목록 공통). `pending`이면 읽음 처리를 잠근다.
 * - 읽지 않은 알림: 알림 내용(제목·본문) 영역 전체가 버튼이라 클릭·Enter·Space로 읽음 처리하고, 날짜·NEW 옆 [읽음으로 표시]도 같은 처리를 한다
 *   (두 버튼은 형제로 둔다: 버튼 안에 버튼을 넣지 않는다. 내용 버튼 안에는 문단 대신 span만 쓴다)
 *   [읽음으로 표시]는 보조 기능이라 테두리 없는 Ghost 버튼으로 날짜 줄에 맞추고, 행 높이를 늘리지 않는다
 * - 이미 읽은 알림: 내용은 일반 텍스트라 클릭해도 요청하지 않는다 (NEW 배지·버튼 없음)
 * 읽음 처리는 알림 표시 상태만 바꾼다. 의뢰·예약의 재조정 필요 상태는 그대로다
 */
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
  const unread = !item.isRead;

  // 알림 내용 (제목·본문). 읽지 않은 알림에서는 이 영역 전체가 읽음 처리 버튼이 된다
  const content = (
    <>
      <span className={`block min-w-0 break-words text-[15px] ${unread ? "font-bold text-gray-900" : "font-medium text-gray-600"}`}>
        <span className="sr-only">{label} 알림: </span>
        {item.title}
      </span>
      <span className={`mt-1 block break-words text-sm ${unread ? "text-gray-700" : "text-gray-500"}`}>{item.message}</span>
    </>
  );

  return (
    <li className={`flex gap-3 px-3 py-4 transition-colors ${unread ? "bg-primary-soft/50" : ""}`}>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${className} ${unread ? "" : "opacity-60"}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      {/* 넓은 화면: [내용 | 날짜·NEW·읽음으로 표시]를 한 줄 위에 맞춘다. 모바일: 내용 아래 한 줄에 날짜·NEW와 오른쪽 끝 버튼 */}
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-3">
        {unread ? (
          <button
            type="button"
            onClick={onMarkAsRead}
            disabled={pending}
            aria-busy={pending}
            className="-mx-1.5 -my-1 block min-w-0 cursor-pointer rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait"
          >
            {content}
            <span className="sr-only"> (선택하면 읽음 처리)</span>
          </button>
        ) : (
          <div className="min-w-0">{content}</div>
        )}
        <div className="flex min-w-0 items-center gap-2 sm:items-start sm:justify-end sm:pt-0.5">
          <time
            dateTime={item.occurredAt}
            title={formatDateTimeWithWeekday(item.occurredAt)}
            className="whitespace-nowrap text-[13px] tabular-nums text-gray-500"
          >
            {formatShortDateTime(item.occurredAt)}
          </time>
          {unread && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white" role="img" aria-label="읽지 않음">
              <span aria-hidden="true">NEW</span>
            </span>
          )}
          {unread && (
            // 보조 기능: 테두리 없는 Ghost 버튼. 클릭 영역은 높이 32px이지만 위아래 음수 여백으로 날짜 줄 높이를 늘리지 않는다
            <button
              type="button"
              onClick={onMarkAsRead}
              disabled={pending}
              aria-busy={pending}
              aria-label={`'${item.title}' 알림 읽음으로 표시`}
              className="-my-1.5 ml-auto inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] font-semibold text-primary underline-offset-2 transition-colors hover:bg-primary-soft hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline disabled:hover:bg-transparent sm:-mr-2 sm:ml-0"
            >
              <Check className="size-3.5" aria-hidden="true" />
              {pending ? "처리 중" : "읽음으로 표시"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
