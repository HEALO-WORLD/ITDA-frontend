import "server-only";

import { unstable_rethrow } from "next/navigation";

import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import {
  EXAM_TYPE_MAX_PAGE_SIZE,
  fetchEquipmentDetail,
  fetchExamTypePage,
  fetchMyPartnerships,
  fetchReferral,
  fetchReferralHistories,
  fetchReferralPage,
  fetchReservation,
  getReferralErrorMessage,
  isExamTypeId,
  isPatientNameSearch,
  isReferralStatus,
  toReferralDisplayStatus,
  type ExamTypeDto,
  type ExamTypeModalityDto,
  type FailureReasonDto,
  type ReferralHistoryReasonDto,
  type ReferralResponseDto,
  type ReferralStatusDto,
  type ReservationStatusDto,
} from "./remote";
import type { ReferralDisplayStatus } from "./types";

/**
 * 의뢰 목록 API 화면용 데이터 (서버 전용).
 *
 * 인증: users/me로 의뢰기관(REQUESTER) 역할을 확인한 뒤에만 토큰을 Gateway로 넘긴다(requireRoleAccess("REFERRING")).
 * 조회 범위(요청자 소속 기관의 전체 의뢰)는 Gateway가 토큰에서 만든 X-Institution-Id로 백엔드가 정한다.
 * 브라우저 입력으로 기관·작성자를 고르지 않는다 (referringInstitutionId·referrerId는 보내지 않는다).
 * 확인에 실패하면(로그인 안 함·다른 역할·ADMIN·users/me 실패) 요청하지 않는다.
 *
 * 결과에는 화면에 쓰는 값만 담는다: 토큰과 내부 ID(referringInstitutionId·referrerId·currentReservationId)는 넘기지 않는다.
 * 실패해도 Mock으로 대체하지 않는다. 환자명·응답 본문은 로그에 남기지 않는다. JSX는 만들지 않는다.
 */

/** 화면 페이지 크기 (백엔드 기본값과 같다) */
export const REFERRAL_API_PAGE_SIZE = 10;

/** 정렬은 의뢰 생성 최신순으로 고정한다 */
export const REFERRAL_API_SORT = "createdAt,desc";

/** 의뢰 목록 1건 (화면용) */
export interface ReferralListItem {
  /** 의뢰 ID: 백엔드 id(UUID) 원본 그대로. 화면에서 줄여 보여도 요청에는 이 값을 쓴다 */
  referralId: string;
  /** 환자명 (역할이 확인된 의뢰기관 사용자에게만 내려간다) */
  patientName: string;
  /** 검사 유형 ID (이름은 검사 유형 API 연동 후 표시한다) */
  examTypeId: string;
  /** 백엔드 의뢰 상태 원본 */
  referralStatus: ReferralStatusDto;
  /** 화면 표시 상태. FAILED(예약 실패)는 대응하는 표시 상태가 없어 null */
  displayStatus: ReferralDisplayStatus | null;
}

/**
 * 실패 원인.
 * - SIGNED_OUT: 로그인 쿠키 없음 (요청하지 않음)
 * - UNAUTHORIZED: 401 → 다시 로그인
 * - FORBIDDEN: 403, 또는 의뢰기관 역할이 확인되지 않음 (요청하지 않음)
 * - INVALID: 조회 조건이 올바르지 않음 (요청하지 않음)
 * - NETWORK: 연결 실패·시간 초과
 * - ERROR: 그 밖의 실패 (400·5xx·응답 형식 오류·설정 오류)
 */
export interface ReferralLoadFailure {
  ok: false;
  reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | "NETWORK" | "ERROR";
  message: string;
  /** Gateway·백엔드 오류 코드 (원인을 덧붙일 때만 쓴다) */
  code: string | null;
}

export type ReferralPageLoadResult =
  | { ok: true; referrals: ReferralListItem[]; totalElements: number; totalPages: number; /** 0부터 */ page: number }
  | ReferralLoadFailure;

/** 조회 조건. 값은 화면(URL)에서 오므로 여기서 다시 확인한다 */
export interface ReferralPageQuery {
  /** 0부터 */
  page: number;
  status?: ReferralStatusDto;
  /** 환자명 부분 일치 (앞뒤 공백을 지운 1~20자) */
  patientName?: string;
  /** 검사 유형 ID 한 개 (백엔드는 여러 ID·modality 조건을 지원하지 않는다) */
  examTypeId?: string;
}

