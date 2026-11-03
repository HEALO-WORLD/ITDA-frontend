import "server-only";

import { unstable_rethrow } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { getInstitutionScopedAuthorizationHeaders } from "@/lib/auth/session";

import {
  fetchExamTypePage,
  fetchRescheduleReferralPage,
  fetchReservation,
  getRescheduleListErrorMessage,
  getReservationErrorMessage,
  type FailureReasonDto,
  type ReferralResponseDto,
  type ReservationResponseDto,
  type ReservationStatusDto,
} from "./remote";

/**
 * 재조정 필요 의뢰 목록 (API 모드 화면용, 서버 전용).
 * - 토큰은 서버에서만 Gateway로 넘긴다. 사용자·기관 ID는 보내지 않는다 (범위는 Gateway의 X-Institution-Id로 서버가 정한다)
 * - 응답 필드를 화면 항목으로 명시적으로 옮긴다. 응답에 없는 의뢰번호·기관명·장비명·검사 일시·재조정 사유는 만들지 않는다
 * - 검사 유형명은 검사 유형 API로 붙인다. 그 조회가 실패해도 목록은 보여 주고 유형명만 '확인 불가'로 둔다
 * - 실패해도 Mock으로 대체하지 않고, 실패를 0건으로 바꾸지 않는다
 * - 기존 예약 상세는 사용자가 고른 의뢰 하나만 따로 조회한다 (loadRescheduleReservation). 실패해도 목록은 그대로다
 */

/** 화면 페이지 크기 (백엔드 허용값 10·30·50 중 기본값) */
export const RESCHEDULE_API_PAGE_SIZE = 10;
/** 검사 유형 페이지를 끝까지 읽을 때의 상한 (페이지당 100건) */
const EXAM_TYPE_MAX_PAGES = 10;

export interface RescheduleReferralItem {
  referralId: string;
  patientName: string;
  examTypeId: string;
  /** 검사 유형명. 유형 조회에 실패했거나 목록에 없는 ID면 null */
  examTypeName: string | null;
  /** 기존 예약 ID (상세 조회용, 화면에 표시하지 않는다). 예약이 연결되지 않았으면 null */
  currentReservationId: string | null;
}

export type RescheduleReferralLoadResult =
  | {
      ok: true;
      items: RescheduleReferralItem[];
      totalElements: number;
      totalPages: number;
      /** 0부터 */
      page: number;
      /** 검사 유형 조회 실패 안내 (성공이면 null) */
      examTypeWarning: string | null;
    }
  | {
      ok: false;
      /** SIGNED_OUT: 토큰 쿠키 없음(요청 안 함) · UNAUTHORIZED: 401 · FORBIDDEN: 403 · NETWORK: 연결 실패·시간 초과 · ERROR: 그 밖의 실패 */
      reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NETWORK" | "ERROR";
      message: string;
      code: string | null;
    };

export async function loadRescheduleReferralPage(page: number): Promise<RescheduleReferralLoadResult> {
  const headers = await getInstitutionScopedAuthorizationHeaders();
  if (!headers) {
    return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다.", code: null };
  }

  let data: Awaited<ReturnType<typeof fetchRescheduleReferralPage>>;
  try {
    data = await fetchRescheduleReferralPage({ page, size: RESCHEDULE_API_PAGE_SIZE }, { headers });
  } catch (error) {
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않고 다시 던져 Next가 처리하게 한다
    unstable_rethrow(error);
    return toFailure(error);
  }

  const examTypes = data.contents.length > 0 ? await loadExamTypeNames(headers) : { names: new Map<string, string>(), warning: null };
  return {
    ok: true,
    items: data.contents.map((referral) => toItem(referral, examTypes.names)),
    totalElements: data.totalElements,
    totalPages: data.totalPages,
    page: data.number,
    examTypeWarning: examTypes.warning,
  };
}

function toItem(referral: ReferralResponseDto, names: ReadonlyMap<string, string>): RescheduleReferralItem {
  return {
    referralId: referral.id,
    patientName: referral.patientName,
    examTypeId: referral.examTypeId,
    examTypeName: names.get(referral.examTypeId.toLowerCase()) ?? null,
    currentReservationId: referral.currentReservationId,
  };
}

