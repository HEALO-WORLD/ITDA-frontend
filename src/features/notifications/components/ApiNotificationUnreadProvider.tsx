"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { UnreadNotificationCountResult } from "../types";

const ApiNotificationUnreadContext = createContext<Promise<UnreadNotificationCountResult> | null>(null);

interface ApiNotificationUnreadProviderProps {
  /** 레이아웃이 기다리지 않고 넘긴 조회 Promise. 쓰는 쪽(헤더 알림 점·알림 목록)이 Suspense 안에서 use()로 읽는다 */
  unreadCount: Promise<UnreadNotificationCountResult>;
  children: ReactNode;
}

/**
 * API 모드의 읽지 않은 알림 수 (의뢰기관·검사기관 공통). 헤더 알림 점과 알림 목록이 같은 조회 결과를 쓴다.
 * 읽음 처리 후 Server Function의 refresh()로 레이아웃이 다시 렌더링되면 새 Promise로 바뀐다.
 * Mock 모드에서는 쓰지 않는다 (NotificationReadProvider·ExaminingNotificationReadProvider).
 */
export default function ApiNotificationUnreadProvider({ unreadCount, children }: ApiNotificationUnreadProviderProps) {
  return <ApiNotificationUnreadContext value={unreadCount}>{children}</ApiNotificationUnreadContext>;
}

/** Provider 밖(Mock 모드 등)에서는 null */
export function useApiNotificationUnread(): Promise<UnreadNotificationCountResult> | null {
  return useContext(ApiNotificationUnreadContext);
}
