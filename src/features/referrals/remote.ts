import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { isApiFeature, requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

import type { ReferralDisplayStatus } from "./types";

/**
 * 의뢰 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 ReferralController·ReferralSearchCondition·ReferralResponse를 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * 의뢰 목록 조회는 API 연결 함수다 (`referrals` 기능을 API 대상으로 골랐을 때만 호출할 수 있다).
 * 서버 데이터 로더(server.ts의 loadReferralPage)만 이 함수를 부른다. Mock 화면(api.ts의 getRecentReferrals)은 쓰지 않는다.
 * 목록 응답에는 의뢰번호·검사기관·검사 유형명·검사 일시가 없다 (응답에 없는 값을 만들어 채우지 않는다).
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-User-Id·X-Institution-Id·X-Role을 붙인다.
 * 프론트는 이 X- 헤더들을 만들지 않는다 (Gateway가 바깥에서 온 값을 지운다).
 * 토큰은 서버 전용 모듈(server.ts)이 역할 확인(requireRoleAccess) 뒤 `headers`로 넘긴다.
 *
 * Mock 구현으로 대신하지 않는다: 입력이 계약과 다르면 요청 없이 설정 오류(CONFIG),
 * 호출 실패는 ApiError 그대로, 응답 형태가 계약과 다르면 PARSE 오류로 던진다.
 */

/** 백엔드 ReferralStatus. 표기를 바꾸지 않는다 (CANCELED는 L 하나) */
export type ReferralStatusDto = "PENDING" | "CONFIRMED" | "FAILED" | "CANCELED" | "NEEDS_RESCHEDULE";

/** 백엔드 ReferralStatus 값 목록 (domain/enums/ReferralStatus.java) */
export const REFERRAL_STATUSES: readonly ReferralStatusDto[] = ["PENDING", "CONFIRMED", "FAILED", "CANCELED", "NEEDS_RESCHEDULE"];

export const isReferralStatus = (value: unknown): value is ReferralStatusDto =>
  REFERRAL_STATUSES.includes(value as ReferralStatusDto);

/** 백엔드가 허용하는 페이지 크기 (그 외 값은 서버가 10으로 바꾼다) */
export const REFERRAL_PAGE_SIZES = [10, 30, 50] as const;

/** 백엔드 ReferralResponse (ID는 UUID 문자열) */
export interface ReferralResponseDto {
  /** 의뢰 ID(referralId). 상세 조회·재예약 등에서 원본 그대로 쓴다 */
  id: string;
  referringInstitutionId: string;
  referrerId: string;
  examTypeId: string;
  /** 현재 예약 시도 ID. 예약 전이면 null */
  currentReservationId: string | null;
  referralStatus: ReferralStatusDto;
  patientName: string;
}

/**
 * 의뢰 목록 조회 조건 (백엔드 ReferralSearchCondition).
 * 조회 범위는 서버가 정한다: 관리자가 아니면 요청자 소속 기관(X-Institution-Id)의 의뢰만 온다.
 */
export interface ReferralListParams {
  status?: ReferralStatusDto;
  /** 관리자 전용 필터 */
  referringInstitutionId?: string;
  /** 본인 ID를 넣으면 내가 작성한 의뢰만 */
  referrerId?: string;
  examTypeId?: string;
  /** 부분 일치 (백엔드 QueryDSL contains, 앞뒤 공백 제거). 1~20자 (환자명 컬럼 길이 20) */
  patientName?: string;
  /** 0부터. 음수·누락이면 서버가 0으로 본다 */
  page?: number;
  /** 10·30·50만 허용. 그 외 값은 서버가 10으로 바꾼다 */
  size?: 10 | 30 | 50;
  /** 누락·허용 외 값이면 서버 기본값 createdAt,desc */
  sort?: `${"createdAt" | "updatedAt"},${"asc" | "desc"}`;
}

/**
 * 의뢰 목록 조회 `GET /api/v1/referrals`.
 * Gateway 권한(origin/dev 기준): REQUESTER·ADMIN만 허용, 그 외 역할은 403.
 * Mock 구현이 없으므로 referrals가 API 대상이 아니면 설정 오류이고, 호출 실패는 그대로 ApiError로 던진다.
 * 응답이 백엔드 PagedResponse<ReferralResponse>와 다르면 PARSE 오류로 던진다 (일부 항목만 버리지 않는다).
 */
export async function fetchReferralPage(
  params: ReferralListParams = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ReferralResponseDto>> {
  requireApiFeature("referrals");
  assertListParams(params);
  const data = await apiRequestData<unknown>("/api/v1/referrals", {
    ...options,
    query: { ...params },
  });
  if (!isPage(data, isReferral)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

/** 검사 유형 구분 (institution-service Modality) */
export type ExamTypeModalityDto = "CT" | "MRI";

/**
 * 공통 검사 유형 (institution-service ExamTypeResponse: id·name·modality). 기관과 무관한 전체 목록이다 (삭제된 유형은 오지 않는다).
 * 검사 소요시간은 공통 검사 유형이 아니라 장비별 지원 검사 유형(EquipmentExamType)에 있다 (origin/dev 575a413부터).
 */
export interface ExamTypeDto {
  id: string;
  /** 검사명 (1~50자 자유 입력. 같은 modality에 여러 유형이 있을 수 있다) */
  name: string;
  modality: ExamTypeModalityDto;
}

/** 검사 유형 목록 한 번에 받을 수 있는 최대 크기 (백엔드는 1~100 밖이면 400) */
export const EXAM_TYPE_MAX_PAGE_SIZE = 100;

/**
 * 검사 유형 목록 `GET /api/v1/exam-types?page&size` (institution-service, Gateway·서비스: REQUESTER·EXAMINER·ADMIN).
 * 이름 오름차순·ID 순으로 페이지를 나눠 준다. modality 조건은 쓰지 않는다 (전체를 받아 화면에서 이름을 찾는다).
 * 응답이 PagedResponse<ExamTypeResponse>와 다르면 PARSE 오류로 던진다.
 */
export async function fetchExamTypePage(
  { page = 0, size = EXAM_TYPE_MAX_PAGE_SIZE }: { page?: number; size?: number } = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ExamTypeDto>> {
  // 검사 유형 목록은 의뢰 목록(referrals)·검사기관 장비의 지원 검사 유형 선택(equipment)·검사 목록의 검사 유형명(examinations)이 함께 쓴다
  if (!isApiFeature("referrals") && !isApiFeature("examinations")) requireApiFeature("equipment");
  if (!Number.isSafeInteger(page) || page < 0) throw new ApiError("CONFIG", `페이지 번호가 올바르지 않습니다: ${page}`);
  if (!Number.isSafeInteger(size) || size < 1 || size > EXAM_TYPE_MAX_PAGE_SIZE) {
    throw new ApiError("CONFIG", `페이지 크기는 1~${EXAM_TYPE_MAX_PAGE_SIZE}이어야 합니다: ${size}`);
  }
  const data = await apiRequestData<unknown>("/api/v1/exam-types", { ...options, query: { page, size } });
  if (!isPage(data, isExamType)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

/** 예약 상태 (referral-service ReservationStatus) */
export type ReservationStatusDto = "REQUESTED" | "HELD" | "CONFIRMED" | "FAILED" | "BLOCKED" | "CANCELED";
export const RESERVATION_STATUSES: readonly ReservationStatusDto[] = ["REQUESTED", "HELD", "CONFIRMED", "FAILED", "BLOCKED", "CANCELED"];

/**
 * 예약 (referral-service ReservationResponse). 시각은 시간대 표기 없는 LocalDateTime 문자열(한국 시간)이다.
 * examDate·startTime·endTime은 예약을 만들 때 슬롯 값으로 저장된다 (슬롯 API를 따로 부르지 않는다).
 */
export interface ReservationResponseDto {
  id: string;
  referralId: string;
  attemptNo: number;
  slotId: string | null;
  /** 검사기관 ID (의뢰기관 referringInstitutionId와 다르다) */
  examInstitutionId: string | null;
  equipmentId: string | null;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  reservationStatus: ReservationStatusDto;
  /** 예약 실패 사유 (FAILED·BLOCKED일 때만, 그 밖에는 null) */
  failureReason: FailureReasonDto | null;
  /** 확정 시각 (확정 전 null) */
  confirmedAt: string | null;
  /** 종료 시각 (실패·취소 등으로 끝났을 때, 그 전 null) */
  endedAt: string | null;
}

/** 예약 실패 사유 (referral-service FailureReason) */
export type FailureReasonDto = "SLOT_CONFLICT" | "CONFIRM_FAILED" | "HOLD_EXPIRED" | "EQUIPMENT_FAILURE";
export const FAILURE_REASONS: readonly FailureReasonDto[] = ["SLOT_CONFLICT", "CONFIRM_FAILED", "HOLD_EXPIRED", "EQUIPMENT_FAILURE"];

/**
 * 예약 단건 `GET /api/v1/referrals/reservations/{reservationId}` (Gateway: REQUESTER·EXAMINER·ADMIN).
 * 백엔드는 요청자 기관이 그 예약을 의뢰했거나 검사하는 경우만 돌려준다 (그 밖에는 404 RESERVATION_NOT_FOUND).
 * 일괄 조회 API가 없어 목록 화면은 현재 페이지의 예약 ID만 골라 부른다.
 */
export async function fetchReservation(
  reservationId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ReservationResponseDto> {
  requireReservationApi();
  if (!isUuid(reservationId)) throw new ApiError("CONFIG", `예약 ID 형식이 올바르지 않습니다: "${reservationId}"`);
  const data = await apiRequestData<unknown>(`/api/v1/referrals/reservations/${encodeURIComponent(reservationId)}`, options);
  if (!isReservation(data) || data.id.toLowerCase() !== reservationId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 예약 목록 정렬 (백엔드 ReservationSearchCondition 허용 필드). 그 외 값은 서버가 createdAt,desc로 바꾼다 */
export const RESERVATION_SORTS = [
  "createdAt,desc",
  "createdAt,asc",
  "examDate,desc",
  "examDate,asc",
  "updatedAt,desc",
  "updatedAt,asc",
  "attemptNo,desc",
  "attemptNo,asc",
] as const;
export type ReservationSortDto = (typeof RESERVATION_SORTS)[number];

/**
 * 예약 목록 조회 조건 (백엔드 ReservationSearchCondition).
 * 조회 범위는 서버가 정한다: 관리자는 전체, 그 밖에는 요청자 기관이 의뢰했거나 검사하는 예약만.
 */
export interface ReservationListParams {
  referralId?: string;
  examInstitutionId?: string;
  equipmentId?: string;
  status?: ReservationStatusDto;
  failureReason?: FailureReasonDto;
  /** 검사일 시작 (포함) `YYYY-MM-DDTHH:mm:ss` */
  examDateFrom?: string;
  /** 검사일 끝 (포함) `YYYY-MM-DDTHH:mm:ss` */
  examDateTo?: string;
  /** 0부터 */
  page?: number;
  size?: 10 | 30 | 50;
  sort?: ReservationSortDto;
}

/**
 * 예약 목록 `GET /api/v1/referrals/reservations` (Gateway: REQUESTER·EXAMINER·ADMIN).
 * 계약과 다른 조건은 보내지 않고(CONFIG), 응답이 PagedResponse<ReservationResponse>와 다르면 PARSE 오류로 던진다.
 */
export async function fetchReservationPage(
  params: ReservationListParams = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ReservationResponseDto>> {
  requireReservationApi();
  const { referralId, examInstitutionId, equipmentId, status, failureReason, examDateFrom, examDateTo, page, size, sort } = params;
  for (const [label, id] of [["의뢰 ID", referralId], ["검사기관 ID", examInstitutionId], ["장비 ID", equipmentId]] as const) {
    if (id !== undefined && !isUuid(id)) throw new ApiError("CONFIG", `${label} 형식이 올바르지 않습니다.`);
  }
  if (status !== undefined && !RESERVATION_STATUSES.includes(status)) throw new ApiError("CONFIG", "예약 상태 값이 올바르지 않습니다.");
  if (failureReason !== undefined && !FAILURE_REASONS.includes(failureReason)) throw new ApiError("CONFIG", "실패 사유 값이 올바르지 않습니다.");
  for (const value of [examDateFrom, examDateTo]) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) throw new ApiError("CONFIG", "검사일 조건 형식이 올바르지 않습니다.");
  }
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 0)) throw new ApiError("CONFIG", "페이지 번호가 올바르지 않습니다.");
  if (size !== undefined && !(REFERRAL_PAGE_SIZES as readonly number[]).includes(size)) throw new ApiError("CONFIG", "페이지 크기가 올바르지 않습니다.");
  if (sort !== undefined && !(RESERVATION_SORTS as readonly string[]).includes(sort)) throw new ApiError("CONFIG", "정렬 조건이 올바르지 않습니다.");
  const query = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as Record<string, string | number>;
  const data = await apiRequestData<unknown>("/api/v1/referrals/reservations", { ...options, query });
  if (!isPage(data, isReservation)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

/** 내 기관 협약 (institution-service MyPartnershipResponse 중 화면에 쓰는 필드) */
export interface MyPartnershipDto {
  partnershipId: string;
  /** 협약 상대 기관 ID (의뢰기관 사용자에게는 검사기관) */
  partnerInstitutionId: string;
  partnerInstitutionName: string;
  partnerInstitutionType: string;
  status: string;
}

/**
 * 내 기관 협약 목록 `GET /api/v1/partnerships/me` (Gateway: REQUESTER·EXAMINER, 범위: 요청자 소속 기관).
 * 상태 조건 없이 모두 받는다 (협약이 끝난 검사기관의 예약도 이름을 보여 주기 위해). 페이지 없이 목록 전체가 온다.
 * 검사기관 이름을 조회할 수 있는 다른 API(기관 단건 조회)는 origin/dev에 없다.
 */
/**
 * 의뢰 단건 `GET /api/v1/referrals/{referralId}` (Gateway: REQUESTER·EXAMINER·ADMIN, 서비스: 의뢰기관 소속·ADMIN만, 그 밖은 404).
 * 응답은 목록 항목과 같은 ReferralResponse다.
 */
export async function fetchReferral(referralId: string, options: Pick<ApiRequestOptions, "headers" | "signal"> = {}): Promise<ReferralResponseDto> {
  requireApiFeature("referrals");
  if (!isUuid(referralId)) throw new ApiError("CONFIG", "의뢰 ID 형식이 올바르지 않습니다.");
  const data = await apiRequestData<unknown>(`/api/v1/referrals/${encodeURIComponent(referralId)}`, options);
  if (!isReferral(data) || data.id.toLowerCase() !== referralId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 의뢰 변경 사유 (referral-service Reason) */
export type ReferralHistoryReasonDto =
  | "REFERRAL_CREATED"
  | "RESERVATION_CONFIRMED"
  | "RESERVATION_FAILED"
  | "RESERVATION_BLOCKED"
  | "RESCHEDULED"
  | "CANCELED_BY_REQUESTER";
const HISTORY_REASONS: readonly ReferralHistoryReasonDto[] = [
  "REFERRAL_CREATED",
  "RESERVATION_CONFIRMED",
  "RESERVATION_FAILED",
  "RESERVATION_BLOCKED",
  "RESCHEDULED",
  "CANCELED_BY_REQUESTER",
];

/** 의뢰 변경 이력 1건 (ReferralHistoryResponse 중 화면에 쓰는 필드. eventId·reservationId·changedBy는 쓰지 않는다) */
export interface ReferralHistoryDto {
  id: string;
  referralId: string;
  /** 처음 생성 이력은 null */
  fromStatus: ReferralStatusDto | null;
  toStatus: ReferralStatusDto;
  reason: ReferralHistoryReasonDto;
  occurredAt: string;
}

/** 의뢰 변경 이력 `GET /api/v1/referrals/{referralId}/histories` (Gateway: REQUESTER·ADMIN, 발생 시각 오름차순) */
export async function fetchReferralHistories(
  referralId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ReferralHistoryDto[]> {
  requireApiFeature("referrals");
  if (!isUuid(referralId)) throw new ApiError("CONFIG", "의뢰 ID 형식이 올바르지 않습니다.");
  const data = await apiRequestData<unknown>(`/api/v1/referrals/${encodeURIComponent(referralId)}/histories`, options);
  if (!Array.isArray(data) || !data.every(isReferralHistory)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

/** 장비 단건 (institution-service EquipmentDetailResponse 중 이름만 쓴다) */
export interface EquipmentDetailDto {
  id: string;
  name: string;
}

/**
 * 장비 단건 `GET /api/v1/equipments/{equipmentId}` (Gateway: REQUESTER·EXAMINER, 서비스가 기관별 접근을 다시 확인한다).
 * 의뢰 상세의 검사 장비 이름에만 쓴다.
 */
export async function fetchEquipmentDetail(
  equipmentId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<EquipmentDetailDto> {
  requireApiFeature("referrals");
  if (!isUuid(equipmentId)) throw new ApiError("CONFIG", "장비 ID 형식이 올바르지 않습니다.");
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}`, options);
  if (!isEquipmentDetail(data) || data.id.toLowerCase() !== equipmentId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

export async function fetchMyPartnerships(options: Pick<ApiRequestOptions, "headers" | "signal"> = {}): Promise<MyPartnershipDto[]> {
  requireApiFeature("referrals");
  const data = await apiRequestData<unknown>("/api/v1/partnerships/me", options);
  if (!Array.isArray(data) || !data.every(isMyPartnership)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/**
 * 예약 API(목록·단건)는 의뢰기관 의뢰 화면·관리자 화면(`referrals`)과 검사기관 확정 예약 화면(`reservations`)이 함께 쓴다.
 * 둘 중 하나라도 API 대상이면 호출할 수 있다 (각 화면은 자기 기능 설정을 따로 확인한다).
 */
function requireReservationApi(): void {
  if (isApiFeature("referrals")) return;
  requireApiFeature("reservations");
}

// ── 요청 조건 확인 (계약과 다른 값은 보내지 않는다) ──

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const SORTS = ["createdAt,asc", "createdAt,desc", "updatedAt,asc", "updatedAt,desc"];

/** 환자명 검색어 최대 길이 (백엔드 patient_name 컬럼 길이) */
export const PATIENT_NAME_SEARCH_MAX_LENGTH = 20;

/** 환자명 검색어로 쓸 수 있는지 (앞뒤 공백 제거 후 1~20자, 제어 문자 없음) */
export const isPatientNameSearch = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim() !== "" &&
  value.trim().length <= PATIENT_NAME_SEARCH_MAX_LENGTH &&
  !/[\u0000-\u001f\u007f]/.test(value);

export const isExamTypeId = isUuid;

function assertListParams({ status, referringInstitutionId, referrerId, examTypeId, patientName, page, size, sort }: ReferralListParams) {
  if (status !== undefined && !isReferralStatus(status)) {
    throw new ApiError("CONFIG", `의뢰 상태 값이 올바르지 않습니다: "${status}"`);
  }
  // 검색어(환자명)는 오류 문구에 넣지 않는다
  if (patientName !== undefined && !isPatientNameSearch(patientName)) throw new ApiError("CONFIG", "환자명 검색어가 올바르지 않습니다.");
  for (const [label, id] of [["의뢰기관 ID", referringInstitutionId], ["작성자 ID", referrerId], ["검사 유형 ID", examTypeId]] as const) {
    if (id !== undefined && !isUuid(id)) throw new ApiError("CONFIG", `${label} 형식이 올바르지 않습니다: "${id}"`);
  }
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 0)) {
    throw new ApiError("CONFIG", `페이지 번호가 올바르지 않습니다: ${page}`);
  }
  if (size !== undefined && !(REFERRAL_PAGE_SIZES as readonly number[]).includes(size)) {
    throw new ApiError("CONFIG", `페이지 크기는 ${REFERRAL_PAGE_SIZES.join("·")} 중 하나여야 합니다: ${size}`);
  }
  if (sort !== undefined && !SORTS.includes(sort)) throw new ApiError("CONFIG", `정렬 조건이 올바르지 않습니다: "${sort}"`);
}

// ── 응답 형식 검증 (모르는 형태를 추측해 바꾸지 않는다) ──

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** ReferralResponse 7개 필드. currentReservationId만 null을 허용한다 (예약 전), patientName은 백엔드 @NotBlank */
function isReferral(value: unknown): value is ReferralResponseDto {
  return (
    isRecord(value) &&
    [value.id, value.referringInstitutionId, value.referrerId, value.examTypeId].every(isUuid) &&
    (value.currentReservationId === null || isUuid(value.currentReservationId)) &&
    isReferralStatus(value.referralStatus) &&
    typeof value.patientName === "string" &&
    value.patientName.trim() !== ""
  );
}

/** 시간대 표기 없는 LocalDateTime (`YYYY-MM-DDTHH:mm[:ss[.fraction]]`) */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const isNullableLocalDateTime = (value: unknown) => value === null || (typeof value === "string" && LOCAL_DATE_TIME.test(value));
const isNullableUuid = (value: unknown) => value === null || isUuid(value);

function isReservation(value: unknown): value is ReservationResponseDto {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.referralId) &&
    Number.isSafeInteger(value.attemptNo) &&
    [value.slotId, value.examInstitutionId, value.equipmentId].every(isNullableUuid) &&
    [value.examDate, value.startTime, value.endTime, value.confirmedAt, value.endedAt].every(isNullableLocalDateTime) &&
    RESERVATION_STATUSES.includes(value.reservationStatus as ReservationStatusDto) &&
    (value.failureReason === null || FAILURE_REASONS.includes(value.failureReason as FailureReasonDto))
  );
}

function isReferralHistory(value: unknown): value is ReferralHistoryDto {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.referralId) &&
    (value.fromStatus === null || isReferralStatus(value.fromStatus)) &&
    isReferralStatus(value.toStatus) &&
    HISTORY_REASONS.includes(value.reason as ReferralHistoryReasonDto) &&
    typeof value.occurredAt === "string" &&
    LOCAL_DATE_TIME.test(value.occurredAt)
  );
}

function isEquipmentDetail(value: unknown): value is EquipmentDetailDto {
  return isRecord(value) && isUuid(value.id) && typeof value.name === "string" && value.name.trim() !== "";
}

function isMyPartnership(value: unknown): value is MyPartnershipDto {
  return (
    isRecord(value) &&
    isUuid(value.partnershipId) &&
    isUuid(value.partnerInstitutionId) &&
    typeof value.partnerInstitutionName === "string" &&
    value.partnerInstitutionName.trim() !== "" &&
    typeof value.partnerInstitutionType === "string" &&
    typeof value.status === "string"
  );
}

/**
 * ExamTypeResponse 3개 필드 (name은 백엔드 검증: 공백 아님·50자 이하).
 * 소요시간은 더 이상 공통 검사 유형 응답에 없다. 이전 백엔드가 보내던 durationMinutes 같은 추가 필드는 쓰지 않고 무시한다
 * (배포 순서가 달라도 목록이 깨지지 않게).
 */
function isExamType(value: unknown): value is ExamTypeDto {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    (value.modality === "CT" || value.modality === "MRI")
  );
}

function isPage<T>(value: unknown, isItem: (item: unknown) => item is T): value is PagedResponseDto<T> {
  return (
    isRecord(value) &&
    Array.isArray(value.contents) &&
    value.contents.every(isItem) &&
    [value.totalElements, value.totalPages, value.size, value.number].every(isCount)
  );
}

// ── 오류 안내 ──

/** 안내 문구에 쓰는 목록 이름 (의뢰 목록 화면 / 재조정·알림 화면의 재조정 필요 목록). 둘 다 받침으로 끝나 "은·을"을 쓴다 */
export type ReferralListSubject = "의뢰 목록" | "재조정 필요 목록";

/** 백엔드·Gateway 오류 코드별 안내 (origin/dev 기준) */
const errorMessages = (subject: ReferralListSubject): Record<string, string> => ({
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  INVALID_INPUT: `${subject} 조회 요청이 올바르지 않습니다.`,
  ACCESS_DENIED: `${subject}은 의뢰기관 담당자만 조회할 수 있습니다.`,
});

/**
 * 의뢰 목록 조회 실패 안내 문구.
 * 401(토큰 없음·만료)은 공통 문구(ApiError.message)를 쓰고, 400·403은 오류 코드로 원인을 구분한다.
 * 설정·응답 형식 오류는 내부 내용(응답 본문 등)을 보여 주지 않고 공통 문구를 쓴다.
 */
export function getReferralErrorMessage(error: unknown, subject: ReferralListSubject = "의뢰 목록"): string {
  if (!isApiError(error) || error.kind === "CONFIG" || error.kind === "PARSE") return `${subject}을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.`;
  const messages = errorMessages(subject);
  if (error.kind === "HTTP" && error.status !== 401 && error.code && messages[error.code]) {
    return messages[error.code];
  }
  return error.message;
}

/**
 * 백엔드 의뢰 상태 → 화면 표시 상태.
 * FAILED(예약 실패)는 화면에 대응하는 상태가 없어 null을 돌려준다 (표시 방식은 화면 기획 확인 후 정한다).
 */
export function toReferralDisplayStatus(status: ReferralStatusDto): ReferralDisplayStatus | null {
  switch (status) {
    case "PENDING":
      return "PROCESSING";
    case "CONFIRMED":
      return "CONFIRMED";
    case "NEEDS_RESCHEDULE":
      return "RESCHEDULE_REQUIRED";
    case "CANCELED":
      return "CANCELLED";
    case "FAILED":
      return null;
  }
}
