import type { ReferralDisplayStatus } from "@/features/referrals/types";
import type { ExamType } from "@/features/slots/types";
import type { DateKey } from "@/lib/date/seoulDate";

/**
 * 검사 진행·결과(S08) 프론트엔드 타입.
 *
 * ⚠️ 검사 진행·결과 API와 상태 enum이 확정되지 않았다.
 * 아래 타입은 Mock 데이터와 화면 렌더링을 위한 임시 타입이며, API 연동 시 응답 DTO에서 매핑한다.
 * 예약 상태(ReferralDisplayStatus)와 검사 진행 상태·결과 등록 상태는 서로 다른 값으로 관리한다.
 */

/**
 * 검사 진행 상태 (예약 상태와 별개).
 * NOT_PERFORMED = 예약이 취소되어 검사를 하지 않음
 */
export type ExamProgressStatus = "WAITING" | "IN_PROGRESS" | "COMPLETED" | "NOT_PERFORMED";

/** 검사 결과 상태 (판독 진행 단계 · 진단 내용이 아니다). 서버 enum 확인 필요 */
export type ExamResultStatus = "PRELIMINARY" | "FINAL" | "NEEDS_REVIEW";

/** 등록된 검사 결과 (상태 + 텍스트, 영상 파일은 다루지 않는다) */
export interface ExamResult {
  status: ExamResultStatus;
  text: string;
  /** 추가 소견 (선택. 없으면 표시하지 않는다) */
  notes?: string;
  /** 결과 등록 일시 (`YYYY-MM-DDTHH:mm`, 한국 시간) */
  registeredAt: string;
}

/** 검사 진행 기록 (저장 데이터 형태: 예약과는 의뢰 ID로만 연결한다) */
export interface ExaminationRecord {
  /** 연결된 의뢰·예약 ID (ReferralSummary.id) */
  referralId: string;
  /** 검사를 수행하는 검사기관 ID (예약을 받은 기관과 같아야 한다) */
  organizationId: string;
  progressStatus: ExamProgressStatus;
  /** 등록된 결과. 없으면 null */
  result: ExamResult | null;
}

/** 화면 표시용 검사 1건: 예약 정보 + 검사 진행 기록 */
export interface Examination {
  /** 의뢰 ID (목록 key) */
  id: string;
  referralNumber: string;
  virtualPatientId: string;
  referringOrganizationName: string;
  organizationName: string;
  equipmentName: string;
  examType: ExamType;
  /** 검사 예정 일시 (`YYYY-MM-DDTHH:mm`, 한국 시간) */
  scheduledAt: string;
  /** 예약 상태 (검사 진행 상태와 별개) */
  reservationStatus: ReferralDisplayStatus;
  purpose: string;
  requestedAt: string;
  progressStatus: ExamProgressStatus;
  result: ExamResult | null;
}

/**
 * 화면 표시용 결과 등록 상태 (진행 상태·예약 상태에서 계산).
 * - REGISTERED: 결과 등록 완료
 * - PENDING: 검사 완료 · 결과 미등록 (등록 대상)
 * - BEFORE_EXAM: 검사 전·진행 중이라 아직 등록할 수 없음
 * - NOT_APPLICABLE: 예약 취소 등으로 등록 대상 아님
 */
export type ResultRegistrationStatus = "REGISTERED" | "PENDING" | "BEFORE_EXAM" | "NOT_APPLICABLE";

/** 결과 등록 입력값 */
export interface ExamResultInput {
  status: ExamResultStatus | "";
  text: string;
}

/** 검색 조건. 빈 문자열은 '전체' */
export interface ExaminationSearchCriteria {
  /** 의뢰번호·가상 환자 ID 부분 일치 */
  keyword: string;
  examType: ExamType | "";
  progressStatus: ExamProgressStatus | "";
  /** 결과 등록 여부: 등록 완료 / 미등록(검사 완료 후 결과 없음) */
  resultRegistration: "REGISTERED" | "PENDING" | "";
  /** 검사 예정일 기준 기간 (양 끝 포함, 한국 시간) */
  dateFrom: DateKey | "";
  dateTo: DateKey | "";
}

/** 검사 현황 요약 */
export interface ExaminationSummaryCounts {
  waiting: number;
  inProgress: number;
  completed: number;
  /** 검사 완료 · 결과 미등록 */
  resultPending: number;
}

/**
 * API 모드 검사 상태 변경·결과 등록 Server Function 결과 (토큰·서버 오류 본문은 담지 않는다).
 * - SIGNED_OUT: 토큰 쿠키 없음 (요청하지 않음)
 * - UNAUTHORIZED: 401 (토큰 만료·위조) → 다시 로그인
 * - FORBIDDEN: 403 (역할·기관 불일치) 또는 같은 출처가 아닌 요청
 * - NOT_FOUND: 404 / CONFLICT: 409 (상태 전이·결과 등록 조건 불일치, 화면을 서버 값으로 다시 불러온다)
 * - INVALID: 400 또는 요청 전 입력 검증 실패 / NETWORK: 연결 실패·시간 초과 / ERROR: 그 밖의 실패
 */
export type ExaminationActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      /**
       * SESSION_CHANGED: 화면을 그린 뒤 다른 탭에서 로그인 계정이 바뀜(같은 계정 재로그인 포함)·렌더링 세션 값 누락 (요청하지 않음. FORBIDDEN과 구분)
       * UNCERTAIN: 상태 변경·결과 등록 요청의 결과를 알 수 없음(응답 없음·시간 초과·응답 형식 오류·5xx). 다시 조회해도 반영을 확인하지 못함
       */
      reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "SESSION_CHANGED" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNCERTAIN" | "NETWORK" | "ERROR";
      message: string;
    };
