"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleMutationAccess } from "@/lib/auth/session";

import {
  cancelReservation,
  fetchReferral,
  fetchReservation,
  getReferralDetailErrorMessage,
  getReservationCancelErrorMessage,
  isReferralApiId,
  type ReferralResponseDto,
  type ReservationResponseDto,
} from "./remote";
import { isReservationCancelTarget, isSameCancelTarget } from "./reservationCancel";

/**
 * 의뢰기관 예약 취소 Server Function (API 모드 의뢰 상세 대화상자).
 *
 * 브라우저에서는 의뢰 ID와 "사용자가 확인한 예약의 표식"(시도 번호·검사 시작·종료 시각)만 받는다.
 * 예약 ID는 브라우저로 보내지 않는 기존 설계(server.ts: 내부 ID 비노출)를 유지하고, 서버가 의뢰를 다시 조회해 현재 예약을 찾는다.
 * 1. 같은 출처 확인 → referrals 기능이 API 대상인지 → users/me로 의뢰기관(REQUESTER) 역할 확인 (ADMIN·EXAMINER는 요청 전 차단)
 *    → 화면이 렌더링된 로그인 세션과 지금 쿠키의 로그인 세션 비교 (다른 탭에서 계정이 바뀌었으면 SESSION_CHANGED, 요청하지 않음)
 * 2. 입력 형식 확인 → 의뢰 재조회 → 현재 예약 재조회
 * 3. 대상 동일성: 예약이 이 의뢰의 것이고, 의뢰·예약이 모두 CONFIRMED이고, 시도 번호·시각이 확인한 값과 같아야 한다.
 *    다르면(대화상자를 연 뒤 재조정·취소·상태 변경) 취소 API를 부르지 않고 STALE로 돌려준다 → 화면이 최신 상세를 다시 불러온다
 * 4. 취소 `PATCH .../reservations/{id}/cancel`. 2시간 마감·검사 상태는 백엔드가 최종 판단한다 (409)
 * 5xx·네트워크·타임아웃은 백엔드가 이미 취소했을 수 있어 실패로 단정하지 않고 결과 불명(UNKNOWN_RESULT)으로 돌려준다 → 화면이 최신 상세로 판단한다.
 * 성공·409·404·결과 불명 뒤에는 refresh()로 목록을 서버 값으로 다시 그린다. 상세 대화상자는 클라이언트 상태라 화면이 따로 다시 조회한다.
 * 결과에는 토큰·예약 ID·환자 이름·서버 오류 본문을 담지 않는다.
 */

export type ReservationCancelActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      reason:
        /** 같은 출처가 아님 (요청하지 않음) */
        | "FORBIDDEN_ORIGIN"
        /** 기능이 API 대상이 아니거나 Mock 모드 (요청하지 않음) */
        | "NOT_AVAILABLE"
        /** 토큰 쿠키 없음 (요청하지 않음) */
        | "SIGNED_OUT"
        /** 401 (만료·위조 토큰) */
        | "UNAUTHORIZED"
        /** 의뢰기관 역할이 아니거나 사용자 확인 실패, 또는 Gateway 403 */
        | "FORBIDDEN"
        /** 화면을 그린 뒤 다른 탭에서 로그인 계정이 바뀜(같은 계정 재로그인 포함) 또는 렌더링 세션 값 누락·형식 오류 (요청하지 않음) */
        | "SESSION_CHANGED"
        /** 의뢰 ID·대상 표식 형식 오류 (요청하지 않음) */
        | "INVALID_INPUT"
        /** 같은 의뢰의 취소를 이 서버가 이미 처리 중 (요청하지 않음) */
        | "DUPLICATE_REQUEST"
        /** 의뢰·예약 재조회 실패 (취소 요청하지 않음) */
        | "LOOKUP_FAILED"
        /** 확인한 예약과 현재 예약이 다르거나 더 이상 확정 상태가 아님 (취소 요청하지 않음) */
        | "STALE"
        /** 409: 백엔드가 취소를 거부함 (code에 원인) */
        | "CONFLICT"
        /** 404: 예약·의뢰를 찾을 수 없음 */
        | "NOT_FOUND"
        /** 5xx·응답을 받지 못함·형식 오류: 이미 처리됐을 수 있음 (같은 확인으로 다시 보내지 않는다) */
        | "UNKNOWN_RESULT"
        /** 그 밖의 실패 (처리되지 않은 것이 확실한 4xx 등) */
        | "ERROR";
      message: string;
      /** 백엔드·Gateway 오류 코드 (409 원인 등). 없으면 null */
      code: string | null;
    };

type Failure = Extract<ReservationCancelActionResult, { ok: false }>;

const UNAUTHORIZED_MESSAGE = "로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.";
const STALE_MESSAGE = "예약 정보가 바뀌어 취소하지 않았습니다. 최신 예약 정보를 다시 불러왔습니다. 내용을 확인한 뒤 다시 시도해 주세요.";

/**
 * 이 서버 프로세스에서 처리 중인 취소 (의뢰 ID 소문자). 연속 클릭·중복 호출이 PATCH를 두 번 보내지 않게 한다.
 * 프로세스 간 중복은 백엔드가 막는다 (이미 취소된 예약은 409 INVALID_RESERVATION_STATUS).
 */