/** 의뢰 목록 한 페이지 (요청자 소속 기관의 전체 의뢰, 생성 최신순, 10건). 검색 조건은 서버가 전체 의뢰에 적용한다 */
export async function loadReferralPage(query: ReferralPageQuery): Promise<ReferralPageLoadResult> {
  const result = await loadReferralDtoPage(query);
  if (!result.ok) return result;
  const { data } = result;
  return {
    ok: true,
    referrals: data.contents.map(toReferralListItem),
    totalElements: data.totalElements,
    totalPages: data.totalPages,
    page: data.number,
  };
}

/** 역할 확인 → 조건 확인 → 의뢰 목록 원본 응답 (이 모듈 안에서만 쓴다: 예약 ID 등 내부 값이 들어 있다) */
async function loadReferralDtoPage({
  page,
  status,
  patientName,
  examTypeId,
}: ReferralPageQuery): Promise<
  { ok: true; data: Awaited<ReturnType<typeof fetchReferralPage>>; headers: HeadersInit } | ReferralLoadFailure
> {
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    (status !== undefined && !isReferralStatus(status)) ||
    (patientName !== undefined && !isPatientNameSearch(patientName)) ||
    (examTypeId !== undefined && !isExamTypeId(examTypeId))
  ) {
    return { ok: false, reason: "INVALID", message: "의뢰 목록 조회 조건이 올바르지 않습니다.", code: null };
  }
  try {
    const data = await fetchReferralPage(
      { page, size: REFERRAL_API_PAGE_SIZE, sort: REFERRAL_API_SORT, status, patientName: patientName?.trim(), examTypeId },
      { headers: access.headers },
    );
    return { ok: true, data, headers: access.headers };
  } catch (error) {
    // 프리렌더 중단 등 Next 내부 오류는 실패로 바꾸지 않고 다시 던져 Next가 처리하게 한다
    unstable_rethrow(error);
    return toFailure(error);
  }
}

/**
 * 부가 정보 조회 결과 (셀마다). 화면은 값이 없으면 "—"를 보이고, 원인은 구분해 둔다.
 * - ok: 값이 있다
 * - none: 조회할 대상이 없다 (예약 전 의뢰: currentReservationId 없음, 예약에 검사기관·시각이 없음)
 * - missing: 대상이 없다고 서버가 답했다 (예약 404, 협약 목록에 없는 검사기관)
 * - error: 조회하지 못했다 (권한·네트워크·서버·응답 형식 오류)
 */
export type DetailCell = { state: "ok"; value: string } | { state: "none" | "missing" | "error" };

/** 의뢰 목록 표 1행 (화면용). 예약 ID·기관 ID·작성자 ID는 담지 않는다 */
export interface ReferralTableRow {
  referralId: string;
  /** 환자명 (목록 응답 patientName. 역할이 확인된 의뢰기관 사용자에게만 내려간다) */
  patientName: string;
  examTypeId: string;
  referralStatus: ReferralStatusDto;
  /** 현재 예약의 검사기관 이름 (예약 → 검사기관 ID → 내 기관 협약 목록의 기관명) */
  examInstitution: DetailCell;
  /** 현재 예약의 검사 시작 시각 (LocalDateTime 문자열, 한국 시간) */
  examStartTime: DetailCell;
}

export type ReferralTablePageLoadResult =
  | {
      ok: true;
      rows: ReferralTableRow[];
      totalElements: number;
      totalPages: number;
      /** 0부터 */
      page: number;
      /** 부가 정보(예약·검사기관) 일부를 조회하지 못함 (목록은 정상) */
      detailIncomplete: boolean;
    }
  | ReferralLoadFailure;

/** 예약 단건 동시 요청 수 상한 (한 페이지 최대 10건) */
const RESERVATION_CONCURRENCY = 5;

/**
 * 의뢰 목록 표 한 페이지 (와이어프레임 6개 열용). 필수 조회(의뢰 목록)가 실패하면 실패, 부가 조회만 실패하면 셀만 비운다.
 * 부가 조회는 현재 페이지에서만 한다: 예약 단건(중복 제외, 예약 ID가 있는 의뢰만, 최대 10건·동시 5건) + 내 기관 협약 목록 1건.
 * 백엔드에 예약 일괄 조회·기관 단건 조회 API가 없어 이 조합을 쓴다. 검사 일시는 예약에 저장된 슬롯 시각(startTime)이다.
 * 의뢰기관 ID(referringInstitutionId)는 검사기관으로 쓰지 않는다.
 */
