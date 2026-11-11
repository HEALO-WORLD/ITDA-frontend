/**
 * 검사 슬롯 검색(S02) 프론트엔드 타입.
 *
 * ⚠️ 백엔드 슬롯 조회 API·DTO·상태 enum이 확정되지 않았다. (screen-spec S02 확인 필요)
 * 아래 타입은 Mock 데이터와 화면 렌더링을 위한 프론트엔드 임시 타입이며,
 * API 계약 확정 후 응답 DTO에 맞춰 교체하거나 매핑 함수를 둔다.
 */

/** 검사 유형. 서버 enum 확인 필요 */
export type ExamType = "CT" | "MRI";

/** 협력 검사기관 (검색 조건 선택지) */
export interface PartnerOrganization {
  id: string;
  name: string;
}

/** 검사 슬롯 1건 */
export interface ExamSlot {
  /** 슬롯 식별자. 예약 요청 시 표시 문자열이 아닌 이 값으로 선택 정보를 관리한다 */
  id: string;
  organizationId: string;
  organizationName: string;
  equipmentId: string;
  equipmentName: string;
  examType: ExamType;
  /** 검사 일시 (로컬 시각, `YYYY-MM-DDTHH:mm`). 서버 시간대·직렬화 형식 확인 필요 */
  startAt: string;
  /** 예약 가능 여부. 서버는 상태 enum(HOLD 등)으로 내려줄 수 있어 확인 필요 */
  isAvailable: boolean;
  /**
   * 원래 예약 가능했지만 막힌 이유 (원래 마감된 슬롯에는 붙이지 않는다).
   * - EQUIPMENT_FAILURE: 장비 장애(진행 중)로 막힌 미래 슬롯 (applyEquipmentFailures 참고)
   * - OPERATOR_SUSPENDED: 검사기관이 운영 중단한 슬롯 (개발용 Mock에서 생성한 슬롯만 해당)
   */
  blockedReason?: "EQUIPMENT_FAILURE" | "OPERATOR_SUSPENDED";
  /**
   * 세부 검사 항목 (ExamType, 예: 뇌 MRI). API 슬롯은 서버 원본 examTypeId와 검사 유형 목록의 이름이고,
   * Mock 슬롯은 장비의 지원 검사 유형 중 하나를 개발용으로 정해 둔다 (slots/api.ts). 없으면 표시는 '—'이고 항목 필터에 걸리지 않는다
   */
  examTypeId?: string;
  examTypeName?: string;
}

/** 시간대. 슬롯 검사 시작 시각 기준 (오전: 12:00 이전, 오후: 12:00부터) */
export type TimeOfDay = "AM" | "PM";

/** 검색 조건. 빈 문자열은 '전체'를 뜻한다 */
export interface SlotSearchCriteria {
  examType: ExamType | "";
  /** `YYYY-MM-DD`. 비어 있으면 날짜 조건을 적용하지 않는다 */
  date: string;
  organizationId: string;
  timeOfDay: TimeOfDay | "";
  /** true면 지금 예약할 수 있는 슬롯(예약 가능 + 시작 전)만 반환한다 */
  availableOnly: boolean;
  /** 세부 검사 항목 ID (ExamType). 비어 있으면(또는 없으면) 전체 검사 항목. 이름이 아니라 ID로 고른다 */
  examTypeId?: string;
}
