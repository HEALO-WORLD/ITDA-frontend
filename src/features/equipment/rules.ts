import type { ExamType } from "@/features/slots/types";
import { addDays, getWeekday, type DateKey } from "@/lib/date/seoulDate";

import type { DailyOperatingHours } from "./types";

/**
 * 장비 등록·수정, 운영 시간, 슬롯 생성 입력 규칙 (화면 검증과 Mock 저장 함수가 함께 쓴다).
 * TODO(api): 서버 검증 규칙(길이·범위·허용 단위)이 확정되면 상수를 맞추고, 서버에서도 같은 조건을 검증해야 한다.
 */

export const EQUIPMENT_NAME_MAX_LENGTH = 30;
/** 슬롯 소요 시간(분) 허용 범위 */
export const SLOT_MINUTES_MIN = 5;
export const SLOT_MINUTES_MAX = 240;
/** 슬롯 생성 1회 최대 기간(일, 시작·종료일 포함) */
export const MAX_SLOT_GENERATION_DAYS = 31;
/** 슬롯 생성 1회 최대 건수 */
export const MAX_SLOTS_PER_GENERATION = 500;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:mm` → 자정부터 분 */
export const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

/** 분 → `HH:mm` */
export const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/* ───────────── 장비 등록·수정 ───────────── */

export interface EquipmentInput {
  name: string;
  examType: ExamType | "";
  /** 입력창 값 그대로 (숫자 검증 전) */
  slotMinutes: string;
}

export type EquipmentInputErrors = Partial<Record<keyof EquipmentInput, string>>;

/** 장비명 비교용 (대소문자·공백 차이 무시) */
export const normalizeEquipmentName = (name: string) => name.toLowerCase().replace(/\s+/g, "");

export function validateEquipmentInput(
  { name, examType, slotMinutes }: EquipmentInput,
  /** 같은 기관의 다른 장비 이름 (수정 중인 장비는 빼고 넘긴다) */
  otherNames: readonly string[],
): EquipmentInputErrors {
  const errors: EquipmentInputErrors = {};
  const trimmed = name.trim();
  if (!trimmed) errors.name = "장비명을 입력해 주세요.";
  else if (trimmed.length > EQUIPMENT_NAME_MAX_LENGTH) {
    errors.name = `장비명은 ${EQUIPMENT_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
  } else if (otherNames.some((other) => normalizeEquipmentName(other) === normalizeEquipmentName(trimmed))) {
    errors.name = "같은 이름의 장비가 이미 있습니다.";
  }

  if (examType !== "CT" && examType !== "MRI") errors.examType = "검사 유형을 선택해 주세요.";

  const minutes = Number(slotMinutes);
  if (!slotMinutes.trim()) errors.slotMinutes = "슬롯 소요 시간을 입력해 주세요.";
  else if (!/^\d+$/.test(slotMinutes.trim()) || !Number.isInteger(minutes) || minutes <= 0) {
    errors.slotMinutes = "슬롯 소요 시간은 양의 정수(분)로 입력해 주세요.";
  } else if (minutes < SLOT_MINUTES_MIN || minutes > SLOT_MINUTES_MAX) {
    errors.slotMinutes = `슬롯 소요 시간은 ${SLOT_MINUTES_MIN}~${SLOT_MINUTES_MAX}분 사이로 입력해 주세요.`;
  }
  return errors;
}

export const hasErrors = (errors: object) => Object.values(errors).some(Boolean);

/* ───────────── 운영 시간 ───────────── */

/** 운영 시간 입력 한 줄 (요일별) */
export interface OperatingDayInput {
  weekday: number;
  isOpen: boolean;
  open: string;
  close: string;
  breakStart: string;
  breakEnd: string;
}

export type OperatingDayErrors = Partial<Record<"open" | "close" | "breakStart" | "breakEnd", string>>;