export async function loadReferralTablePage(query: ReferralPageQuery): Promise<ReferralTablePageLoadResult> {
  // 역할 확인을 통과해야 의뢰 목록을 받는다. 부가 조회도 그때 확인된 헤더로만 한다
  const result = await loadReferralDtoPage(query);
  if (!result.ok) return result;
  const { data, headers } = result;
  const dtos = data.contents;

  const reservationIds = [...new Set(dtos.flatMap((dto) => (dto.currentReservationId ? [dto.currentReservationId.toLowerCase()] : [])))];
  const [reservations, partnerships] = await Promise.all([
    mapWithConcurrency(reservationIds, RESERVATION_CONCURRENCY, async (id) => {
      try {
        return { id, state: "ok" as const, reservation: await fetchReservation(id, { headers }) };
      } catch (error) {
        unstable_rethrow(error);
        if (isApiError(error) && error.kind === "HTTP" && error.status === 404) return { id, state: "missing" as const };
        toFailure(error, "reservation");
        return { id, state: "error" as const };
      }
    }),
    fetchMyPartnerships({ headers }).then(
      (list) => ({ ok: true as const, nameById: new Map(list.map((p) => [p.partnerInstitutionId.toLowerCase(), p.partnerInstitutionName])) }),
      (error) => {
        unstable_rethrow(error);
        toFailure(error, "partnerships");
        return { ok: false as const };
      },
    ),
  ]);
  const reservationById = new Map(reservations.map((entry) => [entry.id, entry]));

  let detailIncomplete = !partnerships.ok && reservations.some((entry) => entry.state === "ok");
  const rows = dtos.map((dto): ReferralTableRow => {
    const base = { referralId: dto.id, patientName: dto.patientName, examTypeId: dto.examTypeId, referralStatus: dto.referralStatus };
    if (!dto.currentReservationId) return { ...base, examInstitution: { state: "none" }, examStartTime: { state: "none" } };
    const entry = reservationById.get(dto.currentReservationId.toLowerCase());
    if (!entry || entry.state !== "ok") {
      if (entry?.state !== "missing") detailIncomplete = true;
      const state = entry?.state === "missing" ? "missing" : "error";
      return { ...base, examInstitution: { state }, examStartTime: { state } };
    }
    // 다른 의뢰의 예약이 오면 쓰지 않는다 (의뢰-예약 연결 확인)
    if (entry.reservation.referralId.toLowerCase() !== dto.id.toLowerCase()) {
      detailIncomplete = true;
      return { ...base, examInstitution: { state: "error" }, examStartTime: { state: "error" } };
    }
    const { examInstitutionId, startTime } = entry.reservation;
    const name = examInstitutionId && partnerships.ok ? partnerships.nameById.get(examInstitutionId.toLowerCase()) : undefined;
    return {
      ...base,
      examInstitution: !examInstitutionId
        ? { state: "none" }
        : !partnerships.ok
          ? { state: "error" }
          : name
            ? { state: "ok", value: name }
            : { state: "missing" },
      examStartTime: startTime ? { state: "ok", value: startTime } : { state: "none" },
    };
  });
  return { ok: true, rows, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number, detailIncomplete };
}

/** 의뢰 상세 (화면용). 예약·슬롯·장비·기관·작성자 ID와 이력의 이벤트·변경자 ID는 담지 않는다 */
export interface ReferralDetail {
  referralId: string;
  patientName: string;
  referralStatus: ReferralStatusDto;
  /**
   * 현재 예약. none: 연결된 예약 없음(currentReservationId null) · missing: 예약 404 · error: 조회 실패
   */
  reservation:
    | { state: "none" | "missing" | "error" }
    | {
        state: "ok";
        attemptNo: number;
        reservationStatus: ReservationStatusDto;
        failureReason: FailureReasonDto | null;
        startTime: string | null;
        endTime: string | null;
        confirmedAt: string | null;
        endedAt: string | null;
        examInstitution: DetailCell;
        equipment: DetailCell;
      };
  /** 상태 변경 이력 (오래된 순). 조회 실패면 null */
  histories: { fromStatus: ReferralStatusDto | null; toStatus: ReferralStatusDto; reason: ReferralHistoryReasonDto; occurredAt: string }[] | null;
}

export type ReferralDetailLoadResult = { ok: true; detail: ReferralDetail } | ReferralLoadFailure;

