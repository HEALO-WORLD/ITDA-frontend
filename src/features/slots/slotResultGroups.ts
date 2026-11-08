import { addDays, type DateKey } from "@/lib/date/seoulDate";

import type { ExamSlot } from "./types";

/**
 * 슬롯 검색 결과(PC 달력·카드 화면)의 날짜·카드 묶기.
 * 이미 받은 검색 결과만 나눈다: 요청을 보내지 않고, 응답에 없는 슬롯·상태를 만들지 않는다.
 */

/** 결과 달력이 보여 줄 검색 기간 (`endDateExclusive` 전날까지) */
export interface ResultDateRange {
  startDate: DateKey;
  endDateExclusive: DateKey;
}

export const slotDateKey = (slot: Pick<ExamSlot, "startAt">): DateKey => slot.startAt.slice(0, 10);

/** 날짜별 예약 가능 슬롯 수 (isAvailable만 센다). 키가 없는 날짜 = 예약 가능한 슬롯 없음 */
export function countAvailableSlotsByDate(slots: readonly ExamSlot[]): Record<DateKey, number> {
  const counts: Record<DateKey, number> = {};
  for (const slot of slots) {
    if (!slot.isAvailable) continue;
    const date = slotDateKey(slot);
    counts[date] = (counts[date] ?? 0) + 1;
  }
  return counts;
}

/**
 * 결과 달력의 검색 기간.
 * - API: 실제로 검색한 기간(window)
 * - 날짜 지정 검색: 그 날짜 하루
 * - Mock 전체 기간 검색: 받은 결과의 첫 날짜 ~ 마지막 날짜 (결과가 없으면 null)
 */
export function getResultDateRange(
  slots: readonly ExamSlot[],
  options: { window?: ResultDateRange; criteriaDate?: DateKey | "" },
): ResultDateRange | null {
  if (options.window) return options.window;
  if (options.criteriaDate) return { startDate: options.criteriaDate, endDateExclusive: addDays(options.criteriaDate, 1) };
  if (slots.length === 0) return null;
  let first = slotDateKey(slots[0]);
  let last = first;
  for (const slot of slots) {
    const date = slotDateKey(slot);
    if (date < first) first = date;
    if (date > last) last = date;
  }
  return { startDate: first, endDateExclusive: addDays(last, 1) };
}

export const isInResultRange = (date: DateKey, range: ResultDateRange) =>
  date >= range.startDate && date < range.endDateExclusive;

/**
 * 새 검색 직후 선택할 날짜: 날짜 지정 검색이면 그 날짜, 아니면 예약 가능한 슬롯이 있는 첫 날짜.
 * 예약 가능한 날짜가 없으면 결과의 첫 날짜, 결과도 없으면 기간 시작일
 */
export function pickInitialResultDate(
  slots: readonly ExamSlot[],
  range: ResultDateRange | null,
  criteriaDate: DateKey | "" = "",
): DateKey | "" {
  if (criteriaDate) return criteriaDate;
  const available = Object.keys(countAvailableSlotsByDate(slots)).sort();
  if (available.length > 0) return available[0];
  if (slots.length > 0) return slots.map(slotDateKey).sort()[0];
  return range?.startDate ?? "";
}

/**
 * 결과가 바뀐 뒤 선택할 날짜.
 * - 새 검색: pickInitialResultDate (첫 예약 가능 날짜 / 날짜 지정 검색이면 그 날짜)
 * - 같은 조건 재검색(예약 접수 뒤)·Mock 데이터 갱신: 사용자가 고른 날짜를 그대로 둔다 (그날 슬롯이 없어졌으면 화면이 빈 결과 안내)
 */
export function resolveResultDate(input: {
  previous: DateKey | "";
  isNewSearch: boolean;
  slots: readonly ExamSlot[];
  range: ResultDateRange | null;
  criteriaDate?: DateKey | "";
}): DateKey | "" {
  if (!input.isNewSearch && input.previous) return input.previous;
  return pickInitialResultDate(input.slots, input.range, input.criteriaDate ?? "");
}

/** 카드 1장: 같은 날짜·검사기관·장비·세부 검사 항목의 슬롯 (시간순) */
export interface SlotCardGroup {
  key: string;
  date: DateKey;
  organizationId: string;
  organizationName: string;
  equipmentId: string;
  equipmentName: string;
  examType: ExamSlot["examType"];
  examTypeId?: string;
  examTypeName?: string;
  /** 원본 슬롯 그대로 (시간 버튼은 slot.id를 그대로 넘긴다) */
  slots: ExamSlot[];
  availableCount: number;
}

const normalizeId = (value: string) => value.trim().toLowerCase();

/**
 * 세부 검사 항목 묶기 기준. ID가 있으면 ID(대소문자 무시), 없으면(일부 Mock) CT·MRI와 항목 이름으로 구분한다.
 * ID가 있는 항목과 없는 항목, 이름이 다른 항목은 서로 합치지 않는다
 */
function examItemKey(slot: ExamSlot): string {
  if (slot.examTypeId) return `id:${normalizeId(slot.examTypeId)}`;
  return `none:${slot.examType}:${slot.examTypeName ?? ""}`;
}

export function slotCardKey(slot: ExamSlot): string {
  return [slotDateKey(slot), normalizeId(slot.organizationId), normalizeId(slot.equipmentId), examItemKey(slot)].join("|");
}

/**
 * 선택한 날짜의 슬롯을 카드로 묶는다 (날짜·검사기관 ID·장비 ID·세부 검사 항목 ID 기준).
 * 카드 순서: 가장 이른 시간 → 검사기관 이름 → 장비 이름. 카드 안의 슬롯은 시간순
 */
export function groupSlotCards(slots: readonly ExamSlot[], date: DateKey): SlotCardGroup[] {
  const groups = new Map<string, SlotCardGroup>();
  for (const slot of slots) {
    if (slotDateKey(slot) !== date) continue;
    const key = slotCardKey(slot);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        date,
        organizationId: slot.organizationId,
        organizationName: slot.organizationName,
        equipmentId: slot.equipmentId,
        equipmentName: slot.equipmentName,
        examType: slot.examType,
        examTypeId: slot.examTypeId,
        examTypeName: slot.examTypeName,
        slots: [],
        availableCount: 0,
      };
      groups.set(key, group);
    }
    group.slots.push(slot);
    if (slot.isAvailable) group.availableCount += 1;
  }
  const cards = [...groups.values()];
  for (const card of cards) card.slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  return cards.sort(
    (a, b) =>
      a.slots[0].startAt.localeCompare(b.slots[0].startAt) ||
      a.organizationName.localeCompare(b.organizationName, "ko") ||
      a.equipmentName.localeCompare(b.equipmentName, "ko") ||
      a.key.localeCompare(b.key),
  );
}
