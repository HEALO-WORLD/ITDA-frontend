import { addDays, getWeekday, type DateKey } from "@/lib/date/seoulDate";

/**
 * 슬롯 일괄 생성 기간 계산 (화면 미리보기·서버 재검증 공통, 순수 함수).
 * 백엔드 `POST /api/v1/slots/generate`는 하루만 만든다: 기간의 운영일마다 따로 요청한다 (generateServer.submitSlotRangeGeneration).
 * 날짜는 서울 기준 `YYYY-MM-DD`. 요일은 화면 기준 0=일 ~ 6=토.
 */

/** 시작일·종료일 포함 최대 일수 */
export const MAX_GENERATION_DAYS = 14;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type GenerationRangeField = "startDate" | "endDate";

/** 기간 확인 (오늘 이후 · 시작 ≤ 종료 · 최대 14일 · 1년 이내). 문제없으면 null */
export function validateGenerationRange(
  startDate: unknown,
  endDate: unknown,
  today: DateKey,
  maxLookaheadDays: number,
): { field: GenerationRangeField; message: string } | null {
  if (!isDateKey(startDate)) return { field: "startDate", message: "생성 시작일을 선택해 주세요." };
  if (!isDateKey(endDate)) return { field: "endDate", message: "생성 종료일을 선택해 주세요." };
  if (startDate < today) return { field: "startDate", message: "지난 날짜에는 슬롯을 만들 수 없습니다. 오늘 이후 날짜를 선택해 주세요." };
  if (endDate < startDate) return { field: "endDate", message: "생성 종료일은 시작일과 같거나 이후여야 합니다." };
  if (endDate > addDays(startDate, MAX_GENERATION_DAYS - 1)) {
    return { field: "endDate", message: `생성 기간은 시작일과 종료일을 포함해 최대 ${MAX_GENERATION_DAYS}일입니다.` };
  }
  if (endDate > addDays(today, maxLookaheadDays)) return { field: "endDate", message: "1년 이내의 날짜만 선택할 수 있습니다." };
  return null;
}

/** 기간의 날짜 목록 (시작·종료 포함). 호출 전에 validateGenerationRange로 확인한다 */
export function listRangeDates(startDate: DateKey, endDate: DateKey): DateKey[] {
  const dates: DateKey[] = [];
  for (let date = startDate; date <= endDate && dates.length <= MAX_GENERATION_DAYS; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** 운영 요일(0~6)로 생성 대상·휴무 제외 날짜를 나눈다 */
export function splitOperatingDates(dates: readonly DateKey[], operatingWeekdays: ReadonlySet<number>): { targets: DateKey[]; skipped: DateKey[] } {
  const targets: DateKey[] = [];
  const skipped: DateKey[] = [];
  for (const date of dates) (operatingWeekdays.has(getWeekday(date)) ? targets : skipped).push(date);
  return { targets, skipped };
}

/**
 * 날짜별 결과.
 * - SUCCESS: 생성 성공 · SKIPPED: 운영하지 않는 날 (요청 안 함)
 * - CONFLICT: 기존 슬롯과 겹침 (생성 전 조회에서 이미 슬롯이 있거나 서버 409. 기존 슬롯은 지우거나 덮어쓰지 않는다)
 * - FAILED: 생성 실패 (서버가 거부함)
 * - UNKNOWN: 타임아웃·연결 끊김·응답 형식 오류로 생성 여부를 알 수 없음 (같은 POST를 자동으로 다시 보내지 않는다. 서버 조회로 확인)
 * - NOT_PROCESSED: 앞 날짜에서 인증·연결 장애가 나서 요청하지 않음
 */
export type GenerationDayStatus = "SUCCESS" | "SKIPPED" | "CONFLICT" | "FAILED" | "UNKNOWN" | "NOT_PROCESSED";

export interface GenerationSummary {
  /** 선택 기간 전체 날짜 수 */
  totalDays: number;
  success: number;
  /** 성공 날짜에서 만든 슬롯 수 */
  createdSlots: number;
  conflict: number;
  failed: number;
  unknown: number;
  notProcessed: number;
  skipped: number;
}

export function summarizeGeneration(days: readonly { status: GenerationDayStatus; slotCount: number }[]): GenerationSummary {
  const summary: GenerationSummary = { totalDays: days.length, success: 0, createdSlots: 0, conflict: 0, failed: 0, unknown: 0, notProcessed: 0, skipped: 0 };
  for (const day of days) {
    if (day.status === "SUCCESS") {
      summary.success++;
      summary.createdSlots += day.slotCount;
    } else if (day.status === "CONFLICT") summary.conflict++;
    else if (day.status === "FAILED") summary.failed++;
    else if (day.status === "UNKNOWN") summary.unknown++;
    else if (day.status === "NOT_PROCESSED") summary.notProcessed++;
    else summary.skipped++;
  }
  return summary;
}