const inFlightReferrals = new Set<string>();

/** expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값 (LoginSessionContext). 지금 쿠키 값과 다르면 취소하지 않는다 */
export async function cancelReservationAction(referralId: unknown, target: unknown, expectedLoginSession?: unknown): Promise<ReservationCancelActionResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN_ORIGIN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null };
  }
  // 기능 확인을 인증보다 먼저 한다: Mock 모드에서 '로그인 필요'가 아니라 '준비 중'으로 안내한다 (둘 다 요청 없음)
  if (!isApiFeature("referrals")) return { ok: false, reason: "NOT_AVAILABLE", message: "예약 취소 기능은 준비 중입니다.", code: null };
  const access = await requireRoleMutationAccess("REFERRING", expectedLoginSession);
  if (!access.ok) {
    // 다른 계정 쿠키로 바뀐 화면: 목록을 다시 그리지 않고(새 계정 데이터를 섞지 않음) 새로고침 안내만 한다
    if (access.reason === "SESSION_CHANGED") return { ok: false, reason: "SESSION_CHANGED", message: access.message, code: "SESSION_CHANGED" };
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다. 다시 로그인해 주세요.", code: null };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: UNAUTHORIZED_MESSAGE, code: null };
    return { ok: false, reason: "FORBIDDEN", message: access.message, code: null };
  }
  if (!isReferralApiId(referralId) || !isReservationCancelTarget(target)) {
    return { ok: false, reason: "INVALID_INPUT", message: "취소할 예약 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.", code: null };
  }

  const key = referralId.toLowerCase();
  if (inFlightReferrals.has(key)) {
    return { ok: false, reason: "DUPLICATE_REQUEST", message: "이 예약의 취소를 이미 처리하고 있습니다. 잠시 후 상태를 확인해 주세요.", code: null };
  }
  inFlightReferrals.add(key);
  try {
    const options = { headers: access.headers };
    let referral: ReferralResponseDto;
    try {
      referral = await fetchReferral(referralId, options);
    } catch (error) {
      return lookupFailure(error, getReferralDetailErrorMessage(error));
    }
    if (!referral.currentReservationId) return stale();
    let reservation: ReservationResponseDto;
    try {
      reservation = await fetchReservation(referral.currentReservationId, options);
    } catch (error) {
      if (isApiError(error) && error.kind === "HTTP" && error.status === 404) return stale();
      return lookupFailure(error, "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    // 대상 동일성: 사용자가 확인한 예약이 지금도 이 의뢰의 확정된 현재 예약일 때만 취소한다
    const sameTarget =
      reservation.referralId.toLowerCase() === referral.id.toLowerCase() &&
      referral.referralStatus === "CONFIRMED" &&
      reservation.reservationStatus === "CONFIRMED" &&
      isSameCancelTarget(reservation, target);
    if (!sameTarget) return stale();

    try {
      await cancelReservation(reservation.id, options);
    } catch (error) {
      unstable_rethrow(error);
      return requestFailure(error);
    }
    refresh();
    return { ok: true, message: "예약을 취소했습니다." };
  } finally {
    inFlightReferrals.delete(key);
  }
}

/** 확인한 예약이 더 이상 취소 대상이 아니다: 요청하지 않고 목록을 서버 값으로 다시 그린다 */
function stale(): Failure {
  refresh();
  return { ok: false, reason: "STALE", message: STALE_MESSAGE, code: null };
}

function logFailure(stage: string, error: unknown) {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  // 토큰·응답 본문·환자 정보는 남기지 않는다
  if (status !== 401) console.error(`[referrals] 예약 취소 ${stage} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
}

function lookupFailure(error: unknown, message: string): Failure {
  unstable_rethrow(error);
  logFailure("대상 조회", error);
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: UNAUTHORIZED_MESSAGE, code };
  if (status === 403) return { ok: false, reason: "FORBIDDEN", message: "예약을 취소할 권한이 없습니다.", code };
  if (status === 404) {
    refresh();
    return { ok: false, reason: "NOT_FOUND", message: "의뢰를 찾을 수 없습니다. 삭제되었거나 우리 기관의 의뢰가 아닙니다.", code };
  }
  return { ok: false, reason: "LOOKUP_FAILED", message, code };
}

function requestFailure(error: unknown): Failure {
  logFailure("요청", error);
  const kind = isApiError(error) ? error.kind : null;
  const status = isApiError(error) && kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const message = getReservationCancelErrorMessage(error);
  if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: UNAUTHORIZED_MESSAGE, code };
  if (status === 403) return { ok: false, reason: "FORBIDDEN", message, code };
  // 409·404·결과 불명은 서버 상태가 화면과 다를 수 있어 목록을 다시 그린다
  if (status === 409) {
    refresh();
    return { ok: false, reason: "CONFLICT", message, code };
  }
  if (status === 404) {
    refresh();
    return { ok: false, reason: "NOT_FOUND", message, code };
  }
  if (kind === "NETWORK" || kind === "TIMEOUT" || kind === "ABORTED" || kind === "PARSE" || (status !== null && status >= 500)) {
    refresh();
    return { ok: false, reason: "UNKNOWN_RESULT", message, code };
  }
  return { ok: false, reason: "ERROR", message, code };
}
