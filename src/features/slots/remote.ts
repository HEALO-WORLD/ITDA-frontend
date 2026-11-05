import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";

import { compareInstants, parseOffsetDateTime, toSeoulLocalDateTime } from "@/features/referrals/offsetDateTime";

/**
 * 슬롯 실제 API (slot-service, Gateway 경유).
 *
 * 백엔드 SlotController·SlotQueryService·SlotService·SlotSearchRequest·SliceResponse·SlotDetailResponse 기준 (ITDA 백엔드 dev f03bd1a에서 확인).
 * - 단건 GET: 재예약 Server Action(referrals/rescheduleActions.ts)이 서버에서 슬롯을 다시 확인하는 데 쓴다.
 * - 검색 GET(searchSlots): 통신 계층만 있다. 화면(api.ts의 Mock 검색)은 아직 이 함수를 쓰지 않는다.
 * 서버(Server Component·Server Action)에서만 부른다: 호출한 쪽이 서버 세션의 Authorization 헤더를 options.headers로 넘긴다.
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증한다. X-User-Id·X-Institution-Id·X-Role은 만들지 않는다.
 */

/** 백엔드 SlotStatus */
export type SlotStatusDto = "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE";

const SLOT_STATUSES: readonly SlotStatusDto[] = ["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Java OffsetDateTime 직렬화 문자열 (오프셋 필수: `Z` 또는 `±HH:mm`, 초·소수 초는 생략될 수 있다) */
const OFFSET_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 백엔드 SlotDetailResponse (ID는 UUID).
 * startsAt·endsAt은 서버가 Asia/Seoul 기준으로 만든 OffsetDateTime 문자열 원본이다 (예: `2026-11-05T10:00:00+09:00`).
 * 재예약 요청(CreateReservationRequest)은 시간대 없는 LocalDateTime을 쓰지만, 여기서는 변환하지 않는다.
 * 검사기관 ID는 응답에 없다 (재예약 요청에 필요한 examInstitutionId는 다른 경로로 확인해야 한다).
 */
export interface SlotDetailDto {
  id: string;
  equipmentId: string;
  examTypeId: string;
  startsAt: string;
  endsAt: string;
  status: SlotStatusDto;
}

export const isSlotApiId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/**
 * 슬롯 단건 조회 `GET /api/v1/slots/{slotId}`.
 * Gateway 권한: REQUESTER·EXAMINER·ADMIN. 서비스가 조회 가능한 장비(자기 기관·협약 검사기관)의 슬롯인지 확인해 아니면 403 FORBIDDEN.
 * 없는 슬롯은 404 RESOURCE_NOT_FOUND. UUID가 아니면 요청하지 않고 설정 오류,
 * 응답이 계약과 다르거나(필드 누락·모르는 상태·시각 형식) 다른 슬롯이면 PARSE 오류로 던진다.
 */
export async function fetchSlotDetail(
  slotId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<SlotDetailDto> {
  requireApiFeature("slots");
  if (!isSlotApiId(slotId)) {
    throw new ApiError("CONFIG", "슬롯 ID 형식이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/slots/${slotId}`, options);
  if (!isSlotDetail(data) || data.id.toLowerCase() !== slotId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

function isSlotDetail(value: unknown): value is SlotDetailDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    isSlotApiId(data.id) &&
    isSlotApiId(data.equipmentId) &&
    isSlotApiId(data.examTypeId) &&
    isOffsetDateTime(data.startsAt) &&
    isOffsetDateTime(data.endsAt) &&
    SLOT_STATUSES.includes(data.status as SlotStatusDto)
  );
}

/** OffsetDateTime 형식이고 실제 있는 날짜·시각·오프셋인지 (시간대 변환 없이 숫자만 확인) */
function isOffsetDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !OFFSET_DATE_TIME_PATTERN.test(value)) return false;
  const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/).map(Number);
  const second = value.length > 16 && value[16] === ":" ? Number(value.slice(17, 19)) : 0;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
  const offsetOk = !offset || (Number(offset[2]) <= 18 && Number(offset[3]) <= 59 && (Number(offset[2]) < 18 || offset[3] === "00"));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 && offsetOk;
}

/** 슬롯 조회 오류 코드별 안내 (백엔드 ErrorCode·Gateway 코드 기준) */
const SLOT_DETAIL_ERROR_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: "슬롯을 찾을 수 없습니다. 다른 슬롯을 선택해 주세요.",
  INVALID_INPUT: "슬롯 ID가 올바르지 않습니다.",
  ACCESS_DENIED: "슬롯 정보를 조회할 권한이 없습니다.",
};

