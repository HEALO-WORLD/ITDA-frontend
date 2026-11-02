import { mockOnly } from "@/lib/api/config";
import { MOCK_EXAMINING_NOTIFICATIONS } from "@/lib/dev/mockExaminingNotifications";

import type { ExaminingNotification } from "./types";

/**
 * 검사기관 알림 데이터 접근 함수.
 *
 * TODO(api): 합의된 조회 API `GET /api/v1/notifications`로 교체한다. 함수 시그니처는 유지한다.
 * - 인증된 기관의 알림만 반환하도록 서버가 권한을 검증해야 한다 (지금의 기관 ID 필터는 Mock용)
 * - 알림 유형 enum·응답 필드·읽음 처리 API는 미확정이라 호출하지 않는다
 */

/** Mock 데이터 사용 여부. 화면에 '개발용 예시 데이터' 표시를 띄우는 데 쓰며, API 연동 시 제거한다 */
export const IS_MOCK_DATA = true;

/** 현재 검사기관이 받은 알림 (기관 ID 기준, 최신순) */
export async function getExaminingNotifications(organizationId: string): Promise<ExaminingNotification[]> {
  mockOnly("examining-notifications.getExaminingNotifications");
  return MOCK_EXAMINING_NOTIFICATIONS.filter(
    ({ recipientOrganizationId }) => recipientOrganizationId === organizationId,
  ).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
