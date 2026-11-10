"use client";

import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  RotateCcw,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ROUTES } from "@/constants/navigation";
import { formatDateTime, formatDateTimeWithWeekday } from "@/lib/format/date";

import type { ExaminingNotification, ExaminingNotificationType } from "../types";

import { useExaminingNotificationRead } from "./ExaminingNotificationReadProvider";

interface NotificationTypeMeta {
  label: string;
  icon: LucideIcon;
  iconClass: string;
  badgeClass: string;
}

/** 알림 유형별 아이콘·색상 (신규=파랑, 취소=회색, 변경=주황, 장애=빨강, 복구=초록) */
const TYPE_META: Record<ExaminingNotificationType, NotificationTypeMeta> = {
  RESERVATION_RECEIVED: {
    label: "신규 예약",
    icon: Bell,
    iconClass: "bg-primary-soft text-primary",
    badgeClass: "bg-primary-soft text-primary",
  },
  RESERVATION_CANCELLED: {
    label: "예약 취소",
    icon: XCircle,
    iconClass: "bg-gray-100 text-gray-500",
    badgeClass: "bg-gray-100 text-gray-600",
  },
  RESERVATION_CHANGED: {
    label: "예약 변경",
    icon: CalendarClock,
    iconClass: "bg-amber-50 text-amber-600",
    badgeClass: "bg-amber-50 text-amber-800",
  },
  EQUIPMENT_FAILURE: {
    label: "장비 장애",
    icon: AlertTriangle,
    iconClass: "bg-red-50 text-red-600",
    badgeClass: "bg-red-50 text-red-600",
  },
  EQUIPMENT_RECOVERED: {
    label: "장비 복구",
    icon: Wrench,
    iconClass: "bg-emerald-50 text-emerald-600",
    badgeClass: "bg-emerald-50 text-emerald-700",
  },
};

/** API 알림 표시. 백엔드 알림 유형 값 목록이 확정되지 않아 유형별 아이콘·문구를 붙이지 않는다 */
export const API_NOTIFICATION_META: NotificationTypeMeta = {
  label: "알림",
  icon: Bell,
  iconClass: "bg-primary-soft text-primary",
  badgeClass: "bg-primary-soft text-primary",
};

const TYPE_OPTIONS =Object.entries(TYPE_META) as [ExaminingNotificationType, (typeof TYPE_META)[ExaminingNotificationType]][];

/**
 * 관련 업무 화면. 예약·장애 화면은 URL로 특정 상세를 여는 기능이 없어 목록 화면으로만 이동한다.
 * (버튼 문구도 실제 동작대로 '…로 이동')
 */
const TARGET_LINK = {
  RESERVATION: { href: ROUTES.examining.reservations, label: "예약 관리로 이동" },
  INCIDENT: { href: ROUTES.examining.incidents, label: "장애 관리로 이동" },
} as const;

type ReadFilter = "ALL" | "UNREAD";

/**
 * 검사기관 알림 목록과 읽음 처리.
 * 알림·읽음 상태는 레이아웃의 ExaminingNotificationReadProvider에서 받아 헤더 알림 점과 공유한다.
 * 필터는 바로 적용된다 (전체/읽지 않음 × 알림 유형).
 */