export function getSlotDetailErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "슬롯 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && SLOT_DETAIL_ERROR_MESSAGES[error.code]) {
    return SLOT_DETAIL_ERROR_MESSAGES[error.code];
  }
  return error.message;
}

// ── 슬롯 검색 GET /api/v1/slots (view=SEARCH) ──

/** 검색 기간 최대 길이 (백엔드 SlotService.validateSearchRequest: Duration > 31일이면 SLOT_SEARCH_RANGE_EXCEEDED) */
export const SLOT_SEARCH_MAX_RANGE_DAYS = 31;
export const SLOT_SEARCH_DEFAULT_PAGE = 0;
export const SLOT_SEARCH_DEFAULT_SIZE = 20;
export const SLOT_SEARCH_MAX_SIZE = 100;
/** 검색 일시는 서울 오프셋을 붙여 보낸다 (예: `2026-11-05T00:00:00+09:00`) */
const SEOUL_OFFSET = "+09:00";

/**
 * 백엔드 SlotSearchRequest 중 의뢰기관 검색 화면이 쓰는 값.
 * view는 항상 SEARCH로 보내고, status는 보내지 않는다 (SEARCH는 서버가 미래 AVAILABLE 슬롯만 돌려준다).
 * 관리 화면용 view=MANAGEMENT·status 필터는 이 함수로 요청하지 않는다.
 */
export interface SlotSearchRequestDto {
  /** 검색 시작 OffsetDateTime (`+09:00` 필수) */
  from: string;
  /** 검색 종료 OffsetDateTime (`+09:00` 필수, from보다 뒤, from부터 최대 31일) */
  to: string;
  examTypeId?: string | null;
  /** 검사기관 ID. 의뢰기관이면 서버가 협약 기관의 장비로 다시 제한한다 */
  institutionId?: string | null;
  equipmentId?: string | null;
  /** 0 이상 정수. 기본 0 */
  page?: number;
  /** 1~100 정수. 기본 20 */
  size?: number;
}

/** 백엔드 SliceResponse (전체 개수 없음: 다음 페이지 여부만 hasNext로 안다) */
export interface SliceResponseDto<T> {
  items: T[];
  page: number;
  size: number;
  hasNext: boolean;
}

/** 백엔드 SlotDetailResponse (검색 항목과 단건 조회가 같은 DTO) */
export type SlotDetailResponseDto = SlotDetailDto;

export type SlotSearchRequestField = "from" | "to" | "range" | "examTypeId" | "institutionId" | "equipmentId" | "page" | "size";

/** Gateway에 보낼 검색 쿼리 (선택 값은 있을 때만 들어간다) */
export interface SlotSearchQuery {
  from: string;
  to: string;
  examTypeId?: string;
  institutionId?: string;
  equipmentId?: string;
  view: "SEARCH";
  page: number;
  size: number;
}

export type SlotSearchValidationResult =
  | { ok: true; query: SlotSearchQuery }
  | { ok: false; field: SlotSearchRequestField; message: string };

const SEARCH_ID_LABELS = { examTypeId: "검사 유형", institutionId: "검사기관", equipmentId: "장비" } as const;

/**
 * 검색 요청 값 확인 (요청 전에 백엔드 검증 규칙을 그대로 적용한다).
 * 잘못된 값은 고치거나 버리지 않고 실패로 돌려준다 (빈 문자열 ID도 실패: 조용히 필터를 빼지 않는다).
 */
