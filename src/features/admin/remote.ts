import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { getApiMode } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";

/**
 * 관리자 실제 API (institution-service, Gateway 경유).
 *
 * 백엔드 UserController·InstitutionController와 DTO(UserSummaryResponse·InstitutionResponse·InstitutionCreateRequest·
 * InstitutionUpdateRequest)를 기준으로 옮겼다 (ITDA 저장소 origin/dev c38ed96 기준 확인).
 * Gateway 권한: 아래 API는 모두 ADMIN 그룹 규칙에만 있다 (그 밖의 역할은 403 ACCESS_DENIED).
 * - GET /api/v1/users(?active), PATCH /api/v1/users/{userId}/approve
 * - GET·POST /api/v1/institutions, PATCH·DELETE /api/v1/institutions/{institutionId}
 * 목록 API는 페이지 없이 전체 목록을 준다 (검색 조건 없음: 화면에서 받은 목록 안에서만 거른다).
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-User-Id·X-Role을 붙인다. 프론트는 X- 헤더를 만들지 않는다.
 * 토큰은 서버 전용 모듈(server.ts·actions.ts)이 관리자 역할 확인(requireRoleAccess("ADMIN")) 뒤 `headers`로 넘긴다.
 * Mock 구현으로 대신하지 않는다: API 모드가 아니거나 입력이 계약과 다르면 요청 없이 CONFIG, 응답이 계약과 다르면 PARSE.
 */

type RequestOptions = Pick<ApiRequestOptions, "headers" | "signal">;

/** 사용자 역할 (institution-service Role) */
export type AdminUserRoleDto = "REQUESTER" | "EXAMINER" | "ADMIN";
const USER_ROLES: readonly AdminUserRoleDto[] = ["REQUESTER", "EXAMINER", "ADMIN"];

/** 사용자 목록 항목 (UserSummaryResponse). createdAt은 시간대 표기 없는 LocalDateTime(한국 시간) */
export interface AdminUserDto {
  userId: string;
  loginId: string;
  role: AdminUserRoleDto;
  /** 가입 승인 여부 (false: 승인 대기) */
  active: boolean;
  institutionId: string;
  institutionName: string;
  createdAt: string | null;
}

/** 기관 유형 (InstitutionType). PLATFORM(운영사)은 관리자 API로 등록할 수 없다 */
export type InstitutionTypeDto = "REQUESTER" | "EXAM" | "PLATFORM";
export const INSTITUTION_TYPES: readonly InstitutionTypeDto[] = ["REQUESTER", "EXAM", "PLATFORM"];
/** 관리자가 등록할 수 있는 기관 유형 (InstitutionType.isMedical) */
export const REGISTRABLE_INSTITUTION_TYPES = ["REQUESTER", "EXAM"] as const;
export type RegistrableInstitutionType = (typeof REGISTRABLE_INSTITUTION_TYPES)[number];

/** 기관 (InstitutionResponse). 운영사는 요양기관기호가 없다 */
export interface InstitutionDto {
  id: string;
  name: string;
  type: InstitutionTypeDto;
  address: string | null;
  careInstitutionCode: string | null;
  active: boolean;
  createdAt: string | null;
}

/** 기관 등록 요청 (InstitutionCreateRequest: 이름 1~100자, 주소 1~255자, 요양기관기호 숫자 8자리) */
export interface InstitutionCreateInput {
  name: string;
  type: RegistrableInstitutionType;
  address: string;
  careInstitutionCode: string;
}

/** 기관 수정 요청 (InstitutionUpdateRequest: 이름·주소만. 유형·요양기관기호·활성 상태는 바꿀 수 없다) */
export interface InstitutionUpdateInput {
  name: string;
  address: string;
}

export const INSTITUTION_NAME_MAX_LENGTH = 100;
export const INSTITUTION_ADDRESS_MAX_LENGTH = 255;
export const CARE_INSTITUTION_CODE_PATTERN = /^\d{8}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isAdminEntityId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/** 사용자 목록 `GET /api/v1/users` (active: true 승인 완료, false 승인 대기, 없으면 전체). 최근 가입순 */
export async function fetchAdminUsers(active: boolean | undefined, options: RequestOptions = {}): Promise<AdminUserDto[]> {
  requireApiMode();
  const data = await apiRequestData<unknown>("/api/v1/users", { ...options, query: { active } });
  if (!Array.isArray(data) || !data.every(isAdminUser)) throw parseError(data);
  return data;
}

