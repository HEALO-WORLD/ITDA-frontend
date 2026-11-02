import { mockOnly } from "@/lib/api/config";
import { MOCK_NOTIFICATIONS } from "@/lib/dev/mockNotifications";

import type { NotificationItem } from "./types";

/**
 * 알림 데이터 접근 함수.
 *
 * TODO(api): 합의된 조회 API로 교체한다. 함수 시그니처는 유지하고 내부만 Gateway 호출로 바꾼다.
 * - 전체 알림: `GET /api/v1/notifications`
 * - 의뢰별 알림: `GET /api/v1/notifications?referralId={referralId}`
 * 읽음 처리·읽지 않은 개수 API는 백엔드 확인 전이라 두지 않는다.
 */

/** Mock 데이터 사용 여부. 화면에 '개발용 예시 데이터' 표시를 띄우는 데 쓰며, API 연동 시 제거한다 */
export const IS_MOCK_DATA = true;

/** 최신순 */
export async function getNotifications(): Promise<readonly NotificationItem[]> {
  mockOnly("notifications.getNotifications");
  return MOCK_NOTIFICATIONS;
}