export function validateSlotSearchRequest(input: SlotSearchRequestDto): SlotSearchValidationResult {
  if (typeof input !== "object" || input === null) return { ok: false, field: "from", message: "검색 조건이 없습니다." };
  if (!isSeoulOffsetDateTime(input.from)) {
    return { ok: false, field: "from", message: "검색 시작 일시 형식이 올바르지 않습니다. (예: 2026-11-05T00:00:00+09:00)" };
  }
  if (!isSeoulOffsetDateTime(input.to)) {
    return { ok: false, field: "to", message: "검색 종료 일시 형식이 올바르지 않습니다. (예: 2026-11-06T00:00:00+09:00)" };
  }
  const from = parseOffsetDateTime(input.from);
  const to = parseOffsetDateTime(input.to);
  if (from === null) return { ok: false, field: "from", message: "검색 시작 일시 형식이 올바르지 않습니다." };
  if (to === null) return { ok: false, field: "to", message: "검색 종료 일시 형식이 올바르지 않습니다." };
  if (!(compareInstants(from, to) < 0)) {
    return { ok: false, field: "range", message: "검색 종료 일시는 시작 일시보다 이후여야 합니다." };
  }
  const maxEnd = { epochSecond: from.epochSecond + SLOT_SEARCH_MAX_RANGE_DAYS * 24 * 60 * 60, nano: from.nano };
  if (compareInstants(to, maxEnd) > 0) {
    return { ok: false, field: "range", message: `검색 기간은 최대 ${SLOT_SEARCH_MAX_RANGE_DAYS}일입니다.` };
  }

  const query: SlotSearchQuery = {
    from: input.from,
    to: input.to,
    view: "SEARCH",
    page: SLOT_SEARCH_DEFAULT_PAGE,
    size: SLOT_SEARCH_DEFAULT_SIZE,
  };
  for (const field of ["examTypeId", "institutionId", "equipmentId"] as const) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!isSlotApiId(value)) return { ok: false, field, message: `${SEARCH_ID_LABELS[field]} ID 형식이 올바르지 않습니다.` };
    query[field] = value;
  }
  if (input.page !== undefined) {
    if (!Number.isSafeInteger(input.page) || input.page < 0) {
      return { ok: false, field: "page", message: "페이지 번호는 0 이상의 정수여야 합니다." };
    }
    query.page = input.page;
  }
  if (input.size !== undefined) {
    if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > SLOT_SEARCH_MAX_SIZE) {
      return { ok: false, field: "size", message: `페이지 크기는 1~${SLOT_SEARCH_MAX_SIZE} 사이의 정수여야 합니다.` };
    }
    query.size = input.size;
  }
  return { ok: true, query };
}

/**
 * 슬롯 검색 `GET /api/v1/slots?view=SEARCH&...` → `ApiResponse<SliceResponse<SlotDetailResponse>>`.
 * Gateway 권한: REQUESTER·EXAMINER·ADMIN. 서비스가 조회 가능한 장비(협약 검사기관 등)로 결과를 제한한다.
 *
 * - API 모드·slots 기능이 아니면 요청하지 않고 CONFIG 오류 (Mock 검색으로 대신하지 않는다)
 * - 요청 값이 잘못되면 요청하지 않고 CONFIG 오류 (메시지는 validateSlotSearchRequest와 같다)
 * - 응답이 계약과 다르면 PARSE 오류. 빈 배열로 바꾸지 않는다:
 *   items 항목 형식, page·size가 요청과 같은지, items 개수 ≤ size, hasNext가 boolean인지,
 *   SEARCH 결과가 모두 AVAILABLE인지, 장비·검사 유형 필터와 맞는지 확인한다
 * - 다음 페이지는 hasNext로만 판단한다 (전체 개수는 응답에 없다)
 */
export async function searchSlots(
  input: SlotSearchRequestDto,
  options: Pick<ApiRequestOptions, "headers" | "signal" | "timeoutMs"> = {},
): Promise<SliceResponseDto<SlotDetailResponseDto>> {
  requireApiFeature("slots");
  const validation = validateSlotSearchRequest(input);
  if (!validation.ok) throw new ApiError("CONFIG", validation.message);
  return requestSlotSlice({ ...validation.query }, "AVAILABLE", options);
}

