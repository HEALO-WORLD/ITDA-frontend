"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleMutationAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { toBackendWeek } from "./operatingHours";
import {
  createEquipment,
  createEquipmentExamType,
  fetchEquipmentPage,
  isEquipmentEntityId,
  isEquipmentModality,
  replaceEquipmentOperatingHours,
  updateEquipment,
  updateEquipmentExamTypeDuration,
  validateDurationMinutes,
  validateEquipmentName,
  validateOperatingHoursInput,
  type EquipmentOperatingHoursInput,
} from "./remote";
import {
  loadEquipmentDetail,
  loadEquipmentOperatingHours,
  loadExamTypeOptions,
  loadSupportedExamTypes,
  SUPPORTED_LOOKUP_MAX,
  toFailure,
  type EquipmentDetailResult,
  type EquipmentOperatingHoursResult,
  type ExamTypeOptionsResult,
  type SupportedExamTypesResult,
} from "./server";

/**
 * 검사기관 장비 Server Function (장비 상세·검사 유형 선택지·운영시간 조회, 장비 등록·수정,
 * 지원 검사 유형 연결·소요 시간 수정, 운영시간 설정).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 토큰을 넘긴다 (requireRoleAccess("EXAMINING"))
 * - 기관: 장비 등록 기관 ID는 users/me 소속 기관만 쓴다 (인자로 받지 않는다).
 *   수정·검사 유형 연결·운영시간 설정은 서비스가 장비 기관과 요청자 기관을 비교해 403으로 막는다
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다 (알려진 오류 코드만 정해 둔 문구로 안내)
 * 성공·404·409는 화면을 다시 불러와(refresh) 서버 값으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 */

export type EquipmentActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      /**
       * SESSION_CHANGED: 화면을 그린 뒤 다른 탭에서 로그인 계정이 바뀜(같은 계정 재로그인 포함)·렌더링 세션 값 누락 (요청하지 않음. FORBIDDEN과 구분)
       * UNCERTAIN: 장비 등록 POST의 결과를 알 수 없음 (응답 없음·시간 초과·응답 형식 오류·5xx). 서버에 이미 등록됐을 수 있어 다시 보내지 않는다
       */
      reason: "INVALID" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "SIGNED_OUT" | "SESSION_CHANGED" | "UNCERTAIN" | "NETWORK" | "ERROR";
      message: string;
      /**
       * UNCERTAIN일 때 장비 목록 재조회 결과 (확정 근거가 아니라 정황):
       * FOUND 같은 이름·종류의 장비가 있음(이번 요청일 수도, 같은 기관의 동시 등록일 수도 있다) · NOT_FOUND 아직 없음(처리 중일 수 있다) · LOOKUP_FAILED 재조회 실패
       */
      uncertain?: { lookup: "FOUND" | "NOT_FOUND" | "LOOKUP_FAILED"; equipmentId: string | null };
      fieldErrors?: Partial<Record<"name" | "modality" | "examTypeId" | "durationMinutes" | "operatingHours", string | null>>;
    };

type ActionFailure = Extract<EquipmentActionResult, { ok: false }>;

const FORBIDDEN_ORIGIN = { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null } as const;
const INVALID_EQUIPMENT = "장비 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.";

/** 지원 검사 유형 연결·소요 시간 수정 오류 문구 */
const EXAM_TYPE_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: "장비 또는 이 장비에 연결된 검사 유형을 찾을 수 없습니다. 목록을 다시 불러옵니다.",
  FORBIDDEN: "우리 기관 장비만 변경할 수 있습니다.",
};
/** 운영시간 조회·설정 오류 문구 */
const HOURS_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "운영 시간 값이 올바르지 않습니다. 요일별 시작·종료 시각을 확인해 주세요.",
  VALIDATION_FAILED: "운영 시간 값이 올바르지 않습니다. 요일별 시작·종료 시각을 확인해 주세요.",
  RESOURCE_NOT_FOUND: "장비를 찾을 수 없습니다. 삭제되었을 수 있습니다.",
  FORBIDDEN: "우리 기관 장비의 운영 시간만 바꿀 수 있습니다. 기관이 비활성 상태이면 바꿀 수 없습니다.",
  UNSUPPORTED_REQUEST: "서버에서 운영 시간 저장을 처리하지 못했습니다. 서버에 운영 시간 기능이 배포되었는지 확인해 주세요.",
};

