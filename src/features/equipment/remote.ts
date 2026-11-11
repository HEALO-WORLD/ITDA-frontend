import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { isApiFeature, requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

/**
 * 검사기관 장비 실제 API (institution-service, Gateway 경유). origin/dev 898b449 기준으로 옮겼다.
 * - 장비: GET /institutions/{institutionId}/equipments · GET /equipments/{id} (REQUESTER·EXAMINER)
 *         POST /institutions/{institutionId}/equipments · PATCH /equipments/{id} (EXAMINER, 서비스가 요청자 기관과 장비 기관 일치 확인)
 * - 지원 검사 유형: GET /equipments/{id}/exam-types (REQUESTER·EXAMINER)
 *         POST /equipments/{id}/exam-types {examTypeId, durationMinutes} (EXAMINER, 같은 modality만, 중복 409)
 *         PATCH /equipments/{id}/exam-types/{examTypeId} {durationMinutes} (EXAMINER, 연결이 없으면 404)
 *   소요 시간은 장비·검사 유형 연결마다 있다 (공통 검사 유형 ExamTypeResponse에는 없다)
 * - 운영시간: GET /equipments/{id}/operating-hours (REQUESTER·EXAMINER) · PUT (EXAMINER, 전체 설정)
 *   PUT은 보낸 요일만 남기고 나머지 요일은 서버가 지운다 (보낸 목록이 곧 전체 운영시간). week는 1=월 ~ 7=일
 *
 * 기관 ID는 서버 모듈이 users/me로 확인한 소속 기관만 넣는다 (브라우저 값으로 정하지 않는다).
 * Mock 구현으로 대신하지 않는다: 입력이 계약과 다르면 요청 없이 CONFIG, 응답이 계약과 다르면 PARSE.
 */

type RequestOptions = Pick<ApiRequestOptions, "headers" | "signal">;

/** 장비 종류 (Modality) */
export type EquipmentModalityDto = "CT" | "MRI";
export const EQUIPMENT_MODALITIES: readonly EquipmentModalityDto[] = ["CT", "MRI"];

/** 장비 상태 (EquipmentStatus). 상태 변경 API는 없다 */
export type EquipmentStatusDto = "OPERATIONAL" | "MAINTENANCE" | "FAILED";
const EQUIPMENT_STATUSES: readonly EquipmentStatusDto[] = ["OPERATIONAL", "MAINTENANCE", "FAILED"];

/** 장비 (EquipmentDetailResponse·EquipmentCreateResponse: 필드가 같다) */
export interface EquipmentDto {
  id: string;
  institutionId: string;
  name: string;
  modality: EquipmentModalityDto;
  status: EquipmentStatusDto;
}

/** 장비 지원 검사 유형 (EquipmentExamTypeResponse) */
export interface EquipmentExamTypeDto {
  id: string;
  equipmentId: string;
  examTypeId: string;
  examTypeName: string;
  modality: EquipmentModalityDto;
  /** 검사 1건 소요 시간(분, 1 이상). 소요 시간 도입 전 연결은 비어 있을 수 있어 null을 받아 '미설정'으로 보인다 */
  durationMinutes: number | null;
}

/** 장비 운영시간 한 요일 (EquipmentOperatingHoursResponse). 시각은 `HH:mm`으로 맞춘다 */
export interface EquipmentOperatingHoursDto {
  id: string;
  equipmentId: string;
  /** 1=월 ~ 7=일 */
  week: number;
  startTime: string;
  endTime: string;
}

/** 운영시간 저장 한 요일 (EquipmentOperatingHoursUpdateRequest.OperatingHours) */
export interface EquipmentOperatingHoursInput {
  week: number;
  startTime: string;
  endTime: string;
}

/** 검사 소요 시간 최대값 (백엔드 Integer 범위. 백엔드 규칙은 @NotNull @Min(1)뿐이다) */
export const EQUIPMENT_DURATION_MAX = 2_147_483_647;

/** 검사 소요 시간 검사 (1 이상의 정수, 필수). 통과하면 null */
export function validateDurationMinutes(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "검사 소요 시간을 입력해 주세요.";
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > EQUIPMENT_DURATION_MAX) {
    return "검사 소요 시간은 1분 이상의 정수로 입력해 주세요.";
  }
  return null;
}

/** 입력 칸 문자열 → 소요 시간(분). 숫자만 있는 문자열이 아니면 NaN (검사는 validateDurationMinutes) */
export const parseDurationInput = (value: string): number | "" => {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
};

