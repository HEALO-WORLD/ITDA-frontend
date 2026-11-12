import "server-only";

import { unstable_rethrow } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess } from "@/lib/auth/session";

import { fetchEquipmentDetail, fetchReferral, fetchReservation, isReferralApiId, type ReservationStatusDto } from "./remote";
import { loadExamTypes } from "./server";

/**
 * 재조정 대상 의뢰 (API 모드, 슬롯 검색 화면의 `?rescheduleReferralId=`). 서버 전용, 조회만.
 *
 * 순서: users/me로 의뢰기관(REQUESTER) 확인 → 의뢰 단건(우리 기관 의뢰가 아니면 404) → NEEDS_RESCHEDULE인지 확인
 *   → [현재 예약 단건 → 장비 이름] + 검사 유형 목록 (병렬)
 * - 검사 유형은 의뢰의 examTypeId 원본을 쓴다 (화면 검색 조건을 이 값으로 고정한다)
 * - 기존 예약·장비 이름은 비교 표시용이다. 조회에 실패하면 그 값만 비우고 재조정은 계속할 수 있다 (최종 판단은 서버 재확인)
 * - Mock 의뢰로 대신하지 않는다. 토큰·환자명은 결과에 담지 않는다
 */

export interface ApiRescheduleTarget {
  referralId: string;
  examTypeId: string;
  /** 검사 유형 목록에서 찾은 이름·CT/MRI. 목록 조회 실패면 null */
  examTypeName: string | null;
  modality: "CT" | "MRI" | null;
  /** 기존(현재) 예약. 연결된 예약이 없거나 조회 실패면 null */
  currentReservation: {
    status: ReservationStatusDto;
    /** 서울 LocalDateTime 원본 */
    startTime: string | null;
    endTime: string | null;
    examInstitutionId: string | null;
    equipmentName: string | null;
  } | null;
}

export type ApiRescheduleTargetResult =
  | { ok: true; target: ApiRescheduleTarget }
  | {
      ok: false;
      reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | "NOT_FOUND" | "NOT_RESCHEDULABLE" | "NETWORK" | "ERROR";
      message: string;
    };

function log(target: string, error: unknown) {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  if (status !== 401) console.error(`[referrals] 재조정 대상 ${target} 조회 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
}

export async function loadApiRescheduleTarget(referralId: unknown): Promise<ApiRescheduleTargetResult> {
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) {
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다. 다시 로그인해 주세요." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "의뢰기관 계정만 예약을 재조정할 수 있습니다." };
  }
  if (!isReferralApiId(referralId)) return { ok: false, reason: "INVALID", message: "재조정 대상 의뢰 정보가 올바르지 않습니다." };
  const options = { headers: access.headers };

  let referral;
  try {
    referral = await fetchReferral(referralId, options);
  } catch (error) {
    unstable_rethrow(error);
    log("의뢰", error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    if (status === 403) return { ok: false, reason: "FORBIDDEN", message: "이 의뢰를 조회할 권한이 없습니다." };
    if (status === 404) return { ok: false, reason: "NOT_FOUND", message: "재조정 대상 의뢰를 찾을 수 없습니다. 삭제되었거나 우리 기관의 의뢰가 아닙니다." };
    const network = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
    return network
      ? { ok: false, reason: "NETWORK", message: "의뢰 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." }
      : { ok: false, reason: "ERROR", message: "재조정 대상 의뢰를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (referral.referralStatus === "EXPIRED") {
    return { ok: false, reason: "NOT_RESCHEDULABLE", message: "재조정 기한이 만료되어 더 이상 새 슬롯을 선택할 수 없습니다. 의뢰·예약 관리에서 종료 내역을 확인해 주세요." };
  }
  if (referral.referralStatus !== "NEEDS_RESCHEDULE") {
    return { ok: false, reason: "NOT_RESCHEDULABLE", message: "재조정이 필요한 상태의 의뢰가 아닙니다. 이미 재예약했거나 상태가 바뀌었을 수 있습니다." };
  }

  const [currentReservation, examTypes] = await Promise.all([loadCurrentReservation(referral.id, referral.currentReservationId, options), loadExamTypes()]);
  const examType = examTypes.ok ? examTypes.examTypes.find((item) => item.id.toLowerCase() === referral.examTypeId.toLowerCase()) : undefined;
  return {
    ok: true,
    target: {
      referralId: referral.id,
      examTypeId: referral.examTypeId,
      examTypeName: examType?.name ?? null,
      modality: examType ? examType.modality : null,
      currentReservation,
    },
  };
}

async function loadCurrentReservation(
  referralId: string,
  reservationId: string | null,
  options: { headers: HeadersInit },
): Promise<ApiRescheduleTarget["currentReservation"]> {
  if (!reservationId) return null;
  let reservation;
  try {
    reservation = await fetchReservation(reservationId, options);
  } catch (error) {
    unstable_rethrow(error);
    log("예약", error);
    return null;
  }
  if (reservation.referralId.toLowerCase() !== referralId.toLowerCase()) return null;
  let equipmentName: string | null = null;
  if (reservation.equipmentId) {
    try {
      equipmentName = (await fetchEquipmentDetail(reservation.equipmentId, options)).name;
    } catch (error) {
      unstable_rethrow(error);
      log("장비", error);
    }
  }
  return {
    status: reservation.reservationStatus,
    startTime: reservation.startTime,
    endTime: reservation.endTime,
    examInstitutionId: reservation.examInstitutionId,
    equipmentName,
  };
}
