"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { getOwnerScopedAuthorizationHeaders } from "@/lib/auth/session";

import { isNotificationId, markNotificationAsRead, NOTIFICATION_API_FEATURES, type NotificationApiFeature } from "./remote";
import { SIGNED_OUT_FAILURE, toNotificationFailure } from "./server";
import type { NotificationReadActionResult } from "./types";

/**
 * 알림 읽음 처리 Server Function (의뢰기관·검사기관 공통).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: 로그인 쿠키의 토큰을 서버에서 Gateway로 넘긴다. 쿠키가 없으면 요청하지 않는다
 *   (토큰 검증·역할·본인 알림 여부는 Gateway와 백엔드가 확인한다)
 * - 결과에는 토큰을 담지 않는다
 * 성공하면 화면을 다시 불러와(refresh) 목록과 읽지 않은 알림 수를 서버 값으로 맞춘다.
 * 백엔드가 멱등이라 같은 알림을 다시 요청해도 처음 읽은 시각이 그대로 온다.
 */
export async function markNotificationAsReadAction(
  feature: unknown,
  notificationId: unknown,
): Promise<NotificationReadActionResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  if (!NOTIFICATION_API_FEATURES.includes(feature as NotificationApiFeature) || !isNotificationId(notificationId)) {
    return { ok: false, reason: "ERROR", message: "알림 정보가 올바르지 않습니다. 화면을 새로고침해 주세요." };
  }

  const authorization = await getOwnerScopedAuthorizationHeaders();
  if (!authorization) return SIGNED_OUT_FAILURE;

  let result: NotificationReadActionResult;
  try {
    const data = await markNotificationAsRead(feature as NotificationApiFeature, notificationId, {
      headers: authorization,
    });
    result = { ok: true, notificationId: data.notificationId, readAt: data.readAt };
  } catch (error) {
    return toNotificationFailure(error, "read");
  }
  refresh();
  return result;
}
