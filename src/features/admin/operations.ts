import "server-only";

import { unstable_rethrow } from "next/navigation";

import {
  fetchReferral,
  fetchReferralHistories,
  fetchReferralPage,
  fetchReservation,
  fetchReservationPage,
  type ReferralHistoryDto,
  type ReferralListParams,
  type ReferralResponseDto,
  type ReservationListParams,
  type ReservationResponseDto,
} from "@/features/referrals/remote";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { fetchSlotStatusHistories, SLOT_HISTORY_PAGE_SIZE, type SlotStatusHistoryDto } from "./remote";
import { toAdminFailure, type AdminLoadFailure } from "./server";

/**
 * 관리자 의뢰·예약·슬롯 이력 조회 (서버 전용, 조회만).
 *
 * 인증: 함수마다 users/me로 ADMIN을 확인한 뒤에만 요청한다 (requireRoleAccess("ADMIN"), 레이아웃 게이트만 믿지 않는다).
 * 백엔드는 ADMIN에게 전체 기관 데이터를 준다. 의뢰기관 화면 로더(features/referrals/server.ts)는 그대로 REFERRING 전용이다.
 * 의뢰·예약 통신 함수는 의뢰기관 화면과 같은 것(features/referrals/remote.ts)을 쓴다.
 * 목록에서는 단건 API를 부르지 않는다 (기관명은 관리자 기관 목록 1회로 ID → 이름을 찾는다).
 * 실패해도 Mock으로 대체하지 않는다. 로그에는 종류·상태·코드만 남긴다 (환자명·토큰·본문 없음).
 */

type Page<T> = { ok: true; items: T[]; totalElements: number; totalPages: number; page: number; size: number };

export type AdminReferralPageResult = Page<ReferralResponseDto> | AdminLoadFailure;

export async function loadAdminReferralPage(params: ReferralListParams): Promise<AdminReferralPageResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchReferralPage(params, { headers: access.headers });
    return { ok: true, items: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number, size: data.size };
  } catch (error) {
    unstable_rethrow(error);
    return toAdminFailure(error, "referrals", "의뢰 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 관리자 의뢰 상세: 의뢰(필수) + 변경 이력 + 현재 예약. 부가 조회만 실패하면 그 부분만 실패로 둔다 */
export interface AdminReferralDetail {
  referral: ReferralResponseDto;
  histories: ReferralHistoryDto[] | AdminLoadFailure;
  /** 예약 없음(null) · 예약 · 조회 실패 */
  reservation: ReservationResponseDto | null | AdminLoadFailure;
}

export async function loadAdminReferralDetail(referralId: string): Promise<{ ok: true; detail: AdminReferralDetail } | AdminLoadFailure> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const headers = access.headers;
  const [referral, histories] = await Promise.all([
    fetchReferral(referralId, { headers }).then(
      (dto) => ({ ok: true as const, dto }),
      (error) => {
        unstable_rethrow(error);
        return withNotFound(toAdminFailure(error, "referral-detail", "의뢰 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."), error, "의뢰를 찾을 수 없습니다. 삭제되었거나 올바르지 않은 의뢰입니다.");
      },
    ),
    fetchReferralHistories(referralId, { headers }).catch((error) => {
      unstable_rethrow(error);
      return toAdminFailure(error, "referral-histories", "의뢰 변경 이력을 불러오지 못했습니다.");
    }),
  ]);
  if (!referral.ok) return referral;
  let reservation: AdminReferralDetail["reservation"] = null;
  if (referral.dto.currentReservationId) {
    try {
      reservation = await fetchReservation(referral.dto.currentReservationId, { headers });
    } catch (error) {
      unstable_rethrow(error);
      reservation = toAdminFailure(error, "referral-reservation", "현재 예약 정보를 불러오지 못했습니다.");
    }
  }
  return { ok: true, detail: { referral: referral.dto, histories, reservation } };
}

export type AdminReservationPageResult = Page<ReservationResponseDto> | AdminLoadFailure;

export async function loadAdminReservationPage(params: ReservationListParams): Promise<AdminReservationPageResult> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchReservationPage(params, { headers: access.headers });
    return { ok: true, items: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number, size: data.size };
  } catch (error) {
    unstable_rethrow(error);
    return toAdminFailure(error, "reservations", "예약 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function loadAdminReservation(reservationId: string): Promise<{ ok: true; reservation: ReservationResponseDto } | AdminLoadFailure> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    return { ok: true, reservation: await fetchReservation(reservationId, { headers: access.headers }) };
  } catch (error) {
    unstable_rethrow(error);
    return withNotFound(toAdminFailure(error, "reservation-detail", "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."), error, "예약을 찾을 수 없습니다. 삭제되었거나 올바르지 않은 예약입니다.");
  }
}

export async function loadAdminSlotHistories(slotId: string, page: number): Promise<Page<SlotStatusHistoryDto> | AdminLoadFailure> {
  const access = await requireRoleAccess("ADMIN");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchSlotStatusHistories(slotId, { page, size: SLOT_HISTORY_PAGE_SIZE }, { headers: access.headers });
    return { ok: true, items: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number, size: data.size };
  } catch (error) {
    unstable_rethrow(error);
    return withNotFound(toAdminFailure(error, "slot-histories", "슬롯 상태 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."), error, "슬롯을 찾을 수 없습니다. 슬롯 ID를 확인해 주세요.");
  }
}

/** 404는 코드가 없어도 '찾을 수 없음'으로 안내한다 */
function withNotFound(failure: AdminLoadFailure, error: unknown, message: string): AdminLoadFailure {
  return isApiError(error) && error.kind === "HTTP" && error.status === 404 ? { ...failure, message } : failure;
}
