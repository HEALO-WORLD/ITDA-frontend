"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { fetchEquipmentDetail, getEquipmentDetailErrorMessage, type EquipmentDetailDto } from "@/features/equipment/remote";
import { fetchSlotDetail, getSlotDetailErrorMessage, isSlotApiId, type SlotDetailDto } from "@/features/slots/remote";
import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { getRescheduleAuthorizationHeaders } from "@/lib/auth/session";

import {
  fetchReferral,
  getReferralDetailErrorMessage,
  getRescheduleErrorMessage,
  getRescheduleFailureReason,
  isReferralApiId,
  requestReschedule,
  validateRescheduleRequest,
  type ReferralResponseDto,
  type RescheduleFailureReason,
  type ReservationResponseDto,
  type ReservationStatusDto,
} from "./remote";
import { checkRescheduleCandidate, type RescheduleCandidateFailure } from "./rescheduleCandidate";
import { toRescheduleLocalTimes, type RescheduleTimeConversionResult } from "./rescheduleTime";

/**
 * 재예약 후보 확인(checkRescheduleCandidateAction, 읽기 전용)과 재예약 요청(requestRescheduleAction) Server Function.
 *
 * 브라우저에서는 referralId·slotId만 받는다. 나머지(검사기관·장비·검사 유형·시각)는 서버가 Gateway에서 다시 조회한 값만 쓴다.
 * 1. 같은 출처 확인 (Next의 Server Function Origin 검사에 더해 한 번 더)
 * 2. referrals·slots·equipment 기능이 모두 API 대상이어야 한다 (Mock으로 대체하지 않는다)
 * 3. 인증: 로그인 쿠키의 토큰을 Authorization: Bearer로만 넘긴다 (X- 헤더는 Gateway가 만든다). 쿠키가 없으면 요청하지 않는다
 * 4. 역할·접근 권한: 프론트에서 판단하지 않는다 (users/me 미연동). Gateway·백엔드 응답으로 구분한다
 *    - 의뢰 조회: 의뢰기관 소속이거나 관리자가 아니면 404 · 장비 조회: REQUESTER는 ACTIVE 협약 검사기관만, ADMIN은 Gateway 403
 *    - 의뢰 작성자 본인 여부는 확인하지 않는다 (재예약 POST에서 백엔드가 404로 거부한다)
 * 5. 의뢰·슬롯 ID 형식 확인 → 의뢰 → 슬롯 → 슬롯의 equipmentId로 장비 조회 → checkRescheduleCandidate → toRescheduleLocalTimes
 *
 * 성공은 "재예약 요청 전 확인 통과"일 뿐이다. 예약 변경·슬롯 확보는 일어나지 않았다.
 * 결과에는 토큰·서버 헤더·환자 이름·서버 오류 본문을 담지 않는다.
 */

// "use server" 파일은 async 함수만 내보낸다. 호출하는 쪽은 Awaited<ReturnType<typeof checkRescheduleCandidateAction>>로 쓴다
type RescheduleCandidateActionResult =
  | {
      ok: true;
      message: string;
      candidate: {
        referralId: string;
        slotId: string;
        equipmentId: string;
        /** 장비 응답의 institutionId */
        examInstitutionId: string;
        examTypeId: string;
        /** 슬롯 응답 원본 (OffsetDateTime) */
        startsAt: string;
        endsAt: string;
        /** 서울 기준 LocalDateTime (재예약 요청의 startTime·endTime 후보) */
        startTime: string;
        endTime: string;
      };
    }
  | {
      ok: false;
      reason:
        /** 같은 출처가 아님 */
        | "FORBIDDEN_ORIGIN"
        /** 의뢰·슬롯 ID가 UUID가 아님 (요청하지 않음) */
        | "INVALID_INPUT"
        /** 기능이 API 대상이 아니거나 Mock 모드 (요청하지 않음) */
        | "NOT_AVAILABLE"
        /** 토큰 쿠키 없음 (요청하지 않음) */
        | "SIGNED_OUT"
        /** Gateway 401 (만료·위조 토큰) */
        | "UNAUTHORIZED"
        /** 의뢰·슬롯·장비 조회 실패 (lookup에 대상과 원인) */
        | "LOOKUP_FAILED"
        /** 사전 확인 조건 실패 (failures에 실패 조건) */
        | "CANDIDATE_REJECTED"
        /** 서울 기준 시각 변환 실패 (timeFailure에 원인) */
        | "TIME_CONVERSION_FAILED"
        /** 재예약 POST 실패 (request에 원인. requestRescheduleAction만) */
        | "REQUEST_FAILED";
      message: string;
      request?: { cause: RescheduleFailureReason; status: number | null; code: string | null };
      lookup?: {
        target: "REFERRAL" | "SLOT" | "EQUIPMENT";
        /** FORBIDDEN: 403 (장비 조회의 ADMIN Gateway 거부 ACCESS_DENIED·협약 없음 FORBIDDEN 등) · NOT_FOUND: 404 (없음 또는 조회 범위 밖) */
        cause: "FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "NETWORK" | "INVALID_RESPONSE" | "ERROR";
        status: number | null;
        /** 백엔드·Gateway 오류 코드 (예: ACCESS_DENIED, FORBIDDEN, REFERRAL_NOT_FOUND) */
        code: string | null;
      };
      failures?: RescheduleCandidateFailure[];
      timeFailure?: Extract<RescheduleTimeConversionResult, { ok: false }>["reason"];
    };

