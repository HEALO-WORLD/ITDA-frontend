import { parseOffsetDateTime } from "./offsetDateTime";
import type { ReferralStatusDto, ReservationStatusDto } from "./remote";

/**
 * 의뢰기관 예약 취소 규칙 (순수 함수: 화면 표시 조건과 Server Action의 대상 확인에서 함께 쓴다).
 *
 * 백엔드 정책: 의뢰·예약이 모두 CONFIRMED, 검사 시작 2시간 전까지, 연관 검사가 SCHEDULED.
 * 검사 상태는 의뢰기관 응답에 없어 프론트에서 추정하지 않는다 (백엔드가 409 EXAMINATION_CANCEL_NOT_ALLOWED로 거부한다).
 * 2시간 마감은 화면 안내용이고 최종 판단은 백엔드가 한다.
 */

/** 검사 시작 몇 ms 전까지 취소할 수 있는지 (백엔드 정책: 2시간) */
export const RESERVATION_CANCEL_DEADLINE_BEFORE_MS = 2 * 60 * 60 * 1000;

/**
 * 백엔드 LocalDateTime(한국 시간, 시간대 표기 없음) → 실제 시각(ms).
 * 브라우저·서버 시간대로 해석하지 않도록 +09:00을 붙여 기존 OffsetDateTime 파서로 읽는다. 형식이 다르면 null
 */
export function parseSeoulLocalDateTimeMs(value: string | null): number | null {
  if (typeof value !== "string" || /(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = parseOffsetDateTime(`${value}+09:00`);
  return parsed ? parsed.epochSecond * 1000 + Math.floor(parsed.nano / 1_000_000) : null;
}

/** 취소 마감 시각(ms) = 검사 시작 - 2시간. 시작 시각을 해석할 수 없으면 null */
export function getReservationCancelDeadlineMs(startTime: string | null): number | null {
  const start = parseSeoulLocalDateTimeMs(startTime);
  return start === null ? null : start - RESERVATION_CANCEL_DEADLINE_BEFORE_MS;
}

/**
 * 취소 확인 대상 예약의 표식. 예약 ID를 브라우저로 보내지 않는 대신, 화면에 이미 보이는 값으로
 * "사용자가 확인한 예약"을 가리킨다. 재조정으로 새 예약이 생기면 시도 번호가 바뀌어 일치하지 않는다.
 */
export interface ReservationCancelTarget {
  attemptNo: number;
  startTime: string;
  endTime: string;
}

export function isReservationCancelTarget(value: unknown): value is ReservationCancelTarget {
  if (typeof value !== "object" || value === null) return false;
  const { attemptNo, startTime, endTime } = value as Record<string, unknown>;
  return (
    typeof attemptNo === "number" &&
    Number.isInteger(attemptNo) &&
    attemptNo > 0 &&
    typeof startTime === "string" &&
    typeof endTime === "string" &&
    parseSeoulLocalDateTimeMs(startTime) !== null &&
    parseSeoulLocalDateTimeMs(endTime) !== null
  );
}

/** 서버가 다시 조회한 예약이 사용자가 확인한 예약과 같은지 (시도 번호·시작·종료 시각. 시각은 초·소수 초 생략 차이를 무시한다) */
export function isSameCancelTarget(
  reservation: { attemptNo: number; startTime: string | null; endTime: string | null },
  target: ReservationCancelTarget,
): boolean {
  const start = parseSeoulLocalDateTimeMs(reservation.startTime);
  const end = parseSeoulLocalDateTimeMs(reservation.endTime);
  return (
    reservation.attemptNo === target.attemptNo &&
    start !== null &&
    end !== null &&
    start === parseSeoulLocalDateTimeMs(target.startTime) &&
    end === parseSeoulLocalDateTimeMs(target.endTime)
  );
}

/** 취소 결과 불명(5xx·네트워크·타임아웃) 뒤 최신 상세로 판단한 결과 */
export type CancelRecheckOutcome =
  /** 확인한 그 예약이 CANCELED: 취소가 처리됐다 */
  | "CANCELED"
  /** 확인한 그 예약이 아직 확정(의뢰도 확정): 사용자가 다시 확인하고 직접 요청할 수 있다 */
  | "SAME_CONFIRMED"
  /** 현재 예약이 없거나 바뀌었거나(시도 번호·시각) 다른 상태: 이전 요청을 다시 보내지 않는다 */
  | "CHANGED"
  /** 의뢰·예약을 다시 조회하지 못함: 성공·실패를 판단하지 않는다 */
  | "LOOKUP_FAILED";

/**
 * 결과 불명 뒤 다시 불러온 상세(detail, 조회 실패면 null)를 사용자가 확인한 예약 표식과 비교한다.
 * 백엔드는 취소해도 의뢰의 현재 예약을 바꾸지 않으므로(Referral.cancel) 같은 예약이 CANCELED로 보이면 취소된 것이다.
 */
export function classifyCancelRecheck(
  target: ReservationCancelTarget,
  detail: {
    referralStatus: ReferralStatusDto;
    reservation:
      | { state: "none" | "missing" | "error" }
      | { state: "ok"; attemptNo: number; reservationStatus: ReservationStatusDto; startTime: string | null; endTime: string | null };
  } | null,
): CancelRecheckOutcome {
  if (!detail || detail.reservation.state === "error") return "LOOKUP_FAILED";
  const { reservation } = detail;
  if (reservation.state !== "ok" || !isSameCancelTarget(reservation, target)) return "CHANGED";
  if (reservation.reservationStatus === "CANCELED") return "CANCELED";
  if (reservation.reservationStatus === "CONFIRMED" && detail.referralStatus === "CONFIRMED") return "SAME_CONFIRMED";
  return "CHANGED";
}

export type ReservationCancelAvailability =
  /** 취소 버튼을 보인다 */
  | "AVAILABLE"
  /** 의뢰·예약이 확정 상태가 아니거나 예약·시각이 없다 (버튼 없음) */
  | "NOT_APPLICABLE"
  /** 확정 예약이지만 취소 마감(검사 시작 2시간 전)이 지났다 (버튼 없음, 안내) */
  | "DEADLINE_PASSED";

/** 상세 화면의 취소 버튼 표시 조건. nowMs는 브라우저에서만 넘긴다 (서버 렌더링·프리렌더에서 현재 시각을 읽지 않는다) */
export function getReservationCancelAvailability(
  referralStatus: ReferralStatusDto,
  reservation: { reservationStatus: ReservationStatusDto; startTime: string | null; endTime: string | null } | null,
  nowMs: number,
): ReservationCancelAvailability {
  if (referralStatus !== "CONFIRMED" || !reservation || reservation.reservationStatus !== "CONFIRMED") return "NOT_APPLICABLE";
  if (parseSeoulLocalDateTimeMs(reservation.endTime) === null) return "NOT_APPLICABLE";
  const deadline = getReservationCancelDeadlineMs(reservation.startTime);
  if (deadline === null) return "NOT_APPLICABLE";
  return nowMs < deadline ? "AVAILABLE" : "DEADLINE_PASSED";
}