/**
 * 의뢰 상세 (상세 대화상자용, 한 건). 의뢰기관 역할 확인 뒤에만 요청한다.
 * 의뢰 단건(필수)·변경 이력 → 현재 예약 → 검사기관 이름(내 기관 협약 목록)·장비 이름(장비 단건). 최대 5건 요청.
 * 부가 조회(이력·예약·기관·장비)만 실패하면 그 값만 비운다. 응답에 없는 값(의뢰 목적 등)은 만들지 않는다.
 */
export async function loadReferralDetail(referralId: unknown): Promise<ReferralDetailLoadResult> {
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  if (typeof referralId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referralId)) {
    return { ok: false, reason: "INVALID", message: "의뢰 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.", code: null };
  }
  const headers = access.headers;
  const [referral, histories] = await Promise.all([
    fetchReferral(referralId, { headers }).then(
      (dto) => ({ ok: true as const, dto }),
      (error) => {
        unstable_rethrow(error);
        return { ok: false as const, error };
      },
    ),
    fetchReferralHistories(referralId, { headers }).then(
      (list) => list.map(({ fromStatus, toStatus, reason, occurredAt }) => ({ fromStatus, toStatus, reason, occurredAt })),
      (error) => {
        unstable_rethrow(error);
        toFailure(error, "histories");
        return null;
      },
    ),
  ]);
  if (!referral.ok) {
    const failure = toFailure(referral.error, "detail");
    const notFound = isApiError(referral.error) && referral.error.kind === "HTTP" && referral.error.status === 404;
    if (notFound) return { ...failure, message: "의뢰를 찾을 수 없습니다. 삭제되었거나 우리 기관의 의뢰가 아닙니다." };
    if (failure.reason === "NETWORK") return { ...failure, message: "의뢰 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." };
    if (failure.reason === "ERROR") return { ...failure, message: "의뢰 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
    return failure;
  }
  const dto = referral.dto;
  return {
    ok: true,
    detail: {
      referralId: dto.id,
      patientName: dto.patientName,
      referralStatus: dto.referralStatus,
      reservation: await loadDetailReservation(dto, headers),
      histories,
    },
  };
}

async function loadDetailReservation(dto: ReferralResponseDto, headers: HeadersInit): Promise<ReferralDetail["reservation"]> {
  if (!dto.currentReservationId) return { state: "none" };
  let reservation: Awaited<ReturnType<typeof fetchReservation>>;
  try {
    reservation = await fetchReservation(dto.currentReservationId, { headers });
  } catch (error) {
    unstable_rethrow(error);
    if (isApiError(error) && error.kind === "HTTP" && error.status === 404) return { state: "missing" };
    toFailure(error, "reservation");
    return { state: "error" };
  }
  // 다른 의뢰의 예약이 오면 쓰지 않는다 (의뢰-예약 연결 확인)
  if (reservation.referralId.toLowerCase() !== dto.id.toLowerCase()) return { state: "error" };
  const [examInstitution, equipment] = await Promise.all([
    reservation.examInstitutionId
      ? fetchMyPartnerships({ headers }).then(
          (list): DetailCell => {
            const name = list.find((p) => p.partnerInstitutionId.toLowerCase() === reservation.examInstitutionId!.toLowerCase())?.partnerInstitutionName;
            return name ? { state: "ok", value: name } : { state: "missing" };
          },
          (error): DetailCell => {
            unstable_rethrow(error);
            toFailure(error, "partnerships");
            return { state: "error" };
          },
        )
      : ({ state: "none" } as DetailCell),
    reservation.equipmentId
      ? fetchEquipmentDetail(reservation.equipmentId, { headers }).then(
          (equipmentDetail): DetailCell => ({ state: "ok", value: equipmentDetail.name }),
          (error): DetailCell => {
            unstable_rethrow(error);
            if (isApiError(error) && error.kind === "HTTP" && error.status === 404) return { state: "missing" };
            toFailure(error, "equipment");
            return { state: "error" };
          },
        )
      : ({ state: "none" } as DetailCell),
  ]);
  const { attemptNo, reservationStatus, failureReason, startTime, endTime, confirmedAt, endedAt } = reservation;
  return { state: "ok", attemptNo, reservationStatus, failureReason, startTime, endTime, confirmedAt, endedAt, examInstitution, equipment };
}