/** 가입 승인 `PATCH /api/v1/users/{userId}/approve`. 이미 승인된 사용자는 409 USER_ALREADY_APPROVED */
export async function approveUser(userId: string, options: RequestOptions = {}): Promise<AdminUserDto> {
  requireApiMode();
  assertId(userId, "사용자 ID");
  const data = await apiRequestData<unknown>(`/api/v1/users/${encodeURIComponent(userId)}/approve`, { ...options, method: "PATCH" });
  if (!isAdminUser(data) || data.userId.toLowerCase() !== userId.toLowerCase() || !data.active) throw parseError(data);
  return data;
}

/** 기관 목록 `GET /api/v1/institutions` (삭제되지 않은 기관 전체, 최근 등록순) */
export async function fetchInstitutions(options: RequestOptions = {}): Promise<InstitutionDto[]> {
  requireApiMode();
  const data = await apiRequestData<unknown>("/api/v1/institutions", options);
  if (!Array.isArray(data) || !data.every(isInstitution)) throw parseError(data);
  return data;
}

/** 슬롯 상태 (slot-service SlotStatus) */
export type SlotStatusDto = "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE";
const SLOT_STATUSES: readonly SlotStatusDto[] = ["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE"];

/** 슬롯 상태 변경 사유 (slot-service SlotStatusChangeReason, origin/dev 898b449 기준 8개) */
export type SlotStatusChangeReasonDto =
  | "HOLD"
  | "BOOK"
  | "HOLD_EXPIRED"
  | "RELEASE_HOLD"
  | "RELEASE_SLOT"
  | "ADMIN_RELEASE"
  | "DOWNTIME_STARTED"
  | "DOWNTIME_ENDED";
const SLOT_CHANGE_REASONS: readonly SlotStatusChangeReasonDto[] = [
  "HOLD",
  "BOOK",
  "HOLD_EXPIRED",
  "RELEASE_HOLD",
  "RELEASE_SLOT",
  "ADMIN_RELEASE",
  "DOWNTIME_STARTED",
  "DOWNTIME_ENDED",
];

/** 슬롯 상태 이력 1건 (slot-service SlotStatusHistoryResponse) */
export interface SlotStatusHistoryDto {
  id: string;
  slotId: string;
  /** 예약과 무관한 변경이면 null */
  reservationId: string | null;
  fromStatus: SlotStatusDto | null;
  toStatus: SlotStatusDto;
  reason: SlotStatusChangeReasonDto;
  /** Kafka 이벤트로 바뀐 경우만 (API·스케줄러면 null) */
  sourceEventId: string | null;
  changedAt: string;
  /** 관리자 API로 바뀐 경우만 (이벤트·스케줄러면 null) */
  changedBy: string | null;
}

