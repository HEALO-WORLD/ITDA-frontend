import "server-only";

import { unstable_rethrow } from "next/navigation";

import { fetchEquipment } from "@/features/equipment/remote";
import { fetchMyPartnershipList } from "@/features/partnerships/remote";
import { compareInstants, instantFromEpochMilli, parseOffsetDateTime } from "@/features/referrals/offsetDateTime";
import { fetchSlotDetail, isSlotApiId } from "@/features/slots/remote";
import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess } from "@/lib/auth/session";

import {
  CREATE_REFERRAL_UNCERTAIN,
  createReferral,
  fetchReferral,
  fetchReservation,
  getCreateReferralFailure,
  isReferralApiId,
  validatePatientName,
  type CreateReferralFailureReason,
  type FailureReasonDto,
  type ReferralStatusDto,
  type ReservationStatusDto,
} from "./remote";
import { toRescheduleLocalTimes } from "./rescheduleTime";

/**
 * 의뢰 생성 + 첫 예약 접수 (서버 전용). Server Function(createActions.ts)이 부른다.
 *
 * 순서: 기능 설정 → users/me로 REQUESTER 확인 → 입력 확인(슬롯·검사 유형 UUID, 환자명, 멱등 키)
 *   → 슬롯 재조회(AVAILABLE·검사 유형·미래 시각) → 슬롯의 장비 조회(OPERATIONAL, 검사기관 = 장비의 institutionId)
 *   → 내 ACTIVE 협약에 그 검사기관이 있는지 → 서울 LocalDateTime 변환 → POST /api/v1/referrals (1회)
 * - 브라우저에서는 slotId·examTypeId·환자명·멱등 키만 받는다. 의뢰기관 ID는 users/me, 검사기관·장비·시각은 서버 재조회 값만 쓴다
 * - 201은 '접수'다 (슬롯 확보·확정은 비동기). 최종 상태는 loadReferralProgress로 의뢰·예약을 다시 조회해 확인한다
 * - 같은 멱등 키 요청이 이 서버에서 처리 중이면 다시 보내지 않는다 (서버 인스턴스 안에서만. 최종 중복 방지는 백엔드 멱등 키)
 * 결과에는 토큰·서버 오류 본문·환자 정보 외 값을 담지 않는다. 로그에는 환자명을 남기지 않는다.
 */

const REQUIRED_FEATURES = ["referrals", "slots", "equipment", "partnerships"] as const;

export type CreateReferralActionFailureReason =
  | CreateReferralFailureReason
  | "NOT_AVAILABLE"
  | "SIGNED_OUT"
  | "INVALID_INPUT"
  | "IN_PROGRESS"
  /** 슬롯이 AVAILABLE이 아님 (이미 선점·예약됨 또는 사용 불가) */
  | "SLOT_NOT_AVAILABLE"
  /** 슬롯 정보가 화면과 다름 (검사 유형 변경·지난 시각·장비 사용 불가) */
  | "SLOT_CHANGED"
  | "LOOKUP_FAILED";

export type CreateReferralActionResult =
  | {
      ok: true;
      message: string;
      referral: { id: string; status: ReferralStatusDto; currentReservationId: string | null };
      /** 접수한 예약 시각 (서울 LocalDateTime) */
      reservation: { startTime: string; endTime: string };
    }
  | {
      ok: false;
      reason: CreateReferralActionFailureReason;
      message: string;
      /** true면 서버가 이미 접수했을 수 있다: 같은 멱등 키로만 다시 보낸다 (새 키 금지) */
      uncertain?: boolean;
      field?: "patientName";
    };

