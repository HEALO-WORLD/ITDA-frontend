import { parseOffsetDateTime, toSeoulLocalDateTime } from "./offsetDateTime";
import type { RescheduleCandidateCheckResult } from "./rescheduleCandidate";

/**
 * 재예약 슬롯 시각 변환 (순수 함수: API 호출·POST 본문 생성 없음).
 *
 * 입력은 checkRescheduleCandidate를 통과한 candidate의 startsAt·endsAt(슬롯 응답 원본 OffsetDateTime)이다.
 * 같은 실제 시각을 Asia/Seoul 벽시계로 바꿔 재예약 요청의 LocalDateTime 문자열(`YYYY-MM-DDTHH:mm:ss[.f…]`)을 만든다.
 * - 해석·변환은 공용 파서(offsetDateTime.ts)를 쓴다: 4B-2C 후보 확인과 같은 해석, 0~99년도 그대로 다룬다
 * - 서울 벽시계는 Intl에 timeZone "Asia/Seoul"을 명시해 구한다 (서버 OS·브라우저 시간대를 쓰지 않는다)
 * - 소수 초는 원본 자릿수 그대로 붙인다 (오프셋은 분 단위라 소수 초는 바뀌지 않는다. 최대 9자리 = Java 나노초)
 * - 초를 생략한 입력은 `:00`을 붙인다 (정밀도 손실 없음)
 * - 백엔드 슬롯 생성 규칙(SlotService.validateTimeRange의 SLOT_DATE_MISMATCH)처럼 시작·종료의 서울 날짜가 같아야 한다
 *
 * examDate는 만들지 않는다 (시작 시각과 같은지, 그날 00:00인지 백엔드 계약이 정해지지 않았다).
 * 시작 < 종료·미래 여부 등 나머지 조건은 checkRescheduleCandidate가 확인한다.
 */

type RescheduleCandidate = Extract<RescheduleCandidateCheckResult, { ok: true }>["candidate"];

export type RescheduleTimeConversionResult =
  | {
      ok: true;
      /** 서울 기준 LocalDateTime (`YYYY-MM-DDTHH:mm:ss[.f…]`) */
      startTime: string;
      endTime: string;
    }
  | {
      ok: false;
      /**
       * INVALID_STARTS_AT·INVALID_ENDS_AT: OffsetDateTime 형식이 아니거나 없는 날짜·시각·오프셋
       * DATE_MISMATCH: 시작·종료의 서울 날짜가 다름 (백엔드 SLOT_DATE_MISMATCH와 같은 규칙)
       */
      reason: "INVALID_STARTS_AT" | "INVALID_ENDS_AT" | "DATE_MISMATCH";
      message: string;
    };

export function toRescheduleLocalTimes({ startsAt, endsAt }: Pick<RescheduleCandidate, "startsAt" | "endsAt">): RescheduleTimeConversionResult {
  const start = toSeoulLocal(startsAt);
  if (start === null) return { ok: false, reason: "INVALID_STARTS_AT", message: "슬롯 시작 시각 형식이 올바르지 않습니다." };
  const end = toSeoulLocal(endsAt);
  if (end === null) return { ok: false, reason: "INVALID_ENDS_AT", message: "슬롯 종료 시각 형식이 올바르지 않습니다." };
  if (start.slice(0, 10) !== end.slice(0, 10)) {
    return { ok: false, reason: "DATE_MISMATCH", message: "슬롯의 시작과 종료가 한국 시간 기준 같은 날짜가 아닙니다." };
  }
  return { ok: true, startTime: start, endTime: end };
}

/** OffsetDateTime 문자열 → 같은 실제 시각의 서울 LocalDateTime 문자열. 형식·값이 틀리거나 4자리 연도로 쓸 수 없으면 null */
function toSeoulLocal(value: unknown): string | null {
  const parsed = parseOffsetDateTime(value);
  return parsed === null ? null : toSeoulLocalDateTime(parsed);
}
