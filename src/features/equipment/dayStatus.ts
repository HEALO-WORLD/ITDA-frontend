import { isBookableSlot, isUpcomingSlot } from "@/features/slots/availability";
import type { ExamSlot } from "@/features/slots/types";
import { addDays, getDaysInMonth, getWeekday, parseDateKey, toDateKey, type DateKey } from "@/lib/date/seoulDate";

import type { Equipment } from "./types";

/**
 * 달력 날짜 상태 (조회 대상 장비 기준).
 * - AVAILABLE: 지금 예약 가능한 슬롯(미래 시각 + isAvailable)이 1개 이상 → 선택 가능
 * - UNAVAILABLE: 슬롯은 있지만 예약 가능한 슬롯이 없음 (예약 불가 또는 이미 지난 시간) → 조회용으로 선택 가능
 * - CLOSED: 조회 대상 장비가 모두 운영하지 않는 요일 (장비 운영 시간 기준) → 선택 불가
 * - NO_SLOTS: 운영일이지만 슬롯 없음 → 선택 불가
 * - PAST_DAY / OUT_OF_RANGE: 지난 날짜 / 조회 범위 밖 → 선택 불가
 * - LOADING: 그 달 슬롯을 아직 불러오지 않음
 * - UNKNOWN: 슬롯을 조회할 수 없음 (API 모드: 슬롯 목록 조회 API가 없다) → 선택 불가. 휴무·슬롯 없음으로 단정하지 않는다
 * 슬롯이 실제로 있으면 운영 요일보다 슬롯 데이터를 우선한다 (데이터를 숨기지 않기 위해).
 */
export type DayStatus =
  | { kind: "PAST_DAY" }
  | { kind: "OUT_OF_RANGE" }
  | { kind: "LOADING" }
  | { kind: "UNKNOWN" }
  | { kind: "CLOSED" }
  | { kind: "NO_SLOTS" }
  | { kind: "AVAILABLE"; total: number; available: number }
  | { kind: "UNAVAILABLE"; total: number; allPast: boolean };

export const isSelectableDay = (status: DayStatus) =>
  status.kind === "AVAILABLE" || status.kind === "UNAVAILABLE";

export interface DayStatusContext {
  range: { start: DateKey; end: DateKey };
  /** 조회 대상 장비 */
  scopeEquipments: Pick<Equipment, "id" | "operatingHours">[];
  nowDateTime: string;
}

/** 조회 대상 장비 중 하나라도 운영하는 요일 */
const getOperatingWeekdays = (equipments: DayStatusContext["scopeEquipments"]) =>
  new Set(equipments.flatMap(({ operatingHours }) => operatingHours.map(({ weekday }) => weekday)));

function statusOf(
  key: DateKey,
  daySlots: ExamSlot[] | undefined,
  operatingWeekdays: Set<number>,
  { range, nowDateTime }: DayStatusContext,
): DayStatus {
  if (key < range.start) return { kind: "PAST_DAY" };
  if (key > range.end) return { kind: "OUT_OF_RANGE" };
  if (!daySlots) return { kind: "LOADING" };
  if (daySlots.length > 0) {
    const available = daySlots.filter((slot) => isBookableSlot(slot, nowDateTime)).length;
    return available > 0
      ? { kind: "AVAILABLE", total: daySlots.length, available }
      : {
          kind: "UNAVAILABLE",
          total: daySlots.length,
          allPast: daySlots.every((slot) => !isUpcomingSlot(slot, nowDateTime)),
        };
  }
  // 조회 대상 장비가 없으면 휴무가 아니라 슬롯 없음으로 본다
  if (operatingWeekdays.size === 0) return { kind: "NO_SLOTS" };
  return operatingWeekdays.has(getWeekday(key)) ? { kind: "NO_SLOTS" } : { kind: "CLOSED" };
}

/** 조회 대상 장비의 슬롯을 날짜별로 묶는다 */
function groupScopedSlots(monthSlots: readonly ExamSlot[], scopeEquipments: DayStatusContext["scopeEquipments"]) {
  const scopeIds = new Set(scopeEquipments.map(({ id }) => id));
  const byDate = new Map<DateKey, ExamSlot[]>();
  for (const slot of monthSlots) {
    if (!scopeIds.has(slot.equipmentId)) continue;
    const key = slot.startAt.slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), slot]);
  }
  return byDate;
}

/**
 * 한 달의 날짜별 상태.
 * @param monthSlots 그 달 슬롯 (아직 불러오지 않았으면 undefined → 범위 안 날짜는 LOADING)
 */
export function buildMonthDayStatuses(
  monthStart: DateKey,
  monthSlots: readonly ExamSlot[] | undefined,
  context: DayStatusContext,
): Map<DateKey, DayStatus> {
  const { year, month } = parseDateKey(monthStart);
  const operatingWeekdays = getOperatingWeekdays(context.scopeEquipments);
  const byDate = monthSlots ? groupScopedSlots(monthSlots, context.scopeEquipments) : null;
  const statuses = new Map<DateKey, DayStatus>();
  for (let day = 1; day <= getDaysInMonth(year, month); day++) {
    const key = toDateKey(year, month, day);
    statuses.set(key, statusOf(key, byDate ? (byDate.get(key) ?? []) : undefined, operatingWeekdays, context));
  }
  return statuses;
}

/** 해당 달에서 `from` 이후 첫 예약 가능(AVAILABLE) 날짜 */
export function findFirstAvailableDate(
  monthStart: DateKey,
  monthSlots: readonly ExamSlot[],
  from: DateKey,
  context: DayStatusContext,
): DateKey | null {
  const statuses = buildMonthDayStatuses(monthStart, monthSlots, context);
  for (let key = from < monthStart ? monthStart : from; statuses.has(key); key = addDays(key, 1)) {
    if (statuses.get(key)?.kind === "AVAILABLE") return key;
  }
  return null;
}
