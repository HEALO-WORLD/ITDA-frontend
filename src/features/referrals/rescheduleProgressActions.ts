"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleAccess } from "@/lib/auth/session";

import { fetchReferral, fetchReservation, isReferralApiId, type FailureReasonDto, type ReferralStatusDto, type ReservationStatusDto } from "./remote";
import { toRescheduleProgress, type RescheduleProgressStage } from "./rescheduleProgress";

/**
 * 재예약 요청 뒤 진행 상태 확인 Server Function (조회만: 의뢰 단건 + 현재 예약 단건, 요청 2회).
 * 같은 출처 → users/me로 의뢰기관(REQUESTER) 확인 → 의뢰(우리 기관이 아니면 404) → 현재 예약.
 * 결과에는 토큰·환자명·서버 오류 본문을 담지 않는다. 화면 상태를 바꾸지 않고 서버 값만 돌려준다.
 */

type RescheduleProgressResult =
  | {
      ok: true;
      stage: RescheduleProgressStage;
      message: string;
      referralStatus: ReferralStatusDto;
      reservation: { id: string; status: ReservationStatusDto; failureReason: FailureReasonDto | null; startTime: string | null } | null;
    }
  | { ok: false; reason: "FORBIDDEN_ORIGIN" | "NOT_AVAILABLE" | "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "ERROR"; message: string };

export async function loadRescheduleProgressAction(referralId: unknown): Promise<RescheduleProgressResult> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN_ORIGIN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  if (!isApiFeature("referrals")) return { ok: false, reason: "NOT_AVAILABLE", message: "재예약 상태 확인 기능이 아직 연결되지 않았습니다." };
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) {
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "의뢰기관 계정만 확인할 수 있습니다." };
  }
  if (!isReferralApiId(referralId)) return { ok: false, reason: "INVALID_INPUT", message: "의뢰 정보가 올바르지 않습니다." };
  const options = { headers: access.headers };
  try {
    const referral = await fetchReferral(referralId, options);
    const dto = referral.currentReservationId ? await fetchReservation(referral.currentReservationId, options) : null;
    const reservation =
      dto && dto.referralId.toLowerCase() === referral.id.toLowerCase()
        ? { id: dto.id, status: dto.reservationStatus, failureReason: dto.failureReason, startTime: dto.startTime }
        : null;
    return { ok: true, referralStatus: referral.referralStatus, reservation, ...toRescheduleProgress(referral.referralStatus, reservation) };
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status !== 401) console.error("[referrals] 재예약 상태 확인 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
    if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    if (status === 403) return { ok: false, reason: "FORBIDDEN", message: "이 의뢰를 조회할 권한이 없습니다." };
    if (status === 404) return { ok: false, reason: "NOT_FOUND", message: "의뢰를 찾을 수 없습니다. 의뢰·예약 관리에서 확인해 주세요." };
    return { ok: false, reason: "ERROR", message: "상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." };
  }
}