/** 장비명 최대 길이 (EquipmentCreateRequest·EquipmentUpdateRequest: @NotBlank @Size(max = 50)) */
export const EQUIPMENT_NAME_MAX_LENGTH = 50;
/** 목록 API 한 페이지 최대 크기 (서비스: 1~100 밖이면 400) */
export const EQUIPMENT_PAGE_MAX_SIZE = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isEquipmentEntityId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
export const isEquipmentModality = (value: unknown): value is EquipmentModalityDto => EQUIPMENT_MODALITIES.includes(value as EquipmentModalityDto);

/** 장비명 검사 (백엔드 규칙과 같다). 통과하면 null */
export function validateEquipmentName(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return "장비명을 입력해 주세요.";
  if (name.trim().length > EQUIPMENT_NAME_MAX_LENGTH) return `장비명은 ${EQUIPMENT_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
  return null;
}

/** 기관 장비 목록 한 페이지 `GET /api/v1/institutions/{institutionId}/equipments?page&size` */
export async function fetchEquipmentPage(
  institutionId: string,
  { modality, page = 0, size = EQUIPMENT_PAGE_MAX_SIZE }: { modality?: EquipmentModalityDto; page?: number; size?: number } = {},
  options: RequestOptions = {},
): Promise<PagedResponseDto<EquipmentDto>> {
  // 검사 목록(examinations)·장비 장애(incidents) 화면의 장비 이름에도 쓴다 (우리 기관 장비 목록 GET만)
  if (!isApiFeature("examinations") && !isApiFeature("incidents")) requireApiFeature("equipment");
  assertId(institutionId, "기관 ID");
  assertPage(page, size);
  if (modality !== undefined && !isEquipmentModality(modality)) throw new ApiError("CONFIG", "장비 종류가 올바르지 않습니다.");
  const data = await apiRequestData<unknown>(`/api/v1/institutions/${encodeURIComponent(institutionId)}/equipments`, {
    ...options,
    query: { ...(modality ? { modality } : {}), page, size },
  });
  if (!isPage(data, isEquipment)) throw parseError(data);
  return data;
}

/** 장비 단건 `GET /api/v1/equipments/{equipmentId}` (없으면 404 RESOURCE_NOT_FOUND) */
export async function fetchEquipment(equipmentId: string, options: RequestOptions = {}): Promise<EquipmentDto> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}`, options);
  if (!isEquipment(data) || data.id.toLowerCase() !== equipmentId.toLowerCase()) throw parseError(data);
  return data;
}

/** 장비 등록 `POST /api/v1/institutions/{institutionId}/equipments` (201). 비활성 기관이면 409 INSTITUTION_NOT_AVAILABLE */
export async function createEquipment(
  institutionId: string,
  input: { name: string; modality: EquipmentModalityDto },
  options: RequestOptions = {},
): Promise<EquipmentDto> {
  requireApiFeature("equipment");
  assertId(institutionId, "기관 ID");
  const nameError = validateEquipmentName(input.name);
  if (nameError) throw new ApiError("CONFIG", nameError);
  if (!isEquipmentModality(input.modality)) throw new ApiError("CONFIG", "장비 종류가 올바르지 않습니다.");
  const data = await apiRequestData<unknown>(`/api/v1/institutions/${encodeURIComponent(institutionId)}/equipments`, {
    ...options,
    method: "POST",
    body: { name: input.name.trim(), modality: input.modality },
  });
  if (!isEquipment(data) || data.institutionId.toLowerCase() !== institutionId.toLowerCase()) throw parseError(data);
  return data;
}

/** 장비 수정 `PATCH /api/v1/equipments/{equipmentId}` (장비명만. 종류·상태는 바꿀 수 없다) */
export async function updateEquipment(equipmentId: string, input: { name: string }, options: RequestOptions = {}): Promise<EquipmentDto> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  const nameError = validateEquipmentName(input.name);
  if (nameError) throw new ApiError("CONFIG", nameError);
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}`, {
    ...options,
    method: "PATCH",
    body: { name: input.name.trim() },
  });
  if (!isEquipment(data) || data.id.toLowerCase() !== equipmentId.toLowerCase()) throw parseError(data);
  return data;
}

/** 장비 지원 검사 유형 한 페이지 `GET /api/v1/equipments/{equipmentId}/exam-types?page&size` */
export async function fetchEquipmentExamTypePage(
  equipmentId: string,
  { page = 0, size = EQUIPMENT_PAGE_MAX_SIZE }: { page?: number; size?: number } = {},
  options: RequestOptions = {},
): Promise<PagedResponseDto<EquipmentExamTypeDto>> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  assertPage(page, size);
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}/exam-types`, { ...options, query: { page, size } });
  if (!isPage(data, isEquipmentExamType)) throw parseError(data);
  return data;
}