export async function loadEquipmentDetailAction(equipmentId: unknown): Promise<EquipmentDetailResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!isEquipmentEntityId(equipmentId)) return { ok: false, reason: "ERROR", message: "장비 정보가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null };
  return loadEquipmentDetail(equipmentId);
}

export async function loadExamTypeOptionsAction(modality: unknown): Promise<ExamTypeOptionsResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!isEquipmentModality(modality)) return { ok: false, reason: "ERROR", message: "장비 종류가 올바르지 않습니다.", code: null };
  return loadExamTypeOptions(modality);
}

/** 장비 운영시간 조회 (우리 기관 장비만) */
export async function loadEquipmentOperatingHoursAction(equipmentId: unknown): Promise<EquipmentOperatingHoursResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!isEquipmentEntityId(equipmentId)) return { ok: false, reason: "ERROR", message: "장비 정보가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null };
  return loadEquipmentOperatingHours(equipmentId);
}

/** 변경 Action 공통: expectedLoginSession은 화면이 렌더링될 때의 로그인 세션 구분 값. 지금 쿠키 값과 다르면 요청하지 않는다 (SESSION_CHANGED) */
export async function createEquipmentAction(input: unknown, expectedLoginSession?: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  // 기관 ID는 받지 않는다 (users/me 소속 기관으로 등록)
  const { name, modality } = asRecord(input);
  const fieldErrors = { name: validateEquipmentName(name), modality: isEquipmentModality(modality) ? null : "장비 종류를 선택해 주세요." };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors };
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (!access.ok) return toAccessFailure(access);
  try {
    await createEquipment(access.user.institutionId, { name: name as string, modality: modality as "CT" | "MRI" }, { headers: access.headers });
  } catch (error) {
    if (isCreateResultUnknown(error)) return checkUncertainCreate(error, access.headers, access.user.institutionId, name as string, modality as "CT" | "MRI");
    return toActionFailure(error, "create", "장비 등록에 실패했습니다.");
  }
  refresh();
  return { ok: true, message: "장비를 등록했습니다." };
}

export async function updateEquipmentAction(equipmentId: unknown, input: unknown, expectedLoginSession?: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isEquipmentEntityId(equipmentId)) return invalid(INVALID_EQUIPMENT);
  // 장비명만 받는다 (백엔드 수정 대상은 이름뿐. 종류·상태 변경 API는 없다)
  const { name } = asRecord(input);
  const nameError = validateEquipmentName(name);
  if (nameError) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors: { name: nameError } };
  return run(expectedLoginSession, "update", "장비 정보를 수정했습니다.", (requestHeaders) => updateEquipment(equipmentId, { name: name as string }, { headers: requestHeaders }), "장비 수정에 실패했습니다.");
}

/** 지원 검사 유형 추가 (검사 유형 + 이 장비에서의 소요 시간, 둘 다 필수) */
export async function addEquipmentExamTypeAction(equipmentId: unknown, input: unknown, expectedLoginSession?: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isEquipmentEntityId(equipmentId)) return invalid(INVALID_EQUIPMENT);
  const { examTypeId, durationMinutes } = asRecord(input);
  const fieldErrors = {
    examTypeId: isEquipmentEntityId(examTypeId) ? null : "검사 유형을 선택해 주세요.",
    durationMinutes: validateDurationMinutes(durationMinutes),
  };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: fieldErrors.examTypeId ?? fieldErrors.durationMinutes!, fieldErrors };
  return run(
    expectedLoginSession,
    "exam-type-add",
    "지원 검사 유형을 추가했습니다.",
    (requestHeaders) => createEquipmentExamType(equipmentId, { examTypeId: examTypeId as string, durationMinutes: durationMinutes as number }, { headers: requestHeaders }),
    "지원 검사 유형 추가에 실패했습니다.",
    EXAM_TYPE_MESSAGES,
  );
}