/** 재조정 대상 의뢰의 기존 예약 (화면 표시용. 장비·기관은 이름 API가 없어 ID만) */
export interface RescheduleReservationDetail {
  /** `YYYY-MM-DD` */
  examDate: string;
  /** `HH:mm` */
  startTime: string;
  /** `HH:mm` */
  endTime: string;
  equipmentId: string;
  examInstitutionId: string;
  reservationStatus: ReservationStatusDto;
  failureReason: FailureReasonDto | null;
}

export type RescheduleReservationLoadResult =
  | { ok: true; detail: RescheduleReservationDetail }
  | {
      ok: false;
      /** NO_RESERVATION: 연결된 예약 없음(요청 안 함) · NOT_FOUND: 404(없음 또는 기관 범위 밖) · 나머지는 목록과 같다 */
      reason: "NO_RESERVATION" | "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NETWORK" | "ERROR";
      message: string;
      code: string | null;
    };

/**
 * 선택한 재조정 대상 의뢰의 기존 예약 조회 (사용자가 상세 보기를 골랐을 때만 호출한다).
 * 예약 ID는 URL이 아니라 서버가 조회한 목록 항목의 currentReservationId에서만 가져온다.
 * 응답의 referralId가 선택한 의뢰와 다르면 다른 예약으로 보고 표시하지 않는다.
 */
export async function loadRescheduleReservation(item: RescheduleReferralItem): Promise<RescheduleReservationLoadResult> {
  if (item.currentReservationId === null) {
    return { ok: false, reason: "NO_RESERVATION", message: "이 의뢰에 연결된 예약 정보가 없습니다.", code: null };
  }
  const headers = await getInstitutionScopedAuthorizationHeaders();
  if (!headers) {
    return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다.", code: null };
  }

  let data: ReservationResponseDto;
  try {
    data = await fetchReservation(item.currentReservationId, { headers });
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    const kind = isApiError(error) ? error.kind : null;
    if (status !== 401 && status !== 404) console.error("[referrals] 기존 예약 조회 실패:", describe(error));
    return {
      ok: false,
      reason:
        status === 401
          ? "UNAUTHORIZED"
          : status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "NOT_FOUND"
              : kind === "NETWORK" || kind === "TIMEOUT"
                ? "NETWORK"
                : "ERROR",
      message: getReservationErrorMessage(error),
      code: isApiError(error) ? error.code : null,
    };
  }

  if (data.referralId.toLowerCase() !== item.referralId.toLowerCase()) {
    console.error("[referrals] 기존 예약 조회 실패: 선택한 의뢰의 예약이 아님");
    return { ok: false, reason: "ERROR", message: "서버 응답 형식을 확인할 수 없습니다.", code: null };
  }
  return {
    ok: true,
    detail: {
      examDate: data.examDate.slice(0, 10),
      startTime: data.startTime.slice(11, 16),
      endTime: data.endTime.slice(11, 16),
      equipmentId: data.equipmentId,
      examInstitutionId: data.examInstitutionId,
      reservationStatus: data.reservationStatus,
      failureReason: data.failureReason,
    },
  };
}

/** 검사 유형 전체를 읽어 ID → 이름 표를 만든다. 실패하면 빈 표와 안내 문구 */
async function loadExamTypeNames(headers: HeadersInit): Promise<{ names: Map<string, string>; warning: string | null }> {
  const names = new Map<string, string>();
  try {
    for (let page = 0; page < EXAM_TYPE_MAX_PAGES; page++) {
      const data = await fetchExamTypePage(page, { headers });
      for (const { id, name } of data.contents) names.set(id.toLowerCase(), name);
      if (page + 1 >= data.totalPages) break;
    }
    return { names, warning: null };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[referrals] 검사 유형 조회 실패:", describe(error));
    return { names: new Map(), warning: "검사 유형 정보를 불러오지 못해 유형명을 표시하지 않습니다." };
  }
}

function toFailure(error: unknown): RescheduleReferralLoadResult & { ok: false } {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const kind = isApiError(error) ? error.kind : null;
  if (status !== 401) console.error("[referrals] 재조정 필요 목록 조회 실패:", describe(error));
  return {
    ok: false,
    reason:
      status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : kind === "NETWORK" || kind === "TIMEOUT"
            ? "NETWORK"
            : "ERROR",
    message: getRescheduleListErrorMessage(error),
    code,
  };
}

/** 로그용 요약 (종류·상태·코드만. 응답 본문·토큰은 남기지 않는다) */
function describe(error: unknown): string {
  return isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}`.trim() : error instanceof Error ? error.name : "unknown";
}
