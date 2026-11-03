import "server-only";

import { isApiError } from "@/lib/api/errors";
import { getOwnerScopedAuthorizationHeaders } from "@/lib/auth/session";

import {
  fetchNotificationPage,
  fetchUnreadNotificationCount,
  getNotificationErrorMessage,
  type NotificationApiFeature,
  type NotificationDto,
} from "./remote";
import type { ApiNotificationItem, NotificationFailure, UnreadNotificationCountResult } from "./types";

/**
 * 알림 API 화면용 데이터 (서버 전용, 의뢰기관·검사기관 공통).
 *
 * 인증: 로그인 쿠키의 토큰을 Gateway로 넘기고(getOwnerScopedAuthorizationHeaders), 토큰·역할·본인 여부 검증은 Gateway와 백엔드에 맡긴다.
 * 쿠키가 없으면 요청하지 않는다. 토큰은 결과에 담지 않는다 (Client Component로 넘어가지 않게).
 * 실패해도 Mock으로 대체하지 않고 실패 결과를 돌려준다. JSX는 만들지 않는다.
 */

/** 화면 페이지 크기 (백엔드 기본값과 같다) */
export const NOTIFICATION_API_PAGE_SIZE = 10;

export const SIGNED_OUT_FAILURE: NotificationFailure = {
  ok: false,
  reason: "SIGNED_OUT",
  message: "로그인이 필요합니다.",
};

export type NotificationPageLoadResult =
  | {
      ok: true;
      notifications: ApiNotificationItem[];
      totalElements: number;
      totalPages: number;
      /** 0부터 */
      page: number;
    }
  | NotificationFailure;

export function toApiNotificationItem(dto: NotificationDto): ApiNotificationItem {
  return {
    id: dto.notificationId,
    referralId: dto.referralId,
    type: dto.type,
    title: dto.title,
    message: dto.message,
    isRead: dto.isRead,
    occurredAt: dto.createdAt,
    readAt: dto.readAt,
  };
}

/** 알림 목록 한 페이지. `unreadOnly`면 읽지 않은 알림만 (백엔드 isRead=false) */
export async function loadNotificationPage(
  feature: NotificationApiFeature,
  { page, unreadOnly = false }: { page: number; unreadOnly?: boolean },
): Promise<NotificationPageLoadResult> {
  const headers = await getOwnerScopedAuthorizationHeaders();
  if (!headers) return SIGNED_OUT_FAILURE;
  try {
    const data = await fetchNotificationPage(
      feature,
      { page, size: NOTIFICATION_API_PAGE_SIZE, isRead: unreadOnly ? false : undefined },
      { headers },
    );
    return {
      ok: true,
      notifications: data.contents.map(toApiNotificationItem),
      totalElements: data.totalElements,
      totalPages: data.totalPages,
      page: data.number,
    };
  } catch (error) {
    return toNotificationFailure(error, "list");
  }
}

/** 읽지 않은 알림 수 (헤더 알림 점·목록 요약) */
export async function loadUnreadNotificationCount(
  feature: NotificationApiFeature,
): Promise<UnreadNotificationCountResult> {
  const headers = await getOwnerScopedAuthorizationHeaders();
  if (!headers) return SIGNED_OUT_FAILURE;
  try {
    return { ok: true, unreadCount: await fetchUnreadNotificationCount(feature, { headers }) };
  } catch (error) {
    return toNotificationFailure(error, "count");
  }
}

/** ApiError → 화면 실패 결과. 401 외의 실패는 서버 로그에 남긴다 (토큰·응답 본문은 남기지 않는다) */
export function toNotificationFailure(error: unknown, action: "list" | "count" | "read"): NotificationFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[notifications] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : error);
  }
  return {
    ok: false,
    reason:
      status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404 && action === "read"
            ? "NOT_FOUND"
            : isNetwork
              ? "NETWORK"
              : "ERROR",
    message: getNotificationErrorMessage(error, action),
  };
}