/** 연결된 지원 검사 유형의 소요 시간 수정 (검사 유형 ID는 공통 검사 유형 ID) */
export async function updateEquipmentExamTypeDurationAction(
  equipmentId: unknown,
  examTypeId: unknown,
  durationMinutes: unknown,
  expectedLoginSession?: unknown,
): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isEquipmentEntityId(equipmentId) || !isEquipmentEntityId(examTypeId)) return invalid(INVALID_EQUIPMENT);
  const durationError = validateDurationMinutes(durationMinutes);
  if (durationError) return { ok: false, reason: "INVALID", message: durationError, fieldErrors: { durationMinutes: durationError } };
  return run(
    expectedLoginSession,
    "exam-type-duration",
    "검사 소요 시간을 수정했습니다.",
    (requestHeaders) => updateEquipmentExamTypeDuration(equipmentId, examTypeId, durationMinutes as number, { headers: requestHeaders }),
    "검사 소요 시간 수정에 실패했습니다.",
    EXAM_TYPE_MESSAGES,
  );
}

/**
 * 장비 운영시간 전체 설정. 화면이 보낸 요일(0=일 ~ 6=토)을 백엔드 week(1=월 ~ 7=일)로 바꿔 PUT한다.
 * PUT은 빠진 요일을 지우므로, 화면은 서버에서 불러온 운영시간을 고친 전체 목록만 보낸다 (조회 실패 시 저장 버튼이 없다).
 * 운영하는 요일이 하나도 없으면 보내지 않는다 (모든 요일이 지워지는 것을 막는다).
 */
export async function saveEquipmentOperatingHoursAction(equipmentId: unknown, days: unknown, expectedLoginSession?: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isEquipmentEntityId(equipmentId)) return invalid(INVALID_EQUIPMENT);
  const parsed = parseOperatingDays(days);
  if (typeof parsed === "string") return { ok: false, reason: "INVALID", message: parsed, fieldErrors: { operatingHours: parsed } };
  return run(
    expectedLoginSession,
    "operating-hours-save",
    "운영 시간을 저장했습니다.",
    (requestHeaders) => replaceEquipmentOperatingHours(equipmentId, parsed, { headers: requestHeaders }),
    "운영 시간 저장에 실패했습니다.",
    HOURS_MESSAGES,
  );
}

async function checkOrigin(): Promise<EquipmentActionResult | null> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN", message: FORBIDDEN_ORIGIN.message };
  return null;
}