export default function ExaminingNotificationBoard() {
  const context = useExaminingNotificationRead();
  const [readFilter, setReadFilter] = useState<ReadFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<ExaminingNotificationType | "">("");
  const [announcement, setAnnouncement] = useState("");
  const listTitleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** 읽음 처리한 알림 (목록 갱신 뒤 포커스를 옮길 기준) */
  const focusAfterReadRef = useRef<{ id: string; index: number } | null>(null);

  const notifications = context?.notifications ?? [];
  const byType = typeFilter ? notifications.filter(({ type }) => type === typeFilter) : notifications;
  const unreadByType = byType.filter(({ isRead }) => !isRead);
  const visible = readFilter === "UNREAD" ? unreadByType : byType;
  const isDefaultFilter = readFilter === "ALL" && typeFilter === "";

  /**
   * 읽음 처리 후 포커스: 그 알림이 남아 있으면 그 알림의 이동 버튼,
   * '읽지 않음' 필터로 빠졌으면 같은 위치의 다음 알림, 남은 알림이 없으면 목록 제목
   */
  useEffect(() => {
    if (!focusAfterReadRef.current) return;
    const { id, index } = focusAfterReadRef.current;
    focusAfterReadRef.current = null;
    const target = visible.find((item) => item.id === id) ?? visible[Math.min(index, visible.length - 1)];
    const button = target
      ? listRef.current?.querySelector<HTMLElement>(`[data-notification-id="${target.id}"] [data-focus-target]`)
      : null;
    (button ?? listTitleRef.current)?.focus();
  }, [visible]);

  if (!context) return null;
  const { unreadCount, markAsRead, markAllAsRead } = context;

  const handleMarkAsRead = (item: ExaminingNotification) => {
    focusAfterReadRef.current = { id: item.id, index: visible.findIndex(({ id }) => id === item.id) };
    markAsRead(item.id);
    setAnnouncement(`'${item.title}' 알림을 읽음 처리했습니다.`);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead();
    setAnnouncement("모든 알림을 읽음 처리했습니다.");
    // [모두 읽음]은 처리 후 비활성화되어 포커스를 잃으므로 목록 제목으로 옮긴다
    listTitleRef.current?.focus();
  };

  const resetFilters = () => {
    setReadFilter("ALL");
    setTypeFilter("");
  };

  const emptyMessage =
    notifications.length === 0
      ? "받은 알림이 없습니다."
      : readFilter === "UNREAD" && unreadByType.length === 0 && byType.length > 0
        ? "읽지 않은 알림이 없습니다."
        : "선택한 조건에 맞는 알림이 없습니다.";

  return (
    <div className="flex flex-col gap-5">
      {/* 상태 변경 안내 (스크린리더) */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <section
        aria-label="알림 필터"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-white px-5 py-4 sm:px-6"
      >
        <div role="group" aria-label="읽음 상태" className="flex gap-1.5">
          <FilterToggle
            label="전체"
            count={byType.length}
            pressed={readFilter === "ALL"}
            onClick={() => setReadFilter("ALL")}
          />
          <FilterToggle
            label="읽지 않음"
            count={unreadByType.length}
            pressed={readFilter === "UNREAD"}
            onClick={() => setReadFilter("UNREAD")}
          />
        </div>
        <span className="hidden h-6 w-px bg-line lg:block" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <label htmlFor="examining-notification-type" className="whitespace-nowrap text-[15px] font-bold text-gray-800">
            알림 유형
          </label>
          <div className="relative">
            <select
              id="examining-notification-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ExaminingNotificationType | "")}
              className="h-10 w-[180px] cursor-pointer appearance-none rounded-lg border border-line bg-white pl-3 pr-9 text-[15px] text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">전체 유형</option>
              {TYPE_OPTIONS.map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-500"
              aria-hidden="true"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={resetFilters}
          disabled={isDefaultFilter}
          className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-white"
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
          {/* 남은 알림이 없을 때 포커스를 받을 수 있게 tabIndex -1 (Tab 순서에는 넣지 않는다) */}
          <h2
            id="examining-notification-list-title"
            ref={listTitleRef}
            tabIndex={-1}
            className="rounded text-lg font-bold text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            알림 목록
            <span className="ml-2 text-base font-semibold tabular-nums text-primary">{visible.length}건</span>
          </h2>
          <button
            type="button"
            onClick={handleMarkAllAsRead}
            disabled={unreadCount === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-white"
          >
            <Check className="size-4" aria-hidden="true" />
            모두 읽음
          </button>
        </div>

        {visible.length === 0 ? (
          <p
            role="status"
            className="mb-4 mt-2 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[15px] text-gray-500"
          >
            {emptyMessage}
          </p>
        ) : (
          <ul ref={listRef} className="divide-y divide-line">
            {visible.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                meta={TYPE_META[item.type]}
                link={TARGET_LINK[item.target.kind]}
                onMarkAsRead={() => handleMarkAsRead(item)}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="rounded border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        개발용 예시 데이터입니다. 읽음 처리는 현재 화면에만 반영되며 새로고침하면 초기화됩니다. 예약·장애 상태는 바뀌지 않습니다.
      </p>
    </div>
  );
}

/** 읽음 상태 필터 버튼 (Mock·API 공통). count가 없으면 건수를 표시하지 않는다 */
export function FilterToggle({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count?: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-10 whitespace-nowrap rounded-lg border px-4 text-[15px] font-semibold transition-colors ${
        pressed ? "border-primary bg-primary text-white" : "border-line bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
      {count !== undefined && (
        <>
          {" "}
          <span className="tabular-nums">{count}</span>
        </>
      )}
    </button>
  );
}

/**
 * 알림 한 줄 (Mock·API 공통).
 * - link가 null이면 관련 화면 이동 버튼을 두지 않는다 (API 응답에는 관련 화면 정보가 없다)
 * - pending이면 읽음 처리 버튼을 잠근다
 */
export function NotificationRow({
  item,
  meta,
  link,
  onMarkAsRead,
  pending,
  locked,
}: {
  item: Pick<ExaminingNotification, "id" | "title" | "message" | "occurredAt" | "isRead">;
  meta: NotificationTypeMeta;
  link: { href: string; label: string } | null;
  onMarkAsRead: () => void;
  pending?: boolean;
  /** 읽음 처리를 잠근다 (API 모드: 다른 탭에서 로그인 계정이 바뀜). 처리 중과 달리 '처리 중'으로 보이지 않는다. Mock은 넘기지 않는다 */
  locked?: boolean;
}) {
  const { label, icon: Icon, iconClass, badgeClass } = meta;

  return (
    <li data-notification-id={item.id} className="flex gap-4 py-4">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={`whitespace-nowrap rounded-md px-2.5 py-0.5 text-sm font-medium ${badgeClass}`}>{label}</span>
            <p className={`break-words text-[15px] text-gray-900 ${item.isRead ? "font-medium" : "font-bold"}`}>
              {item.title}
            </p>
            {!item.isRead && (
              <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="읽지 않음" />
            )}
          </div>
          <p className="mt-1 break-words text-sm text-gray-600">{item.message}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
          <time
            dateTime={item.occurredAt}
            title={formatDateTimeWithWeekday(item.occurredAt)}
            className="whitespace-nowrap text-sm tabular-nums text-gray-500"
          >
            {formatDateTime(item.occurredAt)}
          </time>
          <div className="flex items-center gap-2">
            {!item.isRead && (
              <button
                type="button"
                onClick={onMarkAsRead}
                disabled={pending || locked}
                aria-busy={pending}
                aria-label={`'${item.title}' 읽음 처리`}
                className={`h-9 whitespace-nowrap rounded-md px-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100${
                  pending === undefined ? "" : " disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent"
                }`}
              >
                {pending ? "처리 중" : "읽음 처리"}
              </button>
            )}
            {link && (
              <Link
                href={link.href}
                data-focus-target
                className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-primary bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                {link.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