/** 요일 한 줄 검증. 휴무일은 시간을 검사하지 않는다 */
export function validateOperatingDay(day: OperatingDayInput): OperatingDayErrors {
  const errors: OperatingDayErrors = {};
  if (!day.isOpen) return errors;
  if (!TIME_PATTERN.test(day.open)) errors.open = "운영 시작 시각을 입력해 주세요.";
  if (!TIME_PATTERN.test(day.close)) errors.close = "운영 종료 시각을 입력해 주세요.";
  if (errors.open || errors.close) return errors;
  if (toMinutes(day.open) >= toMinutes(day.close)) errors.close = "종료 시각은 시작 시각보다 늦어야 합니다.";

  const hasBreakStart = day.breakStart !== "";
  const hasBreakEnd = day.breakEnd !== "";
  if (hasBreakStart !== hasBreakEnd) {
    errors[hasBreakStart ? "breakEnd" : "breakStart"] = "휴게 시작·종료 시각을 함께 입력해 주세요.";
    return errors;
  }
  if (!hasBreakStart) return errors;
  if (!TIME_PATTERN.test(day.breakStart) || !TIME_PATTERN.test(day.breakEnd)) {
    errors.breakStart = "휴게 시각 형식을 확인해 주세요.";
    return errors;
  }
  if (toMinutes(day.breakStart) >= toMinutes(day.breakEnd)) {
    errors.breakEnd = "휴게 종료 시각은 휴게 시작 시각보다 늦어야 합니다.";
  } else if (toMinutes(day.breakStart) <= toMinutes(day.open) || toMinutes(day.breakEnd) >= toMinutes(day.close)) {
    errors.breakStart = "휴게 시간은 운영 시간 안에 있어야 합니다.";
  }
  return errors;
}

/** 운영하는 요일이 하루 이상인지 (장비 등록 시 필수) */
export const hasOpenDay = (days: readonly OperatingDayInput[]) => days.some(({ isOpen }) => isOpen);

/** 입력 → 저장 형태 (운영하는 요일만, 휴게 시간은 입력했을 때만) */
export function toOperatingHours(days: readonly OperatingDayInput[]): DailyOperatingHours[] {
  return days
    .filter(({ isOpen }) => isOpen)
    .map(({ weekday, open, close, breakStart, breakEnd }) => ({
      weekday,
      open,
      close,
      ...(breakStart && breakEnd ? { breakTime: { start: breakStart, end: breakEnd } } : {}),
    }))
    .sort((a, b) => a.weekday - b.weekday);
}

/* ───────────── 슬롯 생성 ───────────── */

export interface SlotGenerationInput {
  equipmentId: string;
  startDate: DateKey | "";
  endDate: DateKey | "";
  /** true: 장비 운영 시간 전체 / false: 아래 시간대만 (운영 시간 안으로 제한) */
  useOperatingHours: boolean;
  customStart: string;
  customEnd: string;
}

export interface SlotGenerationContext {
  /** 대상 장비 (현재 기관 장비에서 찾은 값, 없으면 null) */
  equipment: { id: string; slotMinutes: number; operatingHours: DailyOperatingHours[] } | null;
  isEquipmentFailed: boolean;
  /** 같은 장비의 기존 슬롯 시작 일시 (`YYYY-MM-DDTHH:mm`, 원본 Mock + 이미 생성한 슬롯) */
  existingStartAts: readonly string[];
  /** 기존 슬롯 1개 길이(분). 같은 장비 슬롯은 모두 장비 소요 시간과 같다 */
  existingSlotMinutes: number;
  today: DateKey;
  nowDateTime: string;
  /** 슬롯 데이터 조회 가능 마지막 날 (달력·검색 범위) */
  rangeEnd: DateKey;
}

export interface SlotGenerationPreview {
  /** 생성 불가 사유 (있으면 생성하지 않는다) */
  errors: string[];
  /** 생성할 슬롯 시작 일시 */
  startAts: string[];
  /** 기존 슬롯과 시간이 겹쳐 제외한 수 */
  duplicateCount: number;
  /** 오늘 이미 지난 시각이라 제외한 수 */
  pastCount: number;
  /** 운영하는 날 수 */
  operatingDayCount: number;
}

const daysBetween = (from: DateKey, to: DateKey) => {
  let count = 0;
  for (let key = from; key <= to && count <= MAX_SLOT_GENERATION_DAYS + 1; key = addDays(key, 1)) count += 1;
  return count;
};

/**
 * 슬롯 생성 미리보기·검증.
 * 운영 요일의 운영 시간(휴게 시간 제외) 안에서 소요 시간 단위로 나누며, 종료 시각을 넘는 슬롯은 만들지 않는다.
 * 같은 장비의 기존 슬롯과 시간이 조금이라도 겹치면 제외한다 (원본 슬롯의 예약·마감 상태를 덮어쓰지 않기 위해).
 */