/** 장비 지원 검사 유형 등록 `POST /api/v1/equipments/{equipmentId}/exam-types` (201). 종류가 다르면 400, 이미 있으면 409 */
export async function createEquipmentExamType(
  equipmentId: string,
  input: { examTypeId: string; durationMinutes: number },
  options: RequestOptions = {},
): Promise<EquipmentExamTypeDto> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  assertId(input.examTypeId, "검사 유형 ID");
  assertDuration(input.durationMinutes);
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}/exam-types`, {
    ...options,
    method: "POST",
    body: { examTypeId: input.examTypeId, durationMinutes: input.durationMinutes },
  });
  if (!isLinkOf(data, equipmentId, input.examTypeId)) throw parseError(data);
  return data;
}

/** 장비별 검사 소요 시간 수정 `PATCH /api/v1/equipments/{equipmentId}/exam-types/{examTypeId}` (연결이 없으면 404) */
export async function updateEquipmentExamTypeDuration(
  equipmentId: string,
  examTypeId: string,
  durationMinutes: number,
  options: RequestOptions = {},
): Promise<EquipmentExamTypeDto> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  assertId(examTypeId, "검사 유형 ID");
  assertDuration(durationMinutes);
  const data = await apiRequestData<unknown>(
    `/api/v1/equipments/${encodeURIComponent(equipmentId)}/exam-types/${encodeURIComponent(examTypeId)}`,
    { ...options, method: "PATCH", body: { durationMinutes } },
  );
  if (!isLinkOf(data, equipmentId, examTypeId)) throw parseError(data);
  return data;
}

/** 장비 운영시간 `GET /api/v1/equipments/{equipmentId}/operating-hours` (운영하는 요일만, week 순) */
export async function fetchEquipmentOperatingHours(equipmentId: string, options: RequestOptions = {}): Promise<EquipmentOperatingHoursDto[]> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}/operating-hours`, options);
  return toOperatingHoursList(data, equipmentId);
}

/**
 * 장비 운영시간 전체 설정 `PUT /api/v1/equipments/{equipmentId}/operating-hours`.
 * 보낸 요일만 남고 빠진 요일은 서버가 지운다. 응답은 저장 후 전체 운영시간이다.
 */