type Failure = Extract<RescheduleCandidateActionResult, { ok: false }>;

type RescheduleRequestActionResult =
  | {
      ok: true;
      message: string;
      /** 접수된 예약 (백엔드 응답 상태, 보통 REQUESTED). 확정이 아니다 */
      reservation: { status: ReservationStatusDto; startTime: string; endTime: string };
    }
  | Failure;
type LookupTarget = NonNullable<Failure["lookup"]>["target"];

const REQUIRED_FEATURES = ["referrals", "slots", "equipment"] as const;

const CANDIDATE_FAILURE_MESSAGES: Record<RescheduleCandidateFailure, string> = {
  INVALID_REFERRAL: "의뢰 정보 형식을 확인할 수 없습니다.",
  INVALID_SLOT: "슬롯 정보 형식을 확인할 수 없습니다.",
  INVALID_EQUIPMENT: "장비 정보 형식을 확인할 수 없습니다.",
  INVALID_NOW: "기준 시각을 확인할 수 없습니다.",
  REFERRAL_NOT_RESCHEDULABLE: "재조정이 필요한 상태의 의뢰가 아닙니다.",
  SLOT_NOT_AVAILABLE: "선택한 슬롯은 예약할 수 없는 상태입니다. 다른 슬롯을 선택해 주세요.",
  EQUIPMENT_NOT_OPERATIONAL: "선택한 슬롯의 장비가 점검 중이거나 고장 상태입니다.",
  EQUIPMENT_MISMATCH: "슬롯과 장비 정보가 일치하지 않습니다.",
  EXAM_TYPE_MISMATCH: "선택한 슬롯의 검사 유형이 의뢰와 다릅니다.",
  INVALID_TIME_RANGE: "슬롯의 시작·종료 시각이 올바르지 않습니다.",
  START_NOT_IN_FUTURE: "이미 지난 슬롯입니다. 다른 슬롯을 선택해 주세요.",
};

export async function checkRescheduleCandidateAction(referralId: unknown, slotId: unknown): Promise<RescheduleCandidateActionResult> {
  const prepared = await prepareReschedule(referralId, slotId);
  if (!prepared.ok) return prepared;
  return {
    ok: true,
    message: "재예약 요청 전 확인을 통과했습니다. 아직 예약은 변경되지 않았습니다.",
    candidate: prepared.candidate,
  };
}

/**
 * 재예약 요청 `POST /api/v1/referrals/{referralId}/reschedule` (STEP A).
 * 확인 단계(prepareReschedule)를 매번 서버에서 다시 거친 뒤, 서버가 조회한 슬롯·장비 값으로만 본문을 만든다.
 * - examDate: 백엔드 재예약 계약 테스트(AuthHeaderContractTest.RESCHEDULE_BODY)·서비스 테스트와 같이 startTime과 같은 값
 * - 백엔드는 예약을 REQUESTED로 접수하고 슬롯 확보(HOLD)는 비동기로 처리한다 → 성공은 '접수'이지 '확정'이 아니다
 * - 같은 의뢰를 다시 요청하면 백엔드가 의뢰 비관적 락·상태 검사로 409를 돌려준다 (중복 접수 방지)
 * 접수·409·결과 불명(네트워크·응답 형식) 뒤에는 화면을 다시 불러와(refresh) 서버 상태로 맞춘다. 실패해도 화면에서 상태를 바꾸지 않는다.
 */