export interface SlotStatusHistoryPageDto {
  contents: SlotStatusHistoryDto[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

/** 슬롯 상태 이력 페이지 크기 (백엔드 허용 1~100, 기본 20) */
export const SLOT_HISTORY_PAGE_SIZE = 20;

/**
 * 슬롯 상태 이력 `GET /api/v1/slots/{slotId}/status-histories?page&size` (Gateway·서비스: ADMIN만, 변경 일시 오름차순).
 * 없는 슬롯은 404 SLOT_NOT_FOUND. 전체 슬롯 목록 API는 백엔드에 없다 (슬롯 ID로만 조회한다).
 */
export async function fetchSlotStatusHistories(
  slotId: string,
  { page = 0, size = SLOT_HISTORY_PAGE_SIZE }: { page?: number; size?: number } = {},
  options: RequestOptions = {},
): Promise<SlotStatusHistoryPageDto> {
  requireApiMode();
  if (!isAdminEntityId(slotId)) throw new ApiError("CONFIG", "슬롯 ID 형식이 올바르지 않습니다.");
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw new ApiError("CONFIG", "페이지 조건이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/slots/${encodeURIComponent(slotId)}/status-histories`, { ...options, query: { page, size } });
  if (
    !isRecord(data) ||
    !Array.isArray(data.contents) ||
    !data.contents.every((item) => isSlotHistory(item) && item.slotId.toLowerCase() === slotId.toLowerCase()) ||
    ![data.totalElements, data.totalPages, data.size, data.number].every((n) => Number.isSafeInteger(n) && (n as number) >= 0)
  ) {
    throw parseError(data);
  }
  return data as unknown as SlotStatusHistoryPageDto;
}

/** 기관 등록 `POST /api/v1/institutions` (201). 요양기관기호 중복은 409 DUPLICATE_CARE_INSTITUTION_CODE */
export async function createInstitution(input: InstitutionCreateInput, options: RequestOptions = {}): Promise<InstitutionDto> {
  requireApiMode();
  assertCreateInput(input);
  const body = { name: input.name.trim(), type: input.type, address: input.address.trim(), careInstitutionCode: input.careInstitutionCode };
  const data = await apiRequestData<unknown>("/api/v1/institutions", { ...options, method: "POST", body });
  if (!isInstitution(data)) throw parseError(data);
  return data;
}

/** 기관 수정 `PATCH /api/v1/institutions/{institutionId}` (이름·주소만) */
export async function updateInstitution(
  institutionId: string,
  input: InstitutionUpdateInput,
  options: RequestOptions = {},
): Promise<InstitutionDto> {
  requireApiMode();
  assertId(institutionId, "기관 ID");
  assertNameAddress(input.name, input.address);
  const data = await apiRequestData<unknown>(`/api/v1/institutions/${encodeURIComponent(institutionId)}`, {
    ...options,
    method: "PATCH",
    body: { name: input.name.trim(), address: input.address.trim() },
  });
  if (!isInstitution(data) || data.id.toLowerCase() !== institutionId.toLowerCase()) throw parseError(data);
  return data;
}

/** 기관 삭제 `DELETE /api/v1/institutions/{institutionId}`. 진행 중 협약·소속 사용자가 있으면 409 */
export async function deleteInstitution(institutionId: string, options: RequestOptions = {}): Promise<void> {
  requireApiMode();
  assertId(institutionId, "기관 ID");
  const data = await apiRequestData<unknown>(`/api/v1/institutions/${encodeURIComponent(institutionId)}`, { ...options, method: "DELETE" });
  if (data !== null && data !== undefined) throw parseError(data);
}

// ── 입력 확인 (계약과 다른 값은 보내지 않는다) ──

function requireApiMode() {
  if (getApiMode() !== "api") throw new ApiError("CONFIG", "관리자 기능은 API 모드에서만 사용할 수 있습니다.");
}

function assertId(value: string, label: string) {
  if (!isAdminEntityId(value)) throw new ApiError("CONFIG", `${label} 형식이 올바르지 않습니다.`);
}

/** 등록·수정 입력 검사 (백엔드 검증과 같은 규칙). 통과하면 null, 아니면 첫 오류 문구 */
export function validateInstitutionName(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return "기관명을 입력해 주세요.";
  if (name.trim().length > INSTITUTION_NAME_MAX_LENGTH) return `기관명은 ${INSTITUTION_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
  return null;
}
export function validateInstitutionAddress(address: unknown): string | null {
  if (typeof address !== "string" || address.trim() === "") return "주소를 입력해 주세요.";
  if (address.trim().length > INSTITUTION_ADDRESS_MAX_LENGTH) return `주소는 ${INSTITUTION_ADDRESS_MAX_LENGTH}자 이하로 입력해 주세요.`;
  return null;
}
export function validateCareInstitutionCode(code: unknown): string | null {
  if (typeof code !== "string" || code === "") return "요양기관기호를 입력해 주세요.";
  if (!CARE_INSTITUTION_CODE_PATTERN.test(code)) return "요양기관기호는 숫자 8자리입니다.";
  return null;
}
export const isRegistrableInstitutionType = (value: unknown): value is RegistrableInstitutionType =>
  (REGISTRABLE_INSTITUTION_TYPES as readonly unknown[]).includes(value);

function assertNameAddress(name: unknown, address: unknown) {
  const error = validateInstitutionName(name) ?? validateInstitutionAddress(address);
  if (error) throw new ApiError("CONFIG", error);
}

function assertCreateInput(input: InstitutionCreateInput) {
  assertNameAddress(input.name, input.address);
  if (!isRegistrableInstitutionType(input.type)) throw new ApiError("CONFIG", "등록할 수 없는 기관 유형입니다.");
  const codeError = validateCareInstitutionCode(input.careInstitutionCode);
  if (codeError) throw new ApiError("CONFIG", codeError);
}

// ── 응답 형식 검증 (모르는 형태를 추측해 바꾸지 않는다) ──

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const isNullableTime = (value: unknown) => value === null || (typeof value === "string" && LOCAL_DATE_TIME.test(value));
const parseError = (body: unknown) => new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body });

function isAdminUser(value: unknown): value is AdminUserDto {
  return (
    isRecord(value) &&
    isAdminEntityId(value.userId) &&
    typeof value.loginId === "string" &&
    value.loginId !== "" &&
    USER_ROLES.includes(value.role as AdminUserRoleDto) &&
    typeof value.active === "boolean" &&
    isAdminEntityId(value.institutionId) &&
    typeof value.institutionName === "string" &&
    isNullableTime(value.createdAt)
  );
}

function isInstitution(value: unknown): value is InstitutionDto {
  return (
    isRecord(value) &&
    isAdminEntityId(value.id) &&
    typeof value.name === "string" &&
    value.name !== "" &&
    INSTITUTION_TYPES.includes(value.type as InstitutionTypeDto) &&
    (value.address === null || typeof value.address === "string") &&
    (value.careInstitutionCode === null || typeof value.careInstitutionCode === "string") &&
    typeof value.active === "boolean" &&
    isNullableTime(value.createdAt)
  );
}

function isSlotHistory(value: unknown): value is SlotStatusHistoryDto {
  const isNullableId = (id: unknown) => id === null || isAdminEntityId(id);
  return (
    isRecord(value) &&
    isAdminEntityId(value.id) &&
    isAdminEntityId(value.slotId) &&
    [value.reservationId, value.sourceEventId, value.changedBy].every(isNullableId) &&
    (value.fromStatus === null || SLOT_STATUSES.includes(value.fromStatus as SlotStatusDto)) &&
    SLOT_STATUSES.includes(value.toStatus as SlotStatusDto) &&
    SLOT_CHANGE_REASONS.includes(value.reason as SlotStatusChangeReasonDto) &&
    typeof value.changedAt === "string" &&
    LOCAL_DATE_TIME.test(value.changedAt)
  );
}

// ── 오류 안내 ──

/** 백엔드·Gateway 오류 코드별 안내 (institution-service ErrorCode, origin/dev 기준) */
const ERROR_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: "관리자만 사용할 수 있는 기능입니다.",
  FORBIDDEN: "관리자만 사용할 수 있는 기능입니다.",
  USER_NOT_FOUND: "사용자를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.",
  USER_ALREADY_APPROVED: "이미 승인된 사용자입니다. 목록을 새로 불러왔습니다.",
  INSTITUTION_NOT_FOUND: "기관을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.",
  DUPLICATE_CARE_INSTITUTION_CODE: "이미 등록된 요양기관기호입니다.",
  INSTITUTION_TYPE_NOT_ALLOWED: "등록할 수 없는 기관 유형입니다.",
  INVALID_INSTITUTION_NAME: "기관명은 공백이 아닌 최대 100자여야 합니다.",
  INVALID_INSTITUTION_ADDRESS: "주소는 공백이 아닌 최대 255자여야 합니다.",
  INVALID_CARE_INSTITUTION_CODE: "요양기관기호는 숫자 8자리입니다.",
  INSTITUTION_HAS_ACTIVE_PARTNERSHIP: "진행 중이거나 활성 상태인 협약이 있어 삭제할 수 없습니다.",
  INSTITUTION_HAS_USERS: "소속 사용자가 있어 삭제할 수 없습니다.",
  VALIDATION_FAILED: "입력값을 확인해 주세요.",
  ADMIN_ONLY: "관리자만 사용할 수 있는 기능입니다.",
  SLOT_NOT_FOUND: "슬롯을 찾을 수 없습니다. 슬롯 ID를 확인해 주세요.",
  REFERRAL_NOT_FOUND: "의뢰를 찾을 수 없습니다. 삭제되었거나 올바르지 않은 의뢰입니다.",
  RESERVATION_NOT_FOUND: "예약을 찾을 수 없습니다. 삭제되었거나 올바르지 않은 예약입니다.",
  INVALID_INPUT: "요청 형식이 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
};

/**
 * 관리자 API 실패 안내 문구. 서버 메시지 본문을 그대로 보여 주지 않고, 알려진 오류 코드만 정해 둔 문구로 바꾼다.
 * 401(토큰 없음·만료)은 공통 문구, 설정·응답 형식 오류는 내부 내용을 보여 주지 않는다.
 */
export function getAdminErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error) || error.kind === "CONFIG" || error.kind === "PARSE") return fallback;
  if (error.kind === "HTTP" && error.status !== 401 && error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
  return error.message;
}
