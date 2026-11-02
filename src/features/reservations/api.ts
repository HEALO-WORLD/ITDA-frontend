import { IS_MOCK_DATA as IS_REFERRAL_MOCK } from "@/features/referrals/api";
import { mockOnly } from "@/lib/api/config";
import { MOCK_REFERRAL_SUMMARIES } from "@/lib/dev/mockReferrals";

import type { Reservation } from "./types";

/**
 * 검사기관 예약 데이터 접근 함수.
 *
 * 의뢰기관 화면과 같은 의뢰·예약 Mock(MOCK_REFERRAL_SUMMARIES)에서 예약을 받은 검사기관 ID로만 거른다.
 * 기관명 문자열이 아니라 ID로 비교하므로 다른 검사기관 예약은 섞이지 않는다.
 * 의뢰기관 조회 함수(getRecentReferrals)를 거치지 않고 Mock을 직접 읽는다: 기능별 API 전환에서 의뢰(referrals)만
 * 실제 API로 바꿔도 검사기관 예약 Mock이 그 영향을 받지 않게 한다 (의뢰 목록 API는 의뢰기관 범위만 돌려준다).
 * TODO(api): 검사기관 예약 조회 API(서버에서 기관 권한으로 필터링)로 교체한다.
 */

export const IS_MOCK_DATA = IS_REFERRAL_MOCK;

export async function getReceivedReservations(examiningOrganizationId: string): Promise<Reservation[]> {
  mockOnly("reservations.getReceivedReservations");
  return MOCK_REFERRAL_SUMMARIES.filter(({ organizationId }) => organizationId === examiningOrganizationId);
}
