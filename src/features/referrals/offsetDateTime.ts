/**
 * Java OffsetDateTime 문자열 공용 파서 (순수 함수, 재예약 후보 확인·시각 변환에서 함께 쓴다).
 *
 * 형식: `YYYY-MM-DDTHH:mm[:ss[.f{1,9}]](Z|±HH:mm)` (슬롯 DTO 검증 slots/remote.ts와 같은 범위)
 * - 실제 시각은 epochSecond(정수 초) + nano(0~999,999,999)로 나눠 나노초까지 정확히 비교한다 (Java Instant와 같은 표현)
 * - 날짜 → 일수 계산을 정수 연산으로 직접 해 Date.UTC의 0~99년 → 1900년대 변환과 로컬 시간대 영향을 받지 않는다
 * - 소수 초는 원본 문자열도 함께 보관한다 (LocalDateTime으로 바꿀 때 자릿수를 그대로 붙인다)
 */

export interface ParsedOffsetDateTime {
  /** 1970-01-01T00:00:00Z부터의 초 (음수 가능) */
  epochSecond: number;
  /** 초 아래 나노초 (0 ~ 999,999,999) */
  nano: number;
  /** 원본 소수 초 문자열 (`.123` 등, 없으면 빈 문자열) */
  fraction: string;
}

/** 비교에 필요한 실제 시각 */
export type Instant = Pick<ParsedOffsetDateTime, "epochSecond" | "nano">;

const OFFSET_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const SECONDS_PER_DAY = 86_400;

/** OffsetDateTime 문자열 → 실제 시각. 형식이 다르거나 없는 날짜·시각·오프셋이면 null */
export function parseOffsetDateTime(value: unknown): ParsedOffsetDateTime | null {
  if (typeof value !== "string") return null;
  const m = OFFSET_DATE_TIME.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const fraction = m[7] ?? "";
  const offsetHours = m[9] ? Number(m[9]) : 0;
  const offsetMinutes = m[10] ? Number(m[10]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null;
  if (offsetHours > 18 || offsetMinutes > 59 || (offsetHours === 18 && offsetMinutes > 0)) return null;

  const offsetSeconds = (m[8] === "-" ? -1 : 1) * (offsetHours * 3600 + offsetMinutes * 60);
  return {
    epochSecond: daysFromCivil(year, month, day) * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second - offsetSeconds,
    nano: fraction ? Number(fraction.slice(1).padEnd(9, "0")) : 0,
    fraction,
  };
}

/** 밀리초 기준 시각(Date.getTime·epoch ms) → 실제 시각. 정수 밀리초는 정확히 바뀐다 (소수 밀리초는 나노초로 반올림) */
export function instantFromEpochMilli(epochMilli: number): Instant {
  let epochSecond = Math.floor(epochMilli / 1000);
  let nano = Math.round((epochMilli - epochSecond * 1000) * 1_000_000);
  if (nano >= 1_000_000_000) {
    epochSecond += 1;
    nano -= 1_000_000_000;
  }
  return { epochSecond, nano };
}

/** a < b면 음수, 같으면 0, a > b면 양수 */
export function compareInstants(a: Instant, b: Instant): number {
  return a.epochSecond !== b.epochSecond ? a.epochSecond - b.epochSecond : a.nano - b.nano;
}

const seoulFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hourCycle: "h23",
  era: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * 같은 실제 시각의 Asia/Seoul 벽시계 LocalDateTime 문자열 (`YYYY-MM-DDTHH:mm:ss[.f…]`).
 * 서울 오프셋은 Intl(timeZone "Asia/Seoul", 서머타임·LMT 포함)로 구하고 서버 OS·브라우저 시간대는 쓰지 않는다.
 * 소수 초는 원본 자릿수 그대로 붙인다 (오프셋은 초 단위라 소수 초는 바뀌지 않는다).
 * 서울 연도가 0000~9999 밖이면 Java LocalDateTime 기본 형식(4자리 연도)으로 쓸 수 없어 null.
 */
export function toSeoulLocalDateTime(parsed: ParsedOffsetDateTime): string | null {
  const parts = Object.fromEntries(seoulFormatter.formatToParts(new Date(parsed.epochSecond * 1000)).map(({ type, value }) => [type, value]));
  // Intl은 0년 이하를 기원전(BC 1 = 0년)으로 표시한다
  const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
  if (!(year >= 0 && year <= 9999)) return null;
  return `${String(year).padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parsed.fraction}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  return month === 2 ? (isLeapYear(year) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** 그레고리력(역산 적용) 날짜 → 1970-01-01부터의 일수 (H. Hinnant의 days_from_civil, 정수 연산) */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}
