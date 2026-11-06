import { MOCK_EXAMINATIONS } from "@/lib/dev/mockExaminations";

import type { ResultLoadResponse } from "./resultActions";

/**
 * ⚠️ Mock 모드 검사결과 조회 (개발용 예시 데이터, 백엔드 요청 없음).
 * 의뢰·예약 목록(Mock)의 [검사결과]가 쓴다. API 모드는 resultActions(GET /api/v1/referrals/{id}/results)를 쓴다.
 * - 기존 Mock 검사 기록(mockExaminations.ts)에서 그 의뢰의 결과를 찾는다
 * - Mock 결과 텍스트는 검사결과 요약, 추가 소견은 Mock에 있을 때만 보인다 (값을 만들지 않는다)
 * - 검사가 끝나지 않았으면(대기·진행 중·미실시) '아직 검사결과가 없다'고, 끝났지만 결과가 없으면 '결과 미등록'으로 안내한다
 * - 결과 화면이 같도록 API와 같은 응답 모양(ResultLoadResponse)을 돌려준다
 */
export function getMockReferralResult(referralId: string): ResultLoadResponse {
  const examination = MOCK_EXAMINATIONS.find((item) => item.referralId === referralId);
  if (!examination) return { ok: false, reason: "NOT_FOUND", message: "검사결과를 조회할 수 없습니다." };
  if (examination.progressStatus !== "COMPLETED" && !examination.result) {
    return { ok: false, reason: "NOT_REGISTERED", message: "아직 검사가 완료되지 않아 검사결과가 없습니다." };
  }
  if (!examination.result) return { ok: false, reason: "NOT_REGISTERED", message: "아직 등록된 검사결과가 없습니다." };
  return {
    ok: true,
    data: {
      id: `mock-result-${referralId}`,
      examinationId: `mock-examination-${referralId}`,
      referralId,
      summary: examination.result.text,
      notes: examination.result.notes ?? null,
      registeredAt: examination.result.registeredAt,
    },
  };
}
