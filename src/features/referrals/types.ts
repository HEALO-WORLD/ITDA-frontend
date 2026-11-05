import type { ExamType } from "@/features/slots/types";

/**
 * 의뢰·예약 관리(S03) 프론트엔드 타입.
 *
 * ⚠️ 의뢰 생성·조회 API와 예약 상태 enum이 확정되지 않았다. (screen-spec S03 확인 필요)
 * 아래 타입은 Mock 데이터와 화면 렌더링을 위한 임시 타입이며, API 계약 확정 후 응답 DTO에 맞춰 매핑한다.
 */

/**
 * 화면 표시용 예약 상태 (와이어프레임 기준: 확정 / 처리 중 / 재조정 필요, 알림의 예약 취소와 맞추기 위한 취소).
 * 백엔드 상태 enum(HOLD 등)이 아니며, 연동 시 서버 상태 → 이 값으로 매핑한다.
 */
export type ReferralDisplayStatus = "CONFIRMED" | "PROCESSING" | "RESCHEDULE_REQUIRED" | "CANCELLED";

/** 최근 의뢰·예약 내역 1건 */
export interface ReferralSummary {
  /** 목록 key 등에 쓰는 안정적인 식별자 */
  id: string;
  /** 화면 표시용 의뢰 번호 */
  referralNumber: string;
  /** 가상 환자 ID (테스트용 식별자만 사용) */
  virtualPatientId: string;
  /** 의뢰를 보낸 의뢰기관 */
  referringOrganizationId: string;
  referringOrganizationName: string;
  /** 검사를 받는 협력 검사기관 (예약이 접수된 기관) */
  organizationId: string;
  organizationName: string;
  equipmentName: string;
  examType: ExamType;
  /** 세부 검사 항목 (Mock 검사 유형 ID, 예: 뇌 MRI). 재조정 대체 슬롯을 같은 항목으로 고정하는 데 쓴다. 없으면 CT·MRI만 고정 */
  examTypeId?: string;
  /** 검사 일시 (`YYYY-MM-DDTHH:mm`, 한국 시간) */
  scheduledAt: string;
  status: ReferralDisplayStatus;
  /** 의뢰 목적 (선택 입력) */
  purpose: string;
  /** 의뢰 요청 일시 (`YYYY-MM-DDTHH:mm`, 한국 시간) */
  requestedAt: string;
}

/**
 * 의뢰 생성 모달에서 사용자가 직접 입력하는 값 (슬롯에서 정해지는 유형·기관·슬롯 ID 제외).
 * 장비 장애로 모달이 중단되면 화면 메모리에만 잠시 보관한다 (브라우저 저장소에 저장하지 않는다)
 */
export type ReferralDraft = Pick<ReferralFormInput, "virtualPatientId" | "purpose">;

/** 의뢰 요청 입력값 */
export interface ReferralFormInput {
  virtualPatientId: string;
  examType: ExamType | "";
  organizationId: string;
  slotId: string;
  purpose: string;
}
