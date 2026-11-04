import type { ExamType } from "@/features/slots/types";

/**
 * 장비·슬롯 운영(S05) 프론트엔드 타입.
 *
 * ⚠️ 장비 조회·상태 API가 확정되지 않았다. (screen-spec S05 확인 필요)
 * 아래 타입은 Mock 데이터와 화면 렌더링을 위한 임시 타입이며, API 연동 시 응답 DTO에서 매핑한다.
 */

/** 화면 표시용 장비 상태. 장애 정보가 확인된 장비만 FAILURE로 둔다 */
export type EquipmentStatus = "NORMAL" | "FAILURE";

/** 요일별 운영 시간 (`HH:mm`, 한국 시간) */
export interface DailyOperatingHours {
  /** 0=일 ~ 6=토 */
  weekday: number;
  open: string;
  close: string;
  /** 슬롯이 없는 휴게 시간 */
  breakTime?: { start: string; end: string };
}

export interface Equipment {
  id: string;
  organizationId: string;
  name: string;
  examType: ExamType;
  status: EquipmentStatus;
  /** 운영하는 요일만 포함한다 */
  operatingHours: DailyOperatingHours[];
  /** 슬롯 1개 길이(분) */
  slotMinutes: number;
  /** 지원 검사 유형 ID (임시 내부 모델, supportedExamTypes.ts). 없거나 비어 있으면 미설정 */
  supportedExamTypeIds?: readonly string[] | null;
}