/** 슬롯 목록 GET 공통: 응답 형식·페이지·장비·검사 유형·상태 조건이 요청과 맞는지 확인한다 (status null = 모든 상태 허용) */
async function requestSlotSlice(
  query: Omit<SlotSearchQuery, "view"> & { view: "SEARCH" | "MANAGEMENT"; status?: SlotStatusDto },
  requiredStatus: SlotStatusDto | null,
  options: Pick<ApiRequestOptions, "headers" | "signal" | "timeoutMs">,
): Promise<SliceResponseDto<SlotDetailResponseDto>> {
  const data = await apiRequestData<unknown>("/api/v1/slots", { ...options, method: "GET", query: { ...query } });
  if (!isSlotSlice(data) || data.page !== query.page || data.size !== query.size || data.items.length > query.size) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  const matchesQuery = (slot: SlotDetailDto) =>
    (requiredStatus === null || slot.status === requiredStatus) &&
    (query.equipmentId === undefined || slot.equipmentId.toLowerCase() === query.equipmentId.toLowerCase()) &&
    (query.examTypeId === undefined || slot.examTypeId.toLowerCase() === query.examTypeId.toLowerCase());
  if (!data.items.every(matchesQuery)) {
    throw new ApiError("PARSE", "서버 응답이 검색 조건과 맞지 않습니다.", { body: data });
  }
  return { items: data.items, page: data.page, size: data.size, hasNext: data.hasNext };
}

/**
 * 관리 조회 `GET /api/v1/slots?view=MANAGEMENT&...` (검사기관·관리자용, 지난 슬롯·모든 상태 포함).
 * Gateway 권한: REQUESTER·EXAMINER·ADMIN이지만 서비스가 REQUESTER의 MANAGEMENT를 403으로 막고, EXAMINER는 자기 기관 장비만 돌려준다.
 * 기간·ID·페이지 검증은 검색(searchSlots)과 같다 (31일 이하, `+09:00`). status를 주면 그 상태만 온다.
 * 서버(Server Function)에서만 부른다.
 */
export async function searchManagementSlots(
  input: SlotSearchRequestDto & { status?: SlotStatusDto },
  options: Pick<ApiRequestOptions, "headers" | "signal" | "timeoutMs"> = {},
): Promise<SliceResponseDto<SlotDetailResponseDto>> {
  requireApiFeature("slots");
  const validation = validateSlotSearchRequest(input);
  if (!validation.ok) throw new ApiError("CONFIG", validation.message);
  if (input.status !== undefined && !SLOT_STATUSES.includes(input.status)) throw new ApiError("CONFIG", "슬롯 상태가 올바르지 않습니다.");
  const query = { ...validation.query, view: "MANAGEMENT" as const, ...(input.status ? { status: input.status } : {}) };
  return requestSlotSlice(query, input.status ?? null, options);
}

function isSlotSlice(value: unknown): value is SliceResponseDto<SlotDetailDto> {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.items) &&
    data.items.every(isSlotDetail) &&
    Number.isSafeInteger(data.page) &&
    Number.isSafeInteger(data.size) &&
    typeof data.hasNext === "boolean"
  );
}

/** 검색 일시: OffsetDateTime 형식이고 오프셋이 `+09:00`인지 */
function isSeoulOffsetDateTime(value: unknown): value is string {
  return isOffsetDateTime(value) && value.endsWith(SEOUL_OFFSET);
}

export type SlotSearchFailureReason =
  /** 요청하지 않음: Mock 모드·slots 기능 꺼짐·요청 값 오류 */
  | "NOT_SENT"
  /** 400: 검색 기간·형식·상태 오류 (SLOT_INVALID_SEARCH_RANGE·SLOT_SEARCH_RANGE_EXCEEDED·INVALID_INPUT 등) */
  | "INVALID_REQUEST"
  /** 401: 로그인 필요 */
  | "UNAUTHORIZED"
  /** 403: 역할·기관 권한 없음 */
  | "FORBIDDEN"
  /** 409: 기관·협약 기준정보 준비 안 됨 (REFERENCE_DATA_NOT_READY) */
  | "CONFLICT"
  /** 5xx: 서버·기준정보 서비스 오류 */
  | "SERVER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  /** 호출한 쪽이 취소함 (화면 이동 등). 보통 안내하지 않는다 */
  | "ABORTED"
  /** 응답 형식·검색 조건 불일치 */
  | "INVALID_RESPONSE"
  /** 그 밖의 HTTP 상태·알 수 없는 오류 */
  | "ERROR";