const asRecord = (input: unknown) => (typeof input === "object" && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
const invalid = (message: string): EquipmentActionResult => ({ ok: false, reason: "INVALID", message });

/**
 * 화면 운영 요일 목록 → 저장 값. 형식: [{ weekday: 0~6, open: "HH:mm", close: "HH:mm" }] (운영하는 요일만, 휴게 시간은 받지 않는다).
 * 올바르지 않으면 안내 문구를 돌려준다.
 */
function parseOperatingDays(days: unknown): EquipmentOperatingHoursInput[] | string {
  if (!Array.isArray(days) || days.length > 7) return "운영 시간 목록이 올바르지 않습니다.";
  if (days.length === 0) return "운영하는 요일을 하루 이상 설정해 주세요.";
  const hours: EquipmentOperatingHoursInput[] = [];
  for (const day of days) {
    const { weekday, open, close } = asRecord(day);
    if (!Number.isSafeInteger(weekday) || (weekday as number) < 0 || (weekday as number) > 6) return "운영 요일이 올바르지 않습니다.";
    if (typeof open !== "string" || typeof close !== "string") return "운영 시각 형식을 확인해 주세요.";
    hours.push({ week: toBackendWeek(weekday as number), startTime: open, endTime: close });
  }
  const error = validateOperatingHoursInput(hours);
  return error ?? hours.sort((a, b) => a.week - b.week);
}

/** HTTP 오류 → 결과 (404·409는 화면을 다시 불러온다) */
function toActionFailure(error: unknown, action: string, fallback: string, overrides?: Record<string, string>): ActionFailure {
  const failure = toFailure(error, action, fallback, overrides);
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  if (status === 409 || status === 404) refresh();
  return {
    ok: false,
    reason: status === 409 ? "CONFLICT" : status === 404 ? "NOT_FOUND" : status === 400 ? "INVALID" : failure.reason,
    message: failure.message,
  };
}

/**
 * 장비 등록 POST의 결과를 알 수 없는 실패인지 (서버가 이미 등록했을 수 있어 다시 보내면 안 된다).
 * 응답 없음(연결 실패·시간 초과·중단)·응답 형식 오류·5xx(처리 뒤 응답 단계에서 실패했을 수 있다)·알 수 없는 오류.
 * 400·401·403·404·409(같은 이름 장비가 이미 있음)는 서버가 거부한 확실한 실패다
 */
function isCreateResultUnknown(error: unknown): boolean {
  if (!isApiError(error)) return true;
  if (error.kind === "NETWORK" || error.kind === "TIMEOUT" || error.kind === "ABORTED" || error.kind === "PARSE") return true;
  return error.kind === "HTTP" && error.status !== null && error.status >= 500;
}

const UNCERTAIN_CREATE_MESSAGES = {
  FOUND:
    "장비 등록 응답을 받지 못했습니다. 장비 목록에 같은 이름·종류의 장비가 있어 이번 요청으로 등록되었을 가능성이 큽니다(같은 기관의 다른 사용자가 동시에 등록했을 수도 있습니다). 지원 검사 유형과 운영 시간은 저장하지 않았습니다. 다시 등록하지 말고 장비 목록에서 확인한 뒤 장비 상세·운영시간 설정에서 이어서 설정해 주세요.",
  NOT_FOUND:
    "장비 등록 결과를 확인하지 못했습니다. 지금 장비 목록에는 같은 이름의 장비가 없지만 서버에서 아직 처리 중일 수 있습니다. 잠시 후 장비 목록에서 먼저 확인하고, 없을 때만 다시 등록해 주세요. 지원 검사 유형과 운영 시간은 저장하지 않았습니다.",
  LOOKUP_FAILED:
    "장비 등록 결과를 확인하지 못했고 장비 목록도 불러오지 못했습니다. 장비가 등록되었을 수 있으니 창을 닫고 장비 목록에서 먼저 확인해 주세요. 확인하기 전에는 같은 요청을 다시 보내지 마세요. 지원 검사 유형과 운영 시간은 저장하지 않았습니다.",
} as const;

/**
 * 장비 등록 결과 불명 처리: 장비 등록 POST는 다시 보내지 않고, 우리 기관 장비 목록을 한 번 조회(GET)해 같은 이름·종류의 장비가 있는지 알린다.
 * 목록 조회가 됐을 때만 화면을 서버 값으로 다시 그린다(refresh): 조회도 실패하는 상황에서 다시 그리면 장비 화면이 오류로 바뀌어
 * 결과 불명 안내가 있는 등록 창까지 사라진다.
 * 백엔드에 멱등 키가 없고 장비 응답에 생성 시각·요청 구분 값이 없어, 찾더라도 이번 요청의 결과라고 확정하지 않는다
 * (같은 기관의 동시 등록일 수 있다). 같은 이름 재등록은 백엔드가 409(DUPLICATE_EQUIPMENT_NAME)로 막는다.
 */
async function checkUncertainCreate(error: unknown, requestHeaders: HeadersInit, institutionId: string, name: string, modality: "CT" | "MRI"): Promise<ActionFailure> {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  console.error("[equipment] create 결과 불명:", isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
  let lookup: "FOUND" | "NOT_FOUND" | "LOOKUP_FAILED" = "LOOKUP_FAILED";
  let equipmentId: string | null = null;
  try {
    const page = await fetchEquipmentPage(institutionId, { modality }, { headers: requestHeaders });
    const match = page.contents.find((item) => item.name.trim() === name.trim() && item.modality === modality);
    // 한 페이지(최대 100대) 안에서 못 찾았는데 장비가 더 있으면 '없음'으로 단정하지 않는다
    lookup = match ? "FOUND" : page.totalPages > 1 ? "LOOKUP_FAILED" : "NOT_FOUND";
    equipmentId = match?.id ?? null;
    refresh();
  } catch (lookupError) {
    toFailure(lookupError, "create-uncertain-lookup", "장비 목록을 확인하지 못했습니다.");
  }
  return { ok: false, reason: "UNCERTAIN", message: UNCERTAIN_CREATE_MESSAGES[lookup], uncertain: { lookup, equipmentId } };
}

/** 검사기관·로그인 세션 확인 실패 → 결과 (SESSION_CHANGED는 FORBIDDEN으로 바꾸지 않는다) */
function toAccessFailure(access: Extract<Awaited<ReturnType<typeof requireRoleMutationAccess>>, { ok: false }>): ActionFailure {
  if (access.reason === "SESSION_CHANGED") return { ok: false, reason: "SESSION_CHANGED", message: access.message };
  const failure = toRoleAccessFailure(access);
  return { ok: false, reason: failure.reason, message: failure.reason === "SIGNED_OUT" ? "로그인이 필요합니다. 다시 로그인해 주세요." : failure.message };
}

/**
 * 검사기관·로그인 세션 확인 → 요청 → 결과. 성공·404·409는 화면을 다시 불러온다.
 * 세션이 바뀌었으면(SESSION_CHANGED) 요청하지 않고 화면도 다시 불러오지 않는다
 */
async function run(
  expectedLoginSession: unknown,
  action: string,
  successMessage: string,
  request: (requestHeaders: HeadersInit, institutionId: string) => Promise<unknown>,
  fallback: string,
  overrides?: Record<string, string>,
): Promise<EquipmentActionResult> {
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (!access.ok) return toAccessFailure(access);
  try {
    await request(access.headers, access.user.institutionId);
  } catch (error) {
    return toActionFailure(error, action, fallback, overrides);
  }
  refresh();
  return { ok: true, message: successMessage };
}

/** 장비 목록의 지원 검사 유형·운영시간 표시용 (조회만). ID는 최대 10개, 서버가 우리 기관 장비인지 다시 확인한다 */
export async function loadSupportedExamTypesAction(equipmentIds: unknown): Promise<SupportedExamTypesResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!Array.isArray(equipmentIds) || equipmentIds.length > SUPPORTED_LOOKUP_MAX || !equipmentIds.every(isEquipmentEntityId)) {
    return { ok: false, reason: "ERROR", message: "장비 정보가 올바르지 않습니다.", code: null };
  }
  return loadSupportedExamTypes(equipmentIds);
}