export function previewSlotGeneration(input: SlotGenerationInput, context: SlotGenerationContext): SlotGenerationPreview {
  const errors: string[] = [];
  const empty = { startAts: [], duplicateCount: 0, pastCount: 0, operatingDayCount: 0 };
  const { equipment } = context;

  if (!equipment) errors.push("대상 장비를 선택해 주세요.");
  if (!input.startDate || !input.endDate) errors.push("슬롯 생성 시작일과 종료일을 선택해 주세요.");
  else {
    if (input.startDate < context.today) errors.push("지난 날짜에는 슬롯을 새로 만들 수 없습니다.");
    if (input.startDate > input.endDate) errors.push("시작일이 종료일보다 늦습니다.");
    else if (daysBetween(input.startDate, input.endDate) > MAX_SLOT_GENERATION_DAYS) {
      errors.push(`한 번에 최대 ${MAX_SLOT_GENERATION_DAYS}일까지 생성할 수 있습니다.`);
    }
    if (input.endDate > context.rangeEnd) errors.push(`종료일은 ${context.rangeEnd}까지 선택할 수 있습니다.`);
  }
  if (context.isEquipmentFailed) {
    errors.push("장애가 진행 중인 장비에는 예약 가능 슬롯을 만들 수 없습니다. 장애를 복구한 뒤 생성해 주세요.");
  }
  if (equipment && equipment.operatingHours.length === 0) {
    errors.push("장비 운영 시간이 없습니다. 운영 시간을 먼저 설정해 주세요.");
  }
  if (!input.useOperatingHours) {
    if (!TIME_PATTERN.test(input.customStart) || !TIME_PATTERN.test(input.customEnd)) {
      errors.push("생성할 시간대의 시작·종료 시각을 입력해 주세요.");
    } else if (toMinutes(input.customStart) >= toMinutes(input.customEnd)) {
      errors.push("생성할 시간대의 종료 시각은 시작 시각보다 늦어야 합니다.");
    }
  }
  if (errors.length > 0 || !equipment) return { errors, ...empty };

  const duration = equipment.slotMinutes;
  const existing = context.existingStartAts.map((startAt) => ({
    date: startAt.slice(0, 10),
    start: toMinutes(startAt.slice(11, 16)),
  }));
  const hoursByWeekday = new Map(equipment.operatingHours.map((hours) => [hours.weekday, hours]));
  const startAts: string[] = [];
  let duplicateCount = 0;
  let pastCount = 0;
  let operatingDayCount = 0;

  for (let date = input.startDate as DateKey; date <= input.endDate; date = addDays(date, 1)) {
    const hours = hoursByWeekday.get(getWeekday(date));
    if (!hours) continue; // 휴무일
    let windowStart = toMinutes(hours.open);
    let windowEnd = toMinutes(hours.close);
    if (!input.useOperatingHours) {
      windowStart = Math.max(windowStart, toMinutes(input.customStart));
      windowEnd = Math.min(windowEnd, toMinutes(input.customEnd));
    }
    if (windowStart >= windowEnd) continue;
    operatingDayCount += 1;
    const breakStart = hours.breakTime ? toMinutes(hours.breakTime.start) : null;
    const breakEnd = hours.breakTime ? toMinutes(hours.breakTime.end) : null;
    const dayExisting = existing.filter((slot) => slot.date === date);

    for (let start = windowStart; start + duration <= windowEnd; start += duration) {
      const end = start + duration;
      if (breakStart !== null && breakEnd !== null && start < breakEnd && end > breakStart) continue; // 휴게 시간
      const startAt = `${date}T${toTime(start)}`;
      if (startAt <= context.nowDateTime) {
        pastCount += 1;
        continue;
      }
      const overlaps = dayExisting.some(
        (slot) => start < slot.start + context.existingSlotMinutes && slot.start < end,
      );
      if (overlaps) {
        duplicateCount += 1;
        continue;
      }
      startAts.push(startAt);
    }
  }

  if (startAts.length > MAX_SLOTS_PER_GENERATION) {
    errors.push(`한 번에 최대 ${MAX_SLOTS_PER_GENERATION}개까지 생성할 수 있습니다. 기간을 줄여 주세요.`);
  } else if (startAts.length === 0) {
    errors.push("조건에 맞는 새 슬롯이 없습니다. 기간·운영 시간·기존 슬롯을 확인해 주세요.");
  }
  return { errors, startAts, duplicateCount, pastCount, operatingDayCount };
}
