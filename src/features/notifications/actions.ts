"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleMutationAccess } from "@/lib/auth/session";

import { isNotificationId, markNotificationAsRead, NOTIFICATION_API_FEATURES, type NotificationApiFeature } from "./remote";
import { NOTIFICATION_ROLE_BY_FEATURE, toNotificationAccessFailure, toNotificationFailure } from "./server";
import type { NotificationReadActionResult } from "./types";

/**
 * 알림 읽음 처리 Server Function (의뢰기관·검사기관 공통).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: 기능 이름으로 서버가 정한 화면 역할을 users/me로 확인한 뒤에만 토큰을 Gateway로 넘긴다 (requireRoleAccess).
 *   확인에 실패하면 요청하지 않는다 (본인 알림 여부·API 권한은 Gateway와 백엔드가 다시 확인한다)
 * - 로그인 세션: 화면이 렌더링된 로그인 세션(expectedLoginSession)이 지금 쿠키와 같을 때만 요청한다 (requireRoleMutationAccess).
 *   다르면(다른 탭의 계정 전환·재로그인) 요청 없이 SESSION_CHANGED, 화면도 다시 불러오지 않는다 (읽음 표시·읽지 않은 알림 수 그대로)
 * - 결과에는 토큰을 담지 않는다
 * 성공하면 화면을 다시 불러와(refresh) 목록과 읽지 않은 알림 수를 서버 값으로 맞춘다.
 * 백엔드가 멱등이라 같은 알림을 다시 요청해도 처음 읽은 시각이 그대로 온다.
 */
export async function markNotificationAsReadAction(
  feature: unknown,
  notificationId: unknown,
  expectedLoginSession?: unknown,
): Promise<NotificationReadActionResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  if (!NOTIFICATION_API_FEATURES.includes(feature as NotificationApiFeature) || !isNotificationId(notificationId)) {
    return { ok: false, reason: "ERROR", message: "알림 정보가 올바르지 않습니다. 화면을 새로고침해 주세요." };
  }

  // 브라우저가 보낸 기능 이름은 필요한 역할을 고르는 데만 쓴다. 허용 여부는 users/me로 확인한 역할로 정한다
  const access = await requireRoleMutationAccess(NOTIFICATION_ROLE_BY_FEATURE[feature as NotificationApiFeature], expectedLoginSession);
  if (!access.ok) {
    if (access.reason === "SESSION_CHANGED") return { ok: false, reason: "SESSION_CHANGED", message: access.message };
    return toNotificationAccessFailure(access);
  }
  const authorization = access.headers;

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
