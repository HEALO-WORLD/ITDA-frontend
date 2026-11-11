"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { ExaminingNotification } from "../types";

interface ExaminingNotificationReadContextValue {
  /** 화면에서 읽음 처리한 결과가 반영된 알림 목록 */
  notifications: ExaminingNotification[];
  unreadCount: number;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
}

const ExaminingNotificationReadContext = createContext<ExaminingNotificationReadContextValue | null>(null);

interface ExaminingNotificationReadProviderProps {
  initialNotifications: readonly ExaminingNotification[];
  children: ReactNode;
}

/**
 * 검사기관 헤더 알림 표시와 알림 화면이 같은 읽음 상태를 쓰도록 공유한다.
 * 의뢰기관 NotificationReadProvider와 따로 두어 두 역할의 읽음 상태가 섞이지 않는다.
 * 검사기관 레이아웃에 두므로 메뉴 간 이동 중에는 유지되고, 새로고침하면 초기화된다.
 *
 * ⚠️ 읽음 처리는 화면 표시 상태만 바꾼다. 서버에 저장하지 않으며 예약·장애 상태에도 영향을 주지 않는다.
 * TODO(api): 읽음 처리 API 확인 후 markAsRead/markAllAsRead에서 호출한다.
 */
export default function ExaminingNotificationReadProvider({
  initialNotifications,
  children,
}: ExaminingNotificationReadProviderProps) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());

  const value = useMemo<ExaminingNotificationReadContextValue>(() => {
    const notifications = initialNotifications.map((item) =>
      readIds.has(item.id) ? { ...item, isRead: true } : item,
    );
    return {
      notifications,
      unreadCount: notifications.filter(({ isRead }) => !isRead).length,
      markAsRead: (id) => setReadIds((prev) => new Set(prev).add(id)),
      markAllAsRead: () => setReadIds(new Set(initialNotifications.map(({ id }) => id))),
    };
  }, [initialNotifications, readIds]);

  return <ExaminingNotificationReadContext value={value}>{children}</ExaminingNotificationReadContext>;
}

/** Provider 밖(의뢰기관 화면 등)에서는 null */
export function useExaminingNotificationRead(): ExaminingNotificationReadContextValue | null {
  return useContext(ExaminingNotificationReadContext);
}
