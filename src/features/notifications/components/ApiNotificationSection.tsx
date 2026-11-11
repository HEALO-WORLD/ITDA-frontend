import ExaminingApiNotificationBoard from "@/features/examining-notifications/components/ExaminingApiNotificationBoard";
import { parsePageParam } from "@/features/examinations/server";
import { isApiFeature } from "@/lib/api/config";

import { loadNotificationPage, loadUnreadNotificationCount } from "../server";
import { NOTIFICATION_UNREAD_FILTER } from "../types";

import ApiNotificationList from "./ApiNotificationList";
import NotificationFailureNotice from "./NotificationFailureNotice";

interface ApiNotificationSectionProps {
  /** referring: 의뢰기관 알림 내역, examining: 검사기관 알림 목록 */
  variant: "referring" | "examining";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 알림 목록 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 *
 * - `?page=`(1부터)로 백엔드 페이지를 조회한다. 검사기관 화면은 `?filter=unread`면 읽지 않은 알림만 조회한다
 * - 접근 제어는 Gateway(토큰·역할)와 백엔드(본인 알림만)가 한다. 프론트는 역할을 추정하지 않고 결과(401·403 등)를 안내한다
 * - 실패해도 Mock 데이터로 대체하지 않는다
 */
export default async function ApiNotificationSection({ variant, searchParams }: ApiNotificationSectionProps) {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const filter = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const unreadOnly = variant === "examining" && filter === NOTIFICATION_UNREAD_FILTER;

  // 의뢰기관: 읽지 않은 알림 수를 목록과 같은 요청 시점에 함께 조회한다.
  // 레이아웃의 조회 결과는 화면 이동(클라이언트 이동) 때 다시 불러오지 않아, 그사이 새 알림이 오면 목록과 수가 어긋난다
  const [result, unreadCount] = await Promise.all([
    loadNotificationPage(variant === "referring" ? "notifications" : "examining-notifications", { page, unreadOnly }),
    variant === "referring" ? loadUnreadNotificationCount("notifications") : null,
  ]);
  if (!result.ok) return <NotificationFailureNotice failure={result} />;

  return variant === "referring" ? (
    <ApiNotificationList notifications={result.notifications} page={result.page} totalPages={result.totalPages} unreadCount={unreadCount ?? undefined} />
  ) : (
    <ExaminingApiNotificationBoard
      notifications={result.notifications}
      page={result.page}
      totalPages={result.totalPages}
      totalElements={result.totalElements}
      unreadOnly={unreadOnly}
      reservationDetailAvailable={isApiFeature("reservations")}
    />
  );
}