/** 장비 등록 시 함께 연결할 수 있는 지원 검사 유형 최대 수 */
const CREATE_EXAM_TYPE_MAX = 20;

/**
 * 장비 등록 결과. 장비가 만들어졌으면 ok: true이고, 뒤 단계(검사 유형 연결·운영시간 저장)의 실패는 따로 알린다.
 * - linkFailed: 연결하지 못한 지원 검사 유형 수 (장비 상세에서 다시 추가)
 * - hoursError: 운영시간을 저장하지 못했을 때의 안내 (등록 창에서 다시 저장하거나 목록의 [운영시간 수정]에서 설정)
 */
export type CreateEquipmentResult =
  | { ok: true; message: string; equipmentId: string; linkFailed: number; hoursError: string | null }
  | ActionFailure;

/**
 * 장비 등록 + 지원 검사 유형 연결(유형별 소요 시간) + 운영시간 설정 (2단계 등록 대화상자).
 * 1) POST 장비(장비명·종류만) → 2) 검사 유형마다 POST {examTypeId, durationMinutes} → 3) PUT 운영시간.
 * 입력은 요청 전에 모두 검사한다. 장비 등록이 서버에서 거부되면(400·403·409 등) 아무것도 만들지 않은 것이다.
 * 장비 등록 결과를 알 수 없으면(응답 없음·5xx 등) 2·3을 진행하지 않고 UNCERTAIN으로 끝낸다 (checkUncertainCreate, 장비 등록 POST 재전송 없음).
 * 2·3이 실패해도 장비 등록은 성공으로 두고, 무엇이 저장되지 않았는지 구분해 알린다.
 */