export async function replaceEquipmentOperatingHours(
  equipmentId: string,
  operatingHours: readonly EquipmentOperatingHoursInput[],
  options: RequestOptions = {},
): Promise<EquipmentOperatingHoursDto[]> {
  requireApiFeature("equipment");
  assertId(equipmentId, "장비 ID");
  const inputError = validateOperatingHoursInput(operatingHours);
  if (inputError) throw new ApiError("CONFIG", inputError);
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${encodeURIComponent(equipmentId)}/operating-hours`, {
    ...options,
    method: "PUT",
    body: { operatingHours: operatingHours.map(({ week, startTime, endTime }) => ({ week, startTime, endTime })) },
  });
  return toOperatingHoursList(data, equipmentId);
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 운영시간 저장 값 검사 (백엔드 규칙: 최대 7개, week 1~7 중복 없음, 시작 < 종료). 통과하면 null */
export function validateOperatingHoursInput(hours: unknown): string | null {
  if (!Array.isArray(hours) || hours.length > 7) return "운영 시간 목록이 올바르지 않습니다.";
  const weeks = new Set<number>();
  for (const item of hours) {
    if (!isRecord(item) || !Number.isSafeInteger(item.week) || (item.week as number) < 1 || (item.week as number) > 7) return "운영 요일이 올바르지 않습니다.";
    if (weeks.has(item.week as number)) return "같은 요일이 두 번 들어 있습니다.";
    weeks.add(item.week as number);
    if (typeof item.startTime !== "string" || typeof item.endTime !== "string" || !HH_MM.test(item.startTime) || !HH_MM.test(item.endTime)) {
      return "운영 시각 형식을 확인해 주세요.";
    }
    if (item.startTime >= item.endTime) return "종료 시각은 시작 시각보다 늦어야 합니다.";
  }
  return null;
}

// ── 입력·응답 확인 ──

function assertId(value: string, label: string) {
  if (!isEquipmentEntityId(value)) throw new ApiError("CONFIG", `${label} 형식이 올바르지 않습니다.`);
}

function assertPage(page: number, size: number) {
  if (!Number.isSafeInteger(page) || page < 0) throw new ApiError("CONFIG", `페이지 번호가 올바르지 않습니다: ${page}`);
  if (!Number.isSafeInteger(size) || size < 1 || size > EQUIPMENT_PAGE_MAX_SIZE) throw new ApiError("CONFIG", `페이지 크기가 올바르지 않습니다: ${size}`);
}

function assertDuration(value: number) {
  const error = validateDurationMinutes(value);
  if (error) throw new ApiError("CONFIG", error);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const parseError = (body: unknown) => new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body });

function isEquipment(value: unknown): value is EquipmentDto {
  return (
    isRecord(value) &&
    isEquipmentEntityId(value.id) &&
    isEquipmentEntityId(value.institutionId) &&
    typeof value.name === "string" &&
    value.name !== "" &&
    isEquipmentModality(value.modality) &&
    EQUIPMENT_STATUSES.includes(value.status as EquipmentStatusDto)
  );
}

function isEquipmentExamType(value: unknown): value is EquipmentExamTypeDto {
  return (
    isRecord(value) &&
    [value.id, value.equipmentId, value.examTypeId].every(isEquipmentEntityId) &&
    typeof value.examTypeName === "string" &&
    isEquipmentModality(value.modality) &&
    (value.durationMinutes === null || (Number.isSafeInteger(value.durationMinutes) && (value.durationMinutes as number) >= 1))
  );
}

/** 이 장비·검사 유형 연결 응답인지 (등록·수정 응답 확인) */
function isLinkOf(value: unknown, equipmentId: string, examTypeId: string): value is EquipmentExamTypeDto {
  return (
    isEquipmentExamType(value) &&
    value.equipmentId.toLowerCase() === equipmentId.toLowerCase() &&
    value.examTypeId.toLowerCase() === examTypeId.toLowerCase()
  );
}

/**
 * 서버 시각(LocalTime: `HH:mm` 또는 `HH:mm:ss`) → `HH:mm`. 초가 0이 아니면 화면에서 그대로 다시 저장할 수 없어 받지 않는다
 */
function toHourMinute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(value);
  if (!match || !HH_MM.test(match[1])) return null;
  if ((match[2] && match[2] !== "00") || (match[3] && !/^0+$/.test(match[3]))) return null;
  return match[1];
}

/** 운영시간 응답 확인: 배열, 이 장비 것, week 1~7 중복 없음, 시작 < 종료. 계약과 다르면 PARSE */
function toOperatingHoursList(data: unknown, equipmentId: string): EquipmentOperatingHoursDto[] {
  if (!Array.isArray(data) || data.length > 7) throw parseError(data);
  const weeks = new Set<number>();
  const list = data.map((item) => {
    if (!isRecord(item) || !isEquipmentEntityId(item.id) || !isEquipmentEntityId(item.equipmentId)) throw parseError(data);
    if (item.equipmentId.toLowerCase() !== equipmentId.toLowerCase()) throw parseError(data);
    const week = item.week;
    if (!Number.isSafeInteger(week) || (week as number) < 1 || (week as number) > 7 || weeks.has(week as number)) throw parseError(data);
    weeks.add(week as number);
    const startTime = toHourMinute(item.startTime);
    const endTime = toHourMinute(item.endTime);
    if (!startTime || !endTime || startTime >= endTime) throw parseError(data);
    return { id: item.id, equipmentId: item.equipmentId, week: week as number, startTime, endTime };
  });
  return list.sort((a, b) => a.week - b.week);
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

/** 백엔드·Gateway 오류 코드별 안내 (institution-service ErrorCode) */
const ERROR_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: "검사기관 담당자만 사용할 수 있는 기능입니다.",
  FORBIDDEN: "우리 기관 장비만 조회·변경할 수 있습니다.",
  RESOURCE_NOT_FOUND: "장비 또는 검사 유형을 찾을 수 없습니다. 삭제되었을 수 있습니다.",
  INSTITUTION_NOT_AVAILABLE: "활성 검사기관에만 장비를 등록할 수 있습니다.",
  DUPLICATE_EQUIPMENT_NAME: "같은 이름의 장비가 이미 등록되어 있습니다. 장비 목록에서 확인해 주세요.",
  DUPLICATE_EQUIPMENT_EXAM_TYPE: "이미 이 장비에 연결된 검사 유형입니다.",
  INVALID_INPUT: "요청 값이 올바르지 않습니다. 장비 종류와 같은 검사 유형인지 확인해 주세요.",
  VALIDATION_FAILED: "입력값을 확인해 주세요.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
};

/** 실패 안내 문구. 서버 메시지 본문을 그대로 보여 주지 않고, 알려진 코드만 정해 둔 문구로 바꾼다 (overrides: 기능별 문구) */
export function getEquipmentErrorMessage(error: unknown, fallback: string, overrides: Record<string, string> = {}): string {
  if (!isApiError(error) || error.kind === "CONFIG" || error.kind === "PARSE") return fallback;
  if (error.kind === "HTTP" && error.status !== 401 && error.code) {
    const message = overrides[error.code] ?? ERROR_MESSAGES[error.code];
    if (message) return message;
  }
  return error.message;
}
