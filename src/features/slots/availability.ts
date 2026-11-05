import type { DateKey } from "@/lib/date/seoulDate";

import type { ExamSlot, SlotSearchCriteria, TimeOfDay } from "./types";

/**
 * 날짜별 예약 가능 여부 계산 (프론트엔드 임시 로직).
 *
 * TODO(api): 서버가 날짜별 가용 정보를 내려주면 이 계산 대신 응답을 같은 형태로 매핑한다.
 */

/**
 * - AVAILABLE: 예약 가능한 미래 슬롯이 1개 이상
 * - FULL: 조건에 맞는 슬롯은 있으나 모두 마감되었거나 이미 지난 시간
 * (맵에 없는 날짜 = 조건에 맞는 슬롯 없음)
 */
export type DateAvailabilityStatus = "AVAILABLE" | "FULL";

export type DateAvailability = Record<DateKey, DateAvailabilityStatus>;

/**
 * 달력 계산에 쓰는 조건 (날짜 제외).
 * `예약 가능한 슬롯만 보기`는 넣지 않는다: 달력은 원래 예약 가능한 슬롯이 있는 날만 선택 가능으로 표시한다.
 */
export type AvailabilityFilter = Pick<SlotSearchCriteria, "examType" | "organizationId" | "timeOfDay" | "examTypeId">;

/** 시작 시각(`YYYY-MM-DDTHH:mm`)으로 시간대를 판단한다. 기관 운영시간과 무관하게 12:00 기준 */
export function getTimeOfDay(startAt: string): TimeOfDay {
  return startAt.slice(11, 16) < "12:00" ? "AM" : "PM";
}

/** 검사 유형·기관·세부 검사 항목·시간대 조건 일치 여부 (날짜 조건 제외) */
export function matchesSlotFilter(slot: ExamSlot, filter: AvailabilityFilter): boolean {
  return (
    (!filter.examType || slot.examType === filter.examType) &&
    (!filter.organizationId || slot.organizationId === filter.organizationId) &&
    (!filter.examTypeId || slot.examTypeId === filter.examTypeId) &&
    (!filter.timeOfDay || getTimeOfDay(slot.startAt) === filter.timeOfDay)
  );
}

/** 슬롯 시작 시각이 현재(한국 시간) 이후인지. 두 값 모두 `YYYY-MM-DDTHH:mm` */
export function isUpcomingSlot(slot: ExamSlot, nowDateTime: string): boolean {
  return slot.startAt > nowDateTime;
}

/**
 * 진행 중 장애가 있는 장비의 미래 슬롯을 예약 불가로 계산한다 (원본 슬롯은 바꾸지 않고 새 객체를 만든다).
 * - 장비 ID로만 판단한다 (다른 장비·기관 슬롯은 그대로)
 * - 원래 예약 가능한 슬롯만 막고 blockedReason을 붙인다. 원래 마감된 슬롯은 그대로 둔다
 * - 장애가 복구되면 이 계산에서 빠져 원래 예약 가능 상태로 돌아간다
 * TODO(api): 서버가 장애 장비 슬롯의 예약 가능 여부를 내려주면 이 계산을 제거한다.
 */
export function applyEquipmentFailures(
  slots: readonly ExamSlot[],
  failedEquipmentIds: ReadonlySet<string>,
  nowDateTime: string,
): ExamSlot[] {
  if (failedEquipmentIds.size === 0) return [...slots];
  return slots.map((slot) =>
    slot.isAvailable && failedEquipmentIds.has(slot.equipmentId) && isUpcomingSlot(slot, nowDateTime)
      ? { ...slot, isAvailable: false, blockedReason: "EQUIPMENT_FAILURE" }
      : slot,
  );
}

export function isBookableSlot(slot: ExamSlot, nowDateTime: string): boolean {
  return slot.isAvailable && isUpcomingSlot(slot, nowDateTime);
}

export function buildDateAvailability(
  slots: readonly ExamSlot[],
  filter: AvailabilityFilter,
  nowDateTime: string,
): DateAvailability {
  const result: DateAvailability = {};

  for (const slot of slots) {
    if (!matchesSlotFilter(slot, filter)) continue;

    const dateKey = slot.startAt.slice(0, 10);
    if (isBookableSlot(slot, nowDateTime)) result[dateKey] = "AVAILABLE";
    else if (!result[dateKey]) result[dateKey] = "FULL";
  }

  return result;
}