export async function createEquipmentWithExamTypesAction(input: unknown, expectedLoginSession?: unknown): Promise<CreateEquipmentResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked as ActionFailure;
  const { name, modality, examTypes, operatingHours } = asRecord(input);
  const fieldErrors = { name: validateEquipmentName(name), modality: isEquipmentModality(modality) ? null : "검사 유형(CT·MRI)을 선택해 주세요." };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors };

  const links = examTypes === undefined ? [] : examTypes;
  if (!Array.isArray(links) || links.length > CREATE_EXAM_TYPE_MAX) {
    return { ok: false, reason: "INVALID", message: "지원 검사 유형 선택이 올바르지 않습니다.", fieldErrors: { examTypeId: "지원 검사 유형을 다시 선택해 주세요." } };
  }
  const seen = new Set<string>();
  const linkInputs: { examTypeId: string; durationMinutes: number }[] = [];
  for (const link of links) {
    const { examTypeId, durationMinutes } = asRecord(link);
    if (!isEquipmentEntityId(examTypeId) || seen.has(examTypeId.toLowerCase())) {
      return { ok: false, reason: "INVALID", message: "지원 검사 유형 선택이 올바르지 않습니다.", fieldErrors: { examTypeId: "지원 검사 유형을 다시 선택해 주세요." } };
    }
    const durationError = validateDurationMinutes(durationMinutes);
    if (durationError) return { ok: false, reason: "INVALID", message: durationError, fieldErrors: { durationMinutes: durationError } };
    seen.add(examTypeId.toLowerCase());
    linkInputs.push({ examTypeId, durationMinutes: durationMinutes as number });
  }
  const hours = parseOperatingDays(operatingHours);
  if (typeof hours === "string") return { ok: false, reason: "INVALID", message: hours, fieldErrors: { operatingHours: hours } };

  // 장비 등록·검사 유형 연결·운영시간 저장(최대 22회 요청) 전에 한 번 확인한다: 세션이 바뀌었으면 하나도 보내지 않는다
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (!access.ok) return toAccessFailure(access);

  let equipmentId: string;
  try {
    const created = await createEquipment(access.user.institutionId, { name: name as string, modality: modality as "CT" | "MRI" }, { headers: access.headers });
    equipmentId = created.id;
  } catch (error) {
    // 등록됐는지 모르는 장비에 검사 유형·운영시간을 이어서 저장하지 않는다
    if (isCreateResultUnknown(error)) return checkUncertainCreate(error, access.headers, access.user.institutionId, name as string, modality as "CT" | "MRI");
    return toActionFailure(error, "create", "장비 등록에 실패했습니다.");
  }

  let linkFailed = 0;
  for (const link of linkInputs) {
    try {
      await createEquipmentExamType(equipmentId, link, { headers: access.headers });
    } catch (error) {
      toFailure(error, "create-exam-type", "지원 검사 유형 연결에 실패했습니다.");
      linkFailed++;
    }
  }

  let hoursError: string | null = null;
  try {
    await replaceEquipmentOperatingHours(equipmentId, hours, { headers: access.headers });
  } catch (error) {
    hoursError = toFailure(error, "create-operating-hours", "운영 시간 저장에 실패했습니다.", HOURS_MESSAGES).message;
  }

  refresh();
  const parts = [
    linkFailed > 0 ? `지원 검사 유형 ${linkFailed}개를 연결하지 못했습니다(장비 상세에서 다시 추가해 주세요)` : null,
    hoursError ? "운영 시간을 저장하지 못했습니다" : null,
  ].filter(Boolean);
  const message =
    parts.length > 0
      ? `장비는 등록되었지만 ${parts.join(", ")}.`
      : `장비를 등록했습니다.${linkInputs.length > 0 ? ` 지원 검사 유형 ${linkInputs.length}개를 연결하고` : ""} 운영 시간을 저장했습니다.`;
  return { ok: true, message, equipmentId, linkFailed, hoursError };
}
