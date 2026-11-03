import { mockOnly } from "@/lib/api/config";
import { MOCK_REFERRAL_SUMMARIES } from "@/lib/dev/mockReferrals";

import type { ReferralSummary } from "./types";

/**
 * 의뢰·예약 데이터 접근 함수.
 *
 * TODO(api): 현재는 Mock 데이터를 사용한다. 의뢰 조회·생성 API가 확정되면 함수 시그니처는 유지하고
 * 내부만 Gateway 호출(`/api/...`)로 교체한다. 의뢰 생성 함수는 API 연동 시 추가한다.
 *
 * API 연결 상태 (NEXT_PUBLIC_API_FEATURES=referrals 기준)
 * - API 연결: 의뢰 목록 조회 `fetchReferralPage` (remote.ts, GET /api/v1/referrals)
 * - Mock 유지: 아래 화면용 함수 3개. 목록 응답에 화면 표의 검사기관·검사 일시 등이 없어
 *   기관 API가 완성될 때까지 화면은 Mock을 쓴다 (응답에 없는 값을 만들어 채우지 않는다)
 */

/** Mock 데이터 사용 여부. 화면에 '개발용 예시 데이터' 표시를 띄우는 데 쓰며, API 연동 시 제거한다 */
export const IS_MOCK_DATA = true;

export async function getRecentReferrals(): Promise<readonly ReferralSummary[]> {
  mockOnly("referrals.getRecentReferrals");
  return MOCK_REFERRAL_SUMMARIES;
}

export async function getReferralById(referralId: string): Promise<ReferralSummary | null> {
  mockOnly("referrals.getReferralById");
  return MOCK_REFERRAL_SUMMARIES.find(({ id }) => id === referralId) ?? null;
}

/** 재조정이 필요한 의뢰·예약 (예약 상태 기준) */
export async function getRescheduleRequiredReferrals(): Promise<ReferralSummary[]> {
  mockOnly("referrals.getRescheduleRequiredReferrals");
  return MOCK_REFERRAL_SUMMARIES.filter(({ status }) => status === "RESCHEDULE_REQUIRED");
}