/** 최대 limit개씩 동시에 실행한다 (입력 순서대로 결과를 돌려준다) */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 검사 유형 1건 (화면용: 소요시간은 쓰지 않는다) */
export interface ExamTypeItem {
  id: string;
  name: string;
  modality: ExamTypeModalityDto;
}

export type ExamTypeListLoadResult = { ok: true; examTypes: ExamTypeItem[] } | ReferralLoadFailure;

/** 검사 유형 페이지를 이보다 많이 받아야 하면 실패로 본다 (100건 × 20 = 2,000건. 일부만 받아 이름을 잘못 보이지 않게 한다) */
const EXAM_TYPE_MAX_PAGES = 20;

/**
 * 검사 유형 전체 목록 (의뢰 목록의 검사 유형 이름·필터 선택지용). 한 화면 요청에 한 번만 부른다 (의뢰마다 부르지 않는다).
 * 백엔드가 페이지로 나눠 주므로 크기 100으로 마지막 페이지까지 받는다. 검사 유형은 기관과 무관한 공용 목록이다.
 * 의뢰기관 역할이 확인된 경우에만 요청한다 (users/me 조회는 같은 요청 안에서 한 번만).
 */
export async function loadExamTypes(): Promise<ExamTypeListLoadResult> {
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const first = await fetchExamTypePage({ page: 0, size: EXAM_TYPE_MAX_PAGE_SIZE }, { headers: access.headers });
    if (first.totalPages > EXAM_TYPE_MAX_PAGES) {
      return { ok: false, reason: "ERROR", message: "검사 유형이 너무 많아 목록을 불러오지 못했습니다.", code: null };
    }
    const rest = await Promise.all(
      Array.from({ length: Math.max(first.totalPages - 1, 0) }, (_, index) =>
        fetchExamTypePage({ page: index + 1, size: EXAM_TYPE_MAX_PAGE_SIZE }, { headers: access.headers }),
      ),
    );
    const byId = new Map<string, ExamTypeItem>();
    for (const dto of [first, ...rest].flatMap((page) => page.contents)) byId.set(dto.id.toLowerCase(), toExamTypeItem(dto));
    // 페이지 사이에 목록이 바뀌면(추가·삭제) 개수가 맞지 않는다: 일부만 담지 않고 실패로 본다
    if (byId.size !== first.totalElements) {
      return { ok: false, reason: "ERROR", message: "검사 유형 목록이 조회 중에 바뀌었습니다. 다시 시도해 주세요.", code: null };
    }
    return { ok: true, examTypes: [...byId.values()] };
  } catch (error) {
    unstable_rethrow(error);
    const failure = toFailure(error, "exam-types");
    // 실패 원인을 빈 목록과 구분해 안내한다 (권한·연결·응답 형식·서버 오류)
    const kind = isApiError(error) ? error.kind : null;
    const message =
      failure.reason === "UNAUTHORIZED"
        ? failure.message
        : failure.reason === "FORBIDDEN"
          ? "검사 유형을 조회할 권한이 확인되지 않았습니다."
          : failure.reason === "NETWORK"
            ? "검사 유형 서버에 연결할 수 없습니다."
            : kind === "PARSE"
              ? "검사 유형 응답 형식을 확인할 수 없습니다."
              : "검사 유형 목록을 불러오지 못했습니다 (서버 오류).";
    return { ...failure, message };
  }
}

function toExamTypeItem({ id, name, modality }: ExamTypeDto): ExamTypeItem {
  return { id, name, modality };
}

// 화면에 쓰는 값만 골라 담는다 (기관·작성자·예약 ID는 넘기지 않는다)
function toReferralListItem(dto: ReferralResponseDto): ReferralListItem {
  return {
    referralId: dto.id,
    patientName: dto.patientName,
    examTypeId: dto.examTypeId,
    referralStatus: dto.referralStatus,
    displayStatus: toReferralDisplayStatus(dto.referralStatus),
  };
}

/** ApiError → 화면 실패 결과. 401 외의 실패는 서버 로그에 남긴다 (토큰·응답 본문·환자명은 남기지 않는다) */
function toFailure(
  error: unknown,
  action: "list" | "exam-types" | "reservation" | "partnerships" | "detail" | "histories" | "equipment" = "list",
): ReferralLoadFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[referrals] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : "unknown");
  }
  return {
    ok: false,
    reason: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : isNetwork ? "NETWORK" : "ERROR",
    message: getReferralErrorMessage(error),
    code,
  };
}