export function getSlotSearchFailureReason(error: unknown): SlotSearchFailureReason {
  if (!isApiError(error)) return "ERROR";
  switch (error.kind) {
    case "CONFIG":
      return "NOT_SENT";
    case "NETWORK":
      return "NETWORK";
    case "TIMEOUT":
      return "TIMEOUT";
    case "ABORTED":
      return "ABORTED";
    case "PARSE":
      return "INVALID_RESPONSE";
    case "HTTP": {
      const status = error.status ?? 0;
      if (status === 400) return "INVALID_REQUEST";
      if (status === 401) return "UNAUTHORIZED";
      if (status === 403) return "FORBIDDEN";
      if (status === 409) return "CONFLICT";
      if (status >= 500) return "SERVER_ERROR";
      return "ERROR";
    }
  }
}

/** 슬롯 검색 오류 코드별 안내 (백엔드 slot-service ErrorCode·Gateway 코드 기준). 서버 원문 메시지는 쓰지 않는다 */
const SLOT_SEARCH_ERROR_MESSAGES: Record<string, string> = {
  SLOT_INVALID_SEARCH_RANGE: "검색 종료 일시는 시작 일시보다 이후여야 합니다.",
  SLOT_SEARCH_RANGE_EXCEEDED: `검색 기간은 최대 ${SLOT_SEARCH_MAX_RANGE_DAYS}일입니다.`,
  SLOT_INVALID_SEARCH_STATUS: "검색에서는 예약 가능한 슬롯만 조회할 수 있습니다.",
  VALIDATION_FAILED: "검색 조건을 확인해 주세요.",
  INVALID_INPUT: "검색 조건 형식이 올바르지 않습니다.",
  FORBIDDEN: "슬롯을 검색할 권한이 없습니다.",
  ACCESS_DENIED: "슬롯을 검색할 권한이 없습니다.",
  REFERENCE_DATA_NOT_READY: "기관·협약 정보가 준비되지 않아 검색할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  REFERENCE_SERVICE_UNAVAILABLE: "기준정보 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

export function getSlotSearchErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "슬롯을 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && SLOT_SEARCH_ERROR_MESSAGES[error.code]) {
    return SLOT_SEARCH_ERROR_MESSAGES[error.code];
  }
  return error.message;
}

// ── 슬롯 일괄 생성 POST /api/v1/slots/generate ──

/**
 * 백엔드 SlotGenerateRequest (ITDA 백엔드 dev d243245 SlotController·SlotService.generateSlots 기준).
 * 하루치만 만든다: 서버가 그날 요일의 장비 운영시간을 장비·검사 유형 소요시간으로 나누고, 이미 지난 시각은 뺀다.
 * 기간·사용자 지정 시간·휴게 시간은 요청에 없다.
 */
export interface SlotGenerateRequestDto {
  equipmentId: string;
  examTypeId: string;
  /** 서울 날짜 `YYYY-MM-DD` (LocalDate) */
  date: string;
}

