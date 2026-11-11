import { getWeekday, parseDateKey, type DateKey } from "@/lib/date/seoulDate";

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * `YYYY-MM-DDTHH:mm` → `YYYY-MM-DD (요일) HH:mm`
 * 시간대 변환 없이 문자열 그대로 표시한다. 서버 TIMESTAMP 형식 확정 후 보완 필요.
 */
export function formatDateTimeWithWeekday(value: string): string {
  const [date, time = ""] = value.split("T");
  return `${date} (${WEEKDAYS[getWeekday(date)]}) ${time.slice(0, 5)}`;
}

/** `YYYY-MM-DDTHH:mm` → `YYYY-MM-DD HH:mm` (표 등 요일이 필요 없는 곳) */
export function formatDateTime(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

/** `YYYY-MM-DDTHH:mm` → `MM/DD HH:mm` (좁은 목록용, 연도 생략) */
export function formatShortDateTime(value: string): string {
  const [date, time = ""] = value.split("T");
  const { month, day } = parseDateKey(date);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")} ${time.slice(0, 5)}`;
}

/** `YYYY-MM-DD` → `2026년 10월 30일 금요일` (스크린리더용 날짜 이름) */
export function formatDateLong(key: DateKey): string {
  const { year, month, day } = parseDateKey(key);
  return `${year}년 ${month}월 ${day}일 ${WEEKDAYS[getWeekday(key)]}요일`;
}