export async function requestRescheduleAction(referralId: unknown, slotId: unknown): Promise<RescheduleRequestActionResult> {
  const prepared = await prepareReschedule(referralId, slotId);
  if (!prepared.ok) return prepared;
  const { candidate, authorization } = prepared;

  const checked = validateRescheduleRequest({
    slotId: candidate.slotId,
    examInstitutionId: candidate.examInstitutionId,
    equipmentId: candidate.equipmentId,
    examDate: candidate.startTime,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
  });
  if (!checked.ok) {
    return { ok: false, reason: "TIME_CONVERSION_FAILED", message: checked.message };
  }

  let reservation: ReservationResponseDto;
  try {
    reservation = await requestReschedule(candidate.referralId, checked.body, { headers: authorization });
  } catch (error) {
    unstable_rethrow(error);
    const cause = getRescheduleFailureReason(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    const code = isApiError(error) ? error.code : null;
    if (status !== 401) console.error("[referrals] 재예약 요청 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}`.trim() : "unknown");
    // 409(이미 처리됨·상태 바뀜)와 결과 불명은 서버 상태가 화면과 다를 수 있어 다시 불러온다
    if (cause === "CONFLICT" || cause === "NETWORK" || cause === "INVALID_RESPONSE") refresh();
    if (cause === "UNAUTHORIZED") {
      return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요." };
    }
    return { ok: false, reason: "REQUEST_FAILED", message: getRescheduleErrorMessage(error), request: { cause, status, code } };
  }

  refresh();
  return {
    ok: true,
    message: "재예약 요청이 접수되었습니다. 슬롯 확보가 끝나면 예약이 확정됩니다. 아직 확정되지 않았습니다.",
    reservation: { status: reservation.reservationStatus, startTime: candidate.startTime, endTime: candidate.endTime },
  };
}

/** 확인 단계 공통: 같은 출처·기능·인증·입력 확인 → 의뢰·슬롯·장비 재조회 → 후보 확인 → 서울 시각 변환 */
async function prepareReschedule(
  referralId: unknown,
  slotId: unknown,
): Promise<Failure | { ok: true; candidate: Extract<RescheduleCandidateActionResult, { ok: true }>["candidate"]; authorization: HeadersInit }> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN_ORIGIN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  // 기능 확인을 인증보다 먼저 한다: Mock 모드(로그인 쿠키 없음)에서 '로그인 필요'가 아니라 '준비 중'으로 안내한다 (둘 다 요청 없음)
  if (!REQUIRED_FEATURES.every((feature) => isApiFeature(feature))) {
    return { ok: false, reason: "NOT_AVAILABLE", message: "재예약 기능은 준비 중입니다." };
  }
  const authorization = await getRescheduleAuthorizationHeaders();
  if (!authorization) {
    return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다. 다시 로그인해 주세요." };
  }
  if (!isReferralApiId(referralId) || !isSlotApiId(slotId)) {
    return { ok: false, reason: "INVALID_INPUT", message: "재예약 대상 정보가 올바르지 않습니다. 화면을 새로고침해 주세요." };
  }

  const options = { headers: authorization };
  let referral: ReferralResponseDto;
  let slot: SlotDetailDto;
  let equipment: EquipmentDetailDto;
  try {
    referral = await fetchReferral(referralId, options);
  } catch (error) {
    return lookupFailure("REFERRAL", error, getReferralDetailErrorMessage(error));
  }
  try {
    slot = await fetchSlotDetail(slotId, options);
  } catch (error) {
    return lookupFailure("SLOT", error, getSlotDetailErrorMessage(error));
  }
  try {
    // 장비 ID는 브라우저가 아니라 방금 조회한 슬롯 응답에서만 가져온다
    equipment = await fetchEquipmentDetail(slot.equipmentId, options);
  } catch (error) {
    return lookupFailure("EQUIPMENT", error, getEquipmentDetailErrorMessage(error));
  }

  const checked = checkRescheduleCandidate({ referral, slot, equipment, now: Date.now() });
  if (!checked.ok) {
    return { ok: false, reason: "CANDIDATE_REJECTED", message: CANDIDATE_FAILURE_MESSAGES[checked.failures[0]], failures: checked.failures };
  }
  const times = toRescheduleLocalTimes(checked.candidate);
  if (!times.ok) {
    return { ok: false, reason: "TIME_CONVERSION_FAILED", message: times.message, timeFailure: times.reason };
  }

  return {
    ok: true,
    candidate: { ...checked.candidate, startTime: times.startTime, endTime: times.endTime },
    authorization,
  };
}

function lookupFailure(target: LookupTarget, error: unknown, message: string): Failure {
  // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않는다
  unstable_rethrow(error);
  const kind = isApiError(error) ? error.kind : null;
  const status = isApiError(error) && kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  // 토큰·응답 본문·환자 정보는 남기지 않는다
  if (status !== 401) console.error(`[referrals] 재예약 후보 ${target} 조회 실패:`, kind ? `${kind} ${status ?? ""} ${code ?? ""}`.trim() : "unknown");

  if (status === 401) {
    return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요." };
  }
  const cause: NonNullable<Failure["lookup"]>["cause"] =
    status === 403
      ? "FORBIDDEN"
      : status === 404
        ? "NOT_FOUND"
        : status === 400
          ? "INVALID_REQUEST"
          : kind === "NETWORK" || kind === "TIMEOUT"
            ? "NETWORK"
            : kind === "PARSE"
              ? "INVALID_RESPONSE"
              : "ERROR";
  return { ok: false, reason: "LOOKUP_FAILED", message, lookup: { target, cause, status, code } };
}