/** 백엔드 SlotCreateResponse (startsAt·endsAt은 서버가 Asia/Seoul로 만든 OffsetDateTime) */
export interface SlotCreateResponseDto {
  id: string;
  equipmentId: string;
  examTypeId: string;
  startsAt: string;
  endsAt: string;
  status: SlotStatusDto;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 실제 있는 날짜인지 (`YYYY-MM-DD`, 시간대 변환 없이) */
export function isSlotDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type SlotGenerateField = "equipmentId" | "examTypeId" | "date";

/** 생성 요청 값 확인 (요청 전). 잘못된 값은 고치지 않고 실패로 돌려준다 */
export function validateSlotGenerateRequest(input: unknown): { ok: true; body: SlotGenerateRequestDto } | { ok: false; field: SlotGenerateField; message: string } {
  const data = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (!isSlotApiId(data.equipmentId)) return { ok: false, field: "equipmentId", message: "장비를 선택해 주세요." };
  if (!isSlotApiId(data.examTypeId)) return { ok: false, field: "examTypeId", message: "검사 유형을 선택해 주세요." };
  if (!isSlotDateKey(data.date)) return { ok: false, field: "date", message: "생성 날짜를 선택해 주세요." };
  return { ok: true, body: { equipmentId: data.equipmentId, examTypeId: data.examTypeId, date: data.date } };
}

/** OffsetDateTime → 서울 `YYYY-MM-DDTHH:mm` (변환할 수 없으면 null) */
function toSeoulMinuteOf(value: string): string | null {
  const parsed = parseOffsetDateTime(value);
  const local = parsed && toSeoulLocalDateTime(parsed);
  return local ? local.slice(0, 16) : null;
}

/**
 * 생성 응답 확인: 배열이고, 항목마다 형식·요청한 장비·검사 유형·서울 날짜가 같고, 시작 < 종료, 상태 AVAILABLE, 슬롯 ID가 겹치지 않아야 한다.
 * 백엔드는 만들 슬롯이 없으면 400(SLOT_GENERATION_EMPTY)을 주므로 201에 빈 배열이 오면 계약 위반으로 본다.
 */
export function isSlotGenerateResponse(data: unknown, request: SlotGenerateRequestDto): data is SlotCreateResponseDto[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const ids = new Set<string>();
  for (const item of data) {
    if (!isSlotDetail(item) || item.status !== "AVAILABLE") return false;
    if (item.equipmentId.toLowerCase() !== request.equipmentId.toLowerCase()) return false;
    if (item.examTypeId.toLowerCase() !== request.examTypeId.toLowerCase()) return false;
    const start = toSeoulMinuteOf(item.startsAt);
    const end = toSeoulMinuteOf(item.endsAt);
    if (!start || !end || start.slice(0, 10) !== request.date || end.slice(0, 10) !== request.date || !(start < end)) return false;
    const id = item.id.toLowerCase();
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

/**
 * 슬롯 일괄 생성 `POST /api/v1/slots/generate` → `ApiResponse<List<SlotCreateResponse>>` (201).
 * Gateway 권한: EXAMINER·ADMIN. 서비스가 장비 기관과 요청자 기관을 비교해 다른 기관 장비면 403.
 * - slots 기능이 API 대상이 아니면 요청하지 않고 CONFIG 오류 (Mock 생성으로 대신하지 않는다)
 * - 요청 값이 잘못되면 요청하지 않고 CONFIG 오류
 * - 응답이 계약과 다르면 PARSE 오류 (일부만 성공으로 보지 않는다)
 * 서버에서만 부른다 (호출한 쪽이 서버 세션의 Authorization 헤더를 options.headers로 넘긴다).
 */
export async function generateSlots(
  input: SlotGenerateRequestDto,
  options: Pick<ApiRequestOptions, "headers" | "signal" | "timeoutMs"> = {},
): Promise<SlotCreateResponseDto[]> {
  requireApiFeature("slots");
  const validation = validateSlotGenerateRequest(input);
  if (!validation.ok) throw new ApiError("CONFIG", validation.message);
  const data = await apiRequestData<unknown>("/api/v1/slots/generate", { ...options, method: "POST", body: validation.body });
  if (!isSlotGenerateResponse(data, validation.body)) {
    throw new ApiError("PARSE", "슬롯 생성 결과를 확인할 수 없습니다. 장비 슬롯 현황을 다시 확인해 주세요.", { body: data });
  }
  return data;
}

/** 슬롯 생성 실패 구분 */
export type SlotGenerateFailureReason =
  | "INVALID"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "ERROR";

/** 생성 오류 코드별 안내 (백엔드 slot-service ErrorCode·Gateway 코드 기준). 서버 원문 메시지는 쓰지 않는다 */
const SLOT_GENERATE_ERROR_MESSAGES: Record<string, string> = {
  SLOT_START_NOT_FUTURE: "지난 날짜에는 슬롯을 만들 수 없습니다. 오늘 이후 날짜를 선택해 주세요.",
  SLOT_GENERATION_EMPTY: "선택한 날짜에 만들 수 있는 미래 슬롯이 없습니다. 오늘의 운영시간이 이미 지났을 수 있습니다.",
  SLOT_TIME_OVERLAP: "이 장비에 시간이 겹치는 슬롯이 이미 있습니다. 그날 슬롯이 이미 만들어졌는지 확인해 주세요.",
  SLOT_INVALID_TIME_RANGE: "장비 운영시간이 올바르지 않습니다. 운영 시간을 확인해 주세요.",
  REFERENCE_NOT_AVAILABLE: "선택한 날짜에 장비 운영시간이 없거나, 장비 또는 검사 소요 시간을 사용할 수 없습니다. 운영 요일·장비 상태·소요 시간을 확인해 주세요.",
  RESOURCE_NOT_FOUND: "장비 또는 이 장비에 연결된 검사 유형을 찾을 수 없습니다. 목록을 다시 불러와 주세요.",
  INVALID_INPUT: "장비와 검사 유형이 맞지 않거나 요청 값이 올바르지 않습니다.",
  VALIDATION_FAILED: "요청 값이 올바르지 않습니다. 장비·검사 유형·날짜를 확인해 주세요.",
  FORBIDDEN: "우리 기관 장비에만 슬롯을 만들 수 있습니다.",
  ACCESS_DENIED: "슬롯을 만들 권한이 없습니다. 검사기관 계정으로 로그인했는지 확인해 주세요.",
  REFERENCE_SERVICE_UNAVAILABLE: "기준정보 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  REFERENCE_RESPONSE_INVALID: "기준정보 서비스 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

export function getSlotGenerateFailure(error: unknown): { reason: SlotGenerateFailureReason; message: string; code: string | null } {
  const fallback = "슬롯을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (!isApiError(error)) return { reason: "ERROR", message: fallback, code: null };
  const code = error.code ?? null;
  switch (error.kind) {
    case "NETWORK":
      return { reason: "NETWORK", message: "서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 슬롯 현황을 먼저 확인해 주세요.", code };
    case "TIMEOUT":
      return { reason: "TIMEOUT", message: "응답이 지연되었습니다. 슬롯이 만들어졌을 수 있으니 다시 요청하기 전에 슬롯 현황을 확인해 주세요.", code };
    case "PARSE":
      return { reason: "INVALID_RESPONSE", message: error.message, code };
    case "CONFIG":
      return { reason: "INVALID", message: error.message, code };
    case "ABORTED":
      return { reason: "ERROR", message: fallback, code };
    case "HTTP": {
      const status = error.status ?? 0;
      const known = code ? SLOT_GENERATE_ERROR_MESSAGES[code] : undefined;
      if (status === 401) return { reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.", code };
      if (status === 400) return { reason: "INVALID", message: known ?? "요청 값이 올바르지 않습니다.", code };
      if (status === 403) return { reason: "FORBIDDEN", message: known ?? SLOT_GENERATE_ERROR_MESSAGES.FORBIDDEN, code };
      if (status === 404) return { reason: "NOT_FOUND", message: known ?? SLOT_GENERATE_ERROR_MESSAGES.RESOURCE_NOT_FOUND, code };
      if (status === 409) return { reason: "CONFLICT", message: known ?? SLOT_GENERATE_ERROR_MESSAGES.SLOT_TIME_OVERLAP, code };
      if (status >= 500) return { reason: "SERVER_ERROR", message: known ?? "서버 오류로 슬롯을 만들지 못했습니다. 슬롯 현황을 확인한 뒤 다시 시도해 주세요.", code };
      return { reason: "ERROR", message: known ?? fallback, code };
    }
  }
}
