import "server-only";

import { unstable_rethrow } from "next/navigation";

import { fetchReservation, fetchReservationPage, type ReservationListParams, type ReservationResponseDto } from "@/features/referrals/remote";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { EQUIPMENT_MAX_PAGE_SIZE, fetchInstitutionEquipments, type InstitutionEquipmentDto } from "./remote";

/**
 * 검사기관 확정 예약 화면 데이터 (서버 전용, 조회만).
 *
 * 인증: 함수마다 users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 요청한다 (requireRoleAccess("EXAMINING")).
 * 기관 격리: 예약 범위는 백엔드가 X-Institution-Id(Gateway가 토큰에서 붙임)로 정한다 (요청자 기관이 검사하거나 의뢰한 예약만).
 * 화면에서 받은 기관 ID로 범위를 바꾸지 않는다: 목록 조건에 검사기관·의뢰·작성자 ID를 넣지 않고,
 * 장비 목록은 users/me의 소속 기관 ID로만 조회한다.
 * 실패해도 Mock으로 대체하지 않는다. 로그에는 종류·상태·코드만 남긴다 (토큰·응답 본문·환자 정보 없음).
 */

export interface ExaminingLoadFailure {
  ok: false;
  reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NETWORK" | "ERROR";
  message: string;
  code: string | null;
}

/** 검사기관 화면에서 쓰는 예약 목록 조건 (범위를 바꿀 수 있는 ID 조건은 받지 않는다) */
export type ExaminingReservationQuery = Pick<ReservationListParams, "equipmentId" | "status" | "failureReason" | "examDateFrom" | "examDateTo" | "page" | "size" | "sort">;

export type ExaminingReservationPageResult =
  | { ok: true; items: ReservationResponseDto[]; totalElements: number; totalPages: number; page: number; size: number }
  | ExaminingLoadFailure;

export async function loadExaminingReservationPage(query: ExaminingReservationQuery): Promise<ExaminingReservationPageResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const { equipmentId, status, failureReason, examDateFrom, examDateTo, page, size, sort } = query;
  try {
    const data = await fetchReservationPage({ equipmentId, status, failureReason, examDateFrom, examDateTo, page, size, sort }, { headers: access.headers });
    return { ok: true, items: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number, size: data.size };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "reservations", "예약 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function loadExaminingReservation(reservationId: string): Promise<{ ok: true; reservation: ReservationResponseDto } | ExaminingLoadFailure> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    return { ok: true, reservation: await fetchReservation(reservationId, { headers: access.headers }) };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "reservation-detail", "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export type ExaminingEquipmentResult = { ok: true; equipments: InstitutionEquipmentDto[]; truncated: boolean } | ExaminingLoadFailure;

/** 우리 기관 장비 목록 1페이지(최대 100대). 장비 이름 표시·장비 필터 선택지용 */
export async function loadExaminingEquipments(): Promise<ExaminingEquipmentResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchInstitutionEquipments(access.user.institutionId, { page: 0, size: EQUIPMENT_MAX_PAGE_SIZE }, { headers: access.headers });
    return { ok: true, equipments: data.contents, truncated: data.totalPages > 1 };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "equipments", "장비 목록을 불러오지 못했습니다.");
  }
}

const NOT_FOUND_MESSAGES: Record<string, string> = {
  "reservation-detail": "예약을 찾을 수 없습니다. 삭제되었거나 우리 기관 예약이 아닙니다.",
};

function toFailure(error: unknown, action: string, fallback: string): ExaminingLoadFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[reservations] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : "unknown");
  }
  const message =
    status === 401
      ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
      : status === 403
        ? "검사기관 담당자만 조회할 수 있습니다."
        : status === 404 && NOT_FOUND_MESSAGES[action]
          ? NOT_FOUND_MESSAGES[action]
          : isNetwork
            ? "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요."
            : fallback;
  return { ok: false, reason: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : isNetwork ? "NETWORK" : "ERROR", message, code };
}