const inFlightKeys = new Set<string>();
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function logLookup(target: string, error: unknown) {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  if (status !== 401) console.error(`[referrals] 의뢰 생성 전 ${target} 조회 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
}

function lookupFailure(target: string, error: unknown, notFoundMessage: string): CreateReferralActionResult {
  unstable_rethrow(error);
  logLookup(target, error);
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
  if (status === 403) return { ok: false, reason: "FORBIDDEN", message: "슬롯 정보를 조회할 권한이 없습니다. 협약 상태를 확인해 주세요." };
  if (status === 404) return { ok: false, reason: "SLOT_CHANGED", message: notFoundMessage };
  const network = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  return {
    ok: false,
    reason: "LOOKUP_FAILED",
    message: network ? "서버에 연결할 수 없어 슬롯을 다시 확인하지 못했습니다. 의뢰는 요청하지 않았습니다." : "슬롯을 다시 확인하지 못했습니다. 의뢰는 요청하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  };
}

export async function submitCreateReferral(input: unknown): Promise<CreateReferralActionResult> {
  if (!REQUIRED_FEATURES.every((feature) => isApiFeature(feature))) {
    return { ok: false, reason: "NOT_AVAILABLE", message: "의뢰·예약 요청 기능이 아직 연결되지 않았습니다." };
  }
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) {
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다. 다시 로그인해 주세요." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "의뢰기관 계정만 의뢰를 요청할 수 있습니다." };
  }

  const data = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const { slotId, examTypeId, patientName, idempotencyKey } = data;
  if (!isSlotApiId(slotId) || !isReferralApiId(examTypeId)) {
    return { ok: false, reason: "INVALID_INPUT", message: "선택한 슬롯 정보가 올바르지 않습니다. 슬롯을 다시 선택해 주세요." };
  }
  const nameError = validatePatientName(patientName);
  if (nameError) return { ok: false, reason: "INVALID_INPUT", message: nameError, field: "patientName" };
  if (!isReferralApiId(idempotencyKey)) return { ok: false, reason: "INVALID_INPUT", message: "요청 키가 올바르지 않습니다. 화면을 새로고침해 주세요." };

  const key = idempotencyKey.toLowerCase();
  if (inFlightKeys.has(key)) return { ok: false, reason: "IN_PROGRESS", message: "같은 요청을 처리하고 있습니다. 잠시 후 결과를 확인해 주세요.", uncertain: true };
  inFlightKeys.add(key);
  try {
    return await createAfterChecks({ slotId, examTypeId, patientName: patientName as string, idempotencyKey, access });
  } finally {
    inFlightKeys.delete(key);
  }
}

async function createAfterChecks({
  slotId,
  examTypeId,
  patientName,
  idempotencyKey,
  access,
}: {
  slotId: string;
  examTypeId: string;
  patientName: string;
  idempotencyKey: string;
  access: Extract<Awaited<ReturnType<typeof requireRoleAccess>>, { ok: true }>;
}): Promise<CreateReferralActionResult> {
  const options = { headers: access.headers };

  // 1) 슬롯 재조회 (화면 값이 아니라 서버 값으로 확인)
  let slot;
  try {
    slot = await fetchSlotDetail(slotId, options);
  } catch (error) {
    return lookupFailure("슬롯", error, "슬롯을 찾을 수 없습니다. 다시 검색해 주세요.");
  }
  if (slot.status !== "AVAILABLE") {
    return { ok: false, reason: "SLOT_NOT_AVAILABLE", message: "이미 선점되었거나 예약할 수 없는 슬롯입니다. 다시 검색해 다른 슬롯을 선택해 주세요." };
  }
  if (!sameId(slot.examTypeId, examTypeId)) {
    return { ok: false, reason: "SLOT_CHANGED", message: "슬롯의 검사 유형이 화면과 다릅니다. 다시 검색해 주세요." };
  }
  const start = parseOffsetDateTime(slot.startsAt);
  if (!start || !(compareInstants(start, instantFromEpochMilli(Date.now())) > 0)) {
    return { ok: false, reason: "SLOT_CHANGED", message: "이미 시작 시각이 지난 슬롯입니다. 다른 슬롯을 선택해 주세요." };
  }

  // 2) 장비 (검사기관 ID는 장비 응답에서만 가져온다)
  let equipment;
  try {
    equipment = await fetchEquipment(slot.equipmentId, options);
  } catch (error) {
    return lookupFailure("장비", error, "슬롯의 장비를 찾을 수 없습니다. 다시 검색해 주세요.");
  }
  if (!sameId(equipment.id, slot.equipmentId)) return { ok: false, reason: "SLOT_CHANGED", message: "슬롯과 장비 정보가 맞지 않습니다. 다시 검색해 주세요." };
  if (equipment.status !== "OPERATIONAL") {
    return { ok: false, reason: "SLOT_CHANGED", message: "검사 장비가 현재 사용할 수 없는 상태입니다. 다른 슬롯을 선택해 주세요." };
  }

  // 3) ACTIVE 협약 (백엔드도 PARTNERSHIP_NOT_ACTIVE로 다시 막는다)
  let partnerships;
  try {
    partnerships = await fetchMyPartnershipList({ status: "ACTIVE" }, options);
  } catch (error) {
    return lookupFailure("협약", error, "협약 정보를 찾을 수 없습니다.");
  }
  const isPartner = partnerships.some((item) => item.status === "ACTIVE" && item.partnerInstitutionType === "EXAM" && sameId(item.partnerInstitutionId, equipment.institutionId));
  if (!isPartner) return { ok: false, reason: "PARTNERSHIP_NOT_ACTIVE", message: "협약 중인 검사기관이 아니어서 의뢰할 수 없습니다. 협약 상태를 확인해 주세요." };

  // 4) 서울 LocalDateTime (재예약과 같은 변환·검증)
  const times = toRescheduleLocalTimes({ startsAt: slot.startsAt, endsAt: slot.endsAt });
  if (!times.ok) return { ok: false, reason: "SLOT_CHANGED", message: times.message };

  // 5) POST 1회
  try {
    const referral = await createReferral(
      {
        referringInstitutionId: access.user.institutionId,
        examTypeId: slot.examTypeId,
        patientName,
        idempotencyKey,
        reservation: {
          slotId: slot.id,
          examInstitutionId: equipment.institutionId,
          equipmentId: equipment.id,
          examDate: times.startTime,
          startTime: times.startTime,
          endTime: times.endTime,
        },
      },
      options,
    );
    return {
      ok: true,
      message: "의뢰와 예약 요청이 접수되었습니다. 슬롯 확보와 예약 확정은 이어서 처리되며, 아직 확정되지 않았습니다.",
      referral: { id: referral.id, status: referral.referralStatus, currentReservationId: referral.currentReservationId },
      reservation: { startTime: times.startTime, endTime: times.endTime },
    };
  } catch (error) {
    unstable_rethrow(error);
    const failure = getCreateReferralFailure(error);
    if (failure.reason !== "UNAUTHORIZED") {
      console.error("[referrals] 의뢰 생성 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
    }
    return { ok: false, reason: failure.reason, message: failure.message, uncertain: CREATE_REFERRAL_UNCERTAIN.has(failure.reason) || undefined };
  }
}

// ── 접수 뒤 상태 확인 (조회만) ──

/** 화면 진행 단계: 처리 중 · 확정 · 실패 · 그 밖(취소·재조정 필요) */
export type ReferralProgressStage = "PROCESSING" | "CONFIRMED" | "FAILED" | "OTHER";

export type ReferralProgressResult =
  | {
      ok: true;
      stage: ReferralProgressStage;
      referralStatus: ReferralStatusDto;
      reservation: { id: string; status: ReservationStatusDto; failureReason: FailureReasonDto | null } | null;
      message: string;
    }
  | { ok: false; reason: "NOT_AVAILABLE" | "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "ERROR"; message: string };

const FAILURE_REASON_MESSAGES: Record<FailureReasonDto, string> = {
  SLOT_CONFLICT: "다른 요청이 먼저 이 슬롯을 확보해 예약하지 못했습니다.",
  CONFIRM_FAILED: "검사기관에서 예약을 확정하지 못했습니다.",
  HOLD_EXPIRED: "슬롯 확보 시간이 지나 예약이 취소되었습니다.",
  EQUIPMENT_FAILURE: "검사 장비 장애로 예약하지 못했습니다.",
};

/** 의뢰·예약 상태 → 진행 단계 (201 접수는 확정이 아니다) */
export function toReferralProgress(
  referralStatus: ReferralStatusDto,
  reservation: { status: ReservationStatusDto; failureReason: FailureReasonDto | null } | null,
): { stage: ReferralProgressStage; message: string } {
  if (reservation && (reservation.status === "FAILED" || reservation.status === "BLOCKED")) {
    return { stage: "FAILED", message: `예약에 실패했습니다. ${reservation.failureReason ? FAILURE_REASON_MESSAGES[reservation.failureReason] : ""} 다른 슬롯으로 다시 요청해 주세요.`.replace("  ", " ") };
  }
  if (referralStatus === "FAILED") return { stage: "FAILED", message: "의뢰 처리에 실패했습니다. 다른 슬롯으로 다시 요청해 주세요." };
  if (referralStatus === "CONFIRMED" && reservation?.status === "CONFIRMED") return { stage: "CONFIRMED", message: "예약이 확정되었습니다." };
  if (referralStatus === "CONFIRMED") return { stage: "CONFIRMED", message: "의뢰가 확정되었습니다." };
  if (referralStatus === "PENDING" && (!reservation || reservation.status === "REQUESTED" || reservation.status === "HELD")) {
    return { stage: "PROCESSING", message: reservation?.status === "HELD" ? "슬롯을 확보했습니다. 검사기관 확정을 기다리고 있습니다." : "예약 요청을 처리하고 있습니다." };
  }
  if (referralStatus === "NEEDS_RESCHEDULE") return { stage: "OTHER", message: "재조정이 필요한 의뢰입니다. 재조정·알림 화면에서 확인해 주세요." };
  if (referralStatus === "CANCELED") return { stage: "OTHER", message: "취소된 의뢰입니다." };
  return { stage: "PROCESSING", message: "예약 요청을 처리하고 있습니다." };
}

/** 의뢰 단건 + 현재 예약 단건 다시 조회 (요청 2회). 서버가 우리 기관 의뢰인지 확인한다 (아니면 404) */
export async function loadReferralProgress(referralId: unknown): Promise<ReferralProgressResult> {
  if (!isApiFeature("referrals")) return { ok: false, reason: "NOT_AVAILABLE", message: "의뢰 조회 기능이 아직 연결되지 않았습니다." };
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) {
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "의뢰기관 계정만 조회할 수 있습니다." };
  }
  if (!isReferralApiId(referralId)) return { ok: false, reason: "INVALID_INPUT", message: "의뢰 정보가 올바르지 않습니다." };
  const options = { headers: access.headers };
  try {
    const referral = await fetchReferral(referralId, options);
    const reservationDto = referral.currentReservationId ? await fetchReservation(referral.currentReservationId, options) : null;
    const reservation = reservationDto ? { id: reservationDto.id, status: reservationDto.reservationStatus, failureReason: reservationDto.failureReason } : null;
    return { ok: true, referralStatus: referral.referralStatus, reservation, ...toReferralProgress(referral.referralStatus, reservation) };
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status !== 401) console.error("[referrals] 의뢰 상태 조회 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
    if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    if (status === 404) return { ok: false, reason: "NOT_FOUND", message: "의뢰를 찾을 수 없습니다. 의뢰 목록에서 확인해 주세요." };
    return { ok: false, reason: "ERROR", message: "상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." };
  }
}
