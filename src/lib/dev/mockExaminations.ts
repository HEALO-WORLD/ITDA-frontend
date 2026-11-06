import type { ExaminationRecord } from "@/features/examinations/types";

/**
 * ⚠️ 개발용 Mock 데이터 (실제 서버 데이터 아님)
 *
 * 검사 진행·결과 화면 확인용 예시 데이터다. 의뢰 Mock(mockReferrals.ts)의 id로 예약과 연결하며,
 * 예약 데이터(날짜·장비·기관·예약 상태)는 바꾸지 않는다. 기준일 2026-10-30 기준으로 아래와 같이 맞췄다.
 * - R-001 (10/27 지남, 확정, 강남) → 검사 완료 · 결과 등록 완료 (의뢰기관 검사결과 조회 시연용: 요약·추가 소견)
 * - R-004 (11/03 예정, 확정)      → 검사 대기
 * - R-009 (10/13 지남, 확정)      → 검사 완료 · 결과 미등록 (결과 등록 확인용)
 * - R-010 (10/16 지남, 확정)      → 검사 완료 · 결과 등록 완료 (상세 조회 확인용)
 * - R-011 (10/20, 예약 취소)      → 검사 미실시 · 결과 등록 대상 아님
 * - R-012 (10/22 지남, 확정)      → 검사 완료 · 결과 등록 완료
 * - R-013 (10/27 지남, 확정)      → 검사 완료 · 결과 미등록
 * 결과 텍스트는 실제 판독·진단이 아닌 중립적인 예시 문구이며, 환자 정보는 DEMO- 가상 ID만 쓴다.
 * API 연동 시 이 파일을 제거한다.
 */
const SAMPLE_RESULT_TEXT = "개발용 예시 결과 텍스트입니다. 실제 판독 내용이 아닙니다.";

export const MOCK_EXAMINATIONS: readonly ExaminationRecord[] = Object.freeze([
  {
    referralId: "mock-referral-001",
    organizationId: "org-gangnam",
    progressStatus: "COMPLETED",
    result: {
      status: "FINAL",
      text: "MRI 검사 결과 특이 소견 없음 (개발용 예시)",
      notes: "급성 이상 소견은 관찰되지 않으며, 필요 시 정기적인 추적 검사를 권고합니다. (개발용 예시 문구, 실제 판독 아님)",
      registeredAt: "2026-11-05T14:30",
    },
  },
  { referralId: "mock-referral-004", organizationId: "org-gaon", progressStatus: "WAITING", result: null },
  { referralId: "mock-referral-009", organizationId: "org-gaon", progressStatus: "COMPLETED", result: null },
  {
    referralId: "mock-referral-010",
    organizationId: "org-gaon",
    progressStatus: "COMPLETED",
    result: { status: "FINAL", text: SAMPLE_RESULT_TEXT, registeredAt: "2026-10-16T17:20" },
  },
  { referralId: "mock-referral-011", organizationId: "org-gaon", progressStatus: "NOT_PERFORMED", result: null },
  {
    referralId: "mock-referral-012",
    organizationId: "org-gaon",
    progressStatus: "COMPLETED",
    result: { status: "PRELIMINARY", text: SAMPLE_RESULT_TEXT, registeredAt: "2026-10-23T10:05" },
  },
  { referralId: "mock-referral-013", organizationId: "org-gaon", progressStatus: "COMPLETED", result: null },
] satisfies ExaminationRecord[]);
