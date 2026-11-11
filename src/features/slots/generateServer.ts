import "server-only";

import { unstable_rethrow } from "next/navigation";

import {
  EQUIPMENT_PAGE_MAX_SIZE,
  fetchEquipment,
  fetchEquipmentExamTypePage,
  fetchEquipmentOperatingHours,
  type EquipmentDto,
  type EquipmentExamTypeDto,
} from "@/features/equipment/remote";
import { toDailyOperatingHours, toFailure } from "@/features/equipment/server";
import { toBackendWeek } from "@/features/equipment/operatingHours";
import type { DailyOperatingHours } from "@/features/equipment/types";
import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, requireRoleMutationAccess, toRoleAccessFailure, type RoleAccess } from "@/lib/auth/session";
import { addDays, getSeoulNow, getWeekday, type DateKey } from "@/lib/date/seoulDate";

import { API_SEARCH_MAX_LOOKAHEAD_DAYS } from "./apiSearchClient";
import { collectSlicePages } from "./apiSlots";
import {
  listRangeDates,
  splitOperatingDates,
  summarizeGeneration,
  validateGenerationRange,
  type GenerationDayStatus,
  type GenerationRangeField,
  type GenerationSummary,
} from "./generationRange";
import {
  generateSlots,
  getSlotGenerateFailure,
  isSlotApiId,
  searchSlots,
  SLOT_SEARCH_MAX_SIZE,
  validateSlotGenerateRequest,
  type SlotCreateResponseDto,
  type SlotGenerateFailureReason,
  type SlotGenerateField,
} from "./remote";

/**
 * 검사기관 실제 슬롯 생성 (서버 전용). Server Function(generateActions.ts)이 부른다.
 *
 * 순서: 기능 설정 → users/me로 EXAMINER 확인 → 입력 확인 → 장비가 우리 기관 것인지 → 연결된 검사 유형·소요 시간 → 그 요일 운영시간 → POST
 * - 기관은 users/me 소속 기관만 쓴다 (화면에서 기관 ID를 받지 않는다). 백엔드도 장비 기관을 다시 비교해 403으로 막는다
 * - 요청 전 확인은 백엔드 규칙을 미리 알려 주기 위한 것이다 (같은 이유로 백엔드가 거부한다). 생성 개수 계산·미리보기는 하지 않는다
 * - 실패하면 Mock 생성으로 대신하지 않는다. 로그에는 종류·상태·코드만 남긴다 (토큰·응답 본문 없음)
 */

const REQUIRED_FEATURES = ["slots", "equipment"] as const;

export type SlotGenerationFailureReason =
  | SlotGenerateFailureReason
  | "SIGNED_OUT"
  | "NOT_AVAILABLE"
  /** 화면을 그린 뒤 다른 탭에서 로그인 계정이 바뀜(같은 계정 재로그인 포함)·렌더링 세션 값 누락 (장비·운영시간·기존 슬롯 확인과 생성 POST 모두 하지 않음. FORBIDDEN과 구분) */
  | "SESSION_CHANGED";
export type SlotGenerationFailure = { ok: false; reason: SlotGenerationFailureReason; message: string; field?: SlotGenerateField | GenerationRangeField };

/** 화면에 보낼 생성 슬롯 (서버 원본 ID·시각 + 서울 표시 시각) */
export interface GeneratedSlot {
  id: string;
  equipmentId: string;
  examTypeId: string;
  startsAt: string;
  endsAt: string;
  /** 서울 `YYYY-MM-DDTHH:mm` */
  startAt: string;
  endAt: string;
}

export type SlotGenerationResult =
  | { ok: true; message: string; date: DateKey; equipmentId: string; examTypeId: string; slots: GeneratedSlot[] }
  | SlotGenerationFailure;

/** 생성 화면에 필요한 장비 정보: 연결된 검사 유형(소요 시간 포함)·요일별 운영시간 */
export type SlotGenerationContextResult =
  | { ok: true; equipment: EquipmentDto; examTypes: EquipmentExamTypeDto[]; hours: DailyOperatingHours[] }
  | SlotGenerationFailure;

export type GeneratedSlotsLookupResult = { ok: true; slots: GeneratedSlot[] } | SlotGenerationFailure;

const isAvailable = () => REQUIRED_FEATURES.every((feature) => isApiFeature(feature));
const NOT_AVAILABLE: SlotGenerationFailure = { ok: false, reason: "NOT_AVAILABLE", message: "슬롯 생성 API가 아직 연결되지 않았습니다." };
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function accessFailure(access: Extract<RoleAccess, { ok: false }>): SlotGenerationFailure {
  const failure = toRoleAccessFailure(access);
  return {
    ok: false,
    reason: failure.reason,
    message: failure.reason === "SIGNED_OUT" ? "로그인이 필요합니다. 다시 로그인해 주세요." : failure.reason === "FORBIDDEN" ? "검사기관 계정만 슬롯을 만들 수 있습니다." : failure.message,
  };
}

/** 다른 탭에서 계정이 바뀌어 생성하지 않았다 (권한 부족 FORBIDDEN과 구분, 결과 불명 아님) */
const sessionChanged = (message: string): SlotGenerationFailure => ({ ok: false, reason: "SESSION_CHANGED", message });

function fromLoadFailure(error: unknown, action: string, fallback: string): SlotGenerationFailure {
  const failure = toFailure(error, action, fallback);
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  return { ok: false, reason: status === 404 ? "NOT_FOUND" : failure.reason === "SIGNED_OUT" ? "UNAUTHORIZED" : failure.reason, message: failure.message };
}

/** 장비가 우리 기관 것인지 확인한 뒤 연결된 검사 유형·운영시간 (요청 3회: 장비 1 → 검사 유형·운영시간 병렬) */
async function loadOwnedContext(equipmentId: string, access: Extract<RoleAccess, { ok: true }>): Promise<SlotGenerationContextResult> {
  const options = { headers: access.headers };
  try {
    const equipment = await fetchEquipment(equipmentId, options);
    if (!sameId(equipment.institutionId, access.user.institutionId)) {
      return { ok: false, reason: "FORBIDDEN", message: "우리 기관 장비에만 슬롯을 만들 수 있습니다.", field: "equipmentId" };
    }
    const [examTypes, hours] = await Promise.all([
      fetchEquipmentExamTypePage(equipmentId, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, options),
      fetchEquipmentOperatingHours(equipmentId, options),
    ]);
    return {
      ok: true,
      equipment,
      examTypes: examTypes.contents.filter((item) => sameId(item.equipmentId, equipmentId)),
      hours: toDailyOperatingHours(hours.filter((item) => sameId(item.equipmentId, equipmentId))),
    };
  } catch (error) {
    unstable_rethrow(error);
    return fromLoadFailure(error, "slot-generation-context", "장비 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function loadSlotGenerationContext(equipmentId: unknown): Promise<SlotGenerationContextResult> {
  if (!isAvailable()) return NOT_AVAILABLE;
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return accessFailure(access);
  if (!isSlotApiId(equipmentId)) return { ok: false, reason: "INVALID", message: "장비를 선택해 주세요.", field: "equipmentId" };
  return loadOwnedContext(equipmentId, access);
}

/** 생성 날짜 확인 (서울 기준 오늘 ~ 1년). 지난 날짜는 요청하지 않는다 */
function checkDate(date: DateKey): string | null {
  const today = getSeoulNow().dateKey;
  if (date < today) return "지난 날짜에는 슬롯을 만들 수 없습니다. 오늘 이후 날짜를 선택해 주세요.";
  if (date > addDays(today, API_SEARCH_MAX_LOOKAHEAD_DAYS)) return "1년 이내의 날짜만 선택할 수 있습니다.";
  return null;
}

const toGeneratedSlot = (slot: SlotCreateResponseDto, toMinute: (value: string) => string): GeneratedSlot => ({
  id: slot.id,
  equipmentId: slot.equipmentId,
  examTypeId: slot.examTypeId,
  startsAt: slot.startsAt,
  endsAt: slot.endsAt,
  startAt: toMinute(slot.startsAt),
  endAt: toMinute(slot.endsAt),
});

/** 응답 시각은 isSlotGenerateResponse가 서울 날짜·형식을 확인했다. 표시용 분 단위 문자열만 만든다 */
function seoulMinute(value: string): string {
  const date = new Date(value);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map(({ type, value: part }) => [type, part]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * 하루치 슬롯 생성. 요청 전 확인을 모두 통과해야 POST한다 (POST는 1회).
 * expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값. 역할 확인과 함께 지금 쿠키의 로그인 세션과 비교해,
 * 다르면 장비·운영시간 확인과 POST 없이 SESSION_CHANGED
 */
export async function submitSlotGeneration(input: unknown, expectedLoginSession?: unknown): Promise<SlotGenerationResult> {
  if (!isAvailable()) return NOT_AVAILABLE;
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (!access.ok) return access.reason === "SESSION_CHANGED" ? sessionChanged(access.message) : accessFailure(access);

  const validation = validateSlotGenerateRequest(input);
  if (!validation.ok) return { ok: false, reason: "INVALID", message: validation.message, field: validation.field };
  const { body } = validation;
  const dateError = checkDate(body.date);
  if (dateError) return { ok: false, reason: "INVALID", message: dateError, field: "date" };

  const context = await loadOwnedContext(body.equipmentId, access);
  if (!context.ok) return context;
  const blocked = checkGenerationContext(context, body.examTypeId);
  if (blocked) return blocked;
  const weekday = getWeekday(body.date);
  if (!context.hours.some((day) => toBackendWeek(day.weekday) === toBackendWeek(weekday))) {
    return { ok: false, reason: "INVALID", message: "선택한 날짜는 이 장비가 운영하지 않는 요일입니다. 운영 요일을 선택해 주세요.", field: "date" };
  }

  const posted = await postOneDay(body, access.headers);
  if (!posted.ok) return { ok: false, reason: posted.failure.reason, message: posted.failure.message };
  return { ok: true, message: `${body.date} 슬롯 ${posted.slots.length}개를 만들었습니다.`, date: body.date, equipmentId: body.equipmentId, examTypeId: body.examTypeId, slots: posted.slots };
}

/** 장비 상태·연결 검사 유형·소요 시간·운영시간 확인 (하루·기간 생성 공통). 문제없으면 null */
function checkGenerationContext(context: Extract<SlotGenerationContextResult, { ok: true }>, examTypeId: string): SlotGenerationFailure | null {
  if (context.equipment.status !== "OPERATIONAL") {
    return { ok: false, reason: "CONFLICT", message: "정상 상태인 장비에만 슬롯을 만들 수 있습니다. 장비 상태를 확인해 주세요.", field: "equipmentId" };
  }
  const link = context.examTypes.find((item) => sameId(item.examTypeId, examTypeId));
  if (!link) return { ok: false, reason: "INVALID", message: "이 장비에 연결된 검사 유형을 선택해 주세요.", field: "examTypeId" };
  if (link.durationMinutes === null || link.durationMinutes < 1) {
    return { ok: false, reason: "INVALID", message: "이 검사 유형의 소요 시간이 설정되지 않았습니다. 장비 상세에서 소요 시간을 먼저 설정해 주세요.", field: "examTypeId" };
  }
  if (context.hours.length === 0) {
    return { ok: false, reason: "INVALID", message: "장비 운영시간이 설정되지 않았습니다. [운영시간 수정]에서 먼저 설정해 주세요.", field: "equipmentId" };
  }
  return null;
}

/** 하루 POST 1회 (단일·기간 생성 공통). 오류는 던지지 않고 구분해 돌려준다 */
async function postOneDay(
  body: { equipmentId: string; examTypeId: string; date: string },
  requestHeaders: HeadersInit,
): Promise<{ ok: true; slots: GeneratedSlot[] } | { ok: false; failure: ReturnType<typeof getSlotGenerateFailure> }> {
  try {
    const created = await generateSlots(body, { headers: requestHeaders });
    return { ok: true, slots: created.map((slot) => toGeneratedSlot(slot, seoulMinute)).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)) };
  } catch (error) {
    unstable_rethrow(error);
    const failure = getSlotGenerateFailure(error);
    if (failure.reason !== "UNAUTHORIZED") {
      console.error("[slots] 슬롯 생성 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
    }
    return { ok: false, failure };
  }
}

// ── 기간 생성 (여러 날짜) ──

export interface GenerationDayResult {
  date: DateKey;
  status: GenerationDayStatus;
  message: string;
  /** SUCCESS일 때 서버가 돌려준 슬롯 */
  slots: GeneratedSlot[];
}

export type SlotRangeGenerationResult =
  | {
      ok: true;
      equipmentId: string;
      examTypeId: string;
      startDate: DateKey;
      endDate: DateKey;
      days: GenerationDayResult[];
      summary: GenerationSummary;
      /** 인증·연결 장애로 남은 날짜를 요청하지 않고 멈췄을 때의 이유 */
      stoppedReason: string | null;
    }
  | SlotGenerationFailure;

/** 이 실패가 나면 남은 날짜를 요청하지 않는다 (인증·권한 문제, 연결·응답 불확실, 기준정보 서비스 장애) */
const STOP_REASONS: ReadonlySet<SlotGenerationFailureReason> = new Set(["UNAUTHORIZED", "FORBIDDEN", "NETWORK", "TIMEOUT", "INVALID_RESPONSE"]);
/** 생성 여부를 알 수 없는 실패 (응답을 못 받았거나 201 응답을 확인하지 못함) */
const UNKNOWN_REASONS: ReadonlySet<SlotGenerationFailureReason> = new Set(["NETWORK", "TIMEOUT", "INVALID_RESPONSE"]);

/**
 * 이미 슬롯이 있는 날짜 (생성 전 조회). 같은 장비의 슬롯이 하나라도 있으면 그날은 POST하지 않는다
 * (부분 성공 뒤 같은 기간을 다시 요청해도 성공한 날짜에 POST가 다시 가지 않게 한다. 화면 메모리에 기대지 않는다).
 * 슬롯 검색(view=SEARCH)은 시작 전 AVAILABLE만 보여 주므로 예약된 슬롯만 있는 날은 여기서 못 찾는다: 그때는 서버가 409로 막는다.
 * 조회에 실패하면 null (생성하지 않고 멈춘다).
 */
async function findDatesWithSlots(
  equipmentId: string,
  startDate: DateKey,
  endDate: DateKey,
  requestHeaders: HeadersInit,
): Promise<Set<DateKey> | null> {
  try {
    const found = await collectSlicePages(
      (page) =>
        searchSlots(
          { from: `${startDate}T00:00:00+09:00`, to: `${addDays(endDate, 1)}T00:00:00+09:00`, equipmentId, page, size: SLOT_SEARCH_MAX_SIZE },
          { headers: requestHeaders },
        ),
      LOOKUP_MAX_PAGES * 2,
    );
    if (!found.ok) return null;
    const dates = new Set<DateKey>();
    for (const slot of found.items) {
      const minute = seoulMinute(slot.startsAt);
      dates.add(minute.slice(0, 10));
    }
    return dates;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[slots] 기존 슬롯 확인 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
    return null;
  }
}

/**
 * 기간 슬롯 생성: 기간(최대 14일)의 운영일마다 하루 생성 API를 차례로 1회씩 부른다 (여러 날짜를 한 트랜잭션으로 묶지 않는다).
 * 순서: 기능 설정 → users/me(EXAMINER) → 입력·기간 확인 → 장비 소속·상태·검사 유형·소요 시간·운영시간 → 기존 슬롯 조회 → 날짜별 POST
 * - 운영하지 않는 요일은 SKIPPED (요청 안 함). 이미 슬롯이 있는 날은 CONFLICT (요청 안 함, 기존 슬롯을 지우거나 덮어쓰지 않음)
 * - 날짜 하나가 실패해도 전체를 실패로 보지 않고 날짜별로 기록한다
 * - 401·403·네트워크·타임아웃·응답 형식 오류가 나면 남은 날짜는 요청하지 않고 NOT_PROCESSED로 남긴다
 *   타임아웃·연결 끊김·응답 형식 오류 날짜는 UNKNOWN (같은 POST를 자동으로 다시 보내지 않는다)
 */
/** expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값. 다르면 장비·운영시간·기존 슬롯 확인과 날짜별 POST를 하나도 하지 않는다 */
export async function submitSlotRangeGeneration(input: unknown, expectedLoginSession?: unknown): Promise<SlotRangeGenerationResult> {
  if (!isAvailable()) return NOT_AVAILABLE;
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (!access.ok) return access.reason === "SESSION_CHANGED" ? sessionChanged(access.message) : accessFailure(access);

  const data = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  // 장비·검사 유형 ID 확인은 하루 생성과 같은 검증을 쓴다 (날짜 자리에 시작일)
  const validation = validateSlotGenerateRequest({ equipmentId: data.equipmentId, examTypeId: data.examTypeId, date: data.startDate });
  if (!validation.ok && validation.field !== "date") return { ok: false, reason: "INVALID", message: validation.message, field: validation.field };
  const rangeError = validateGenerationRange(data.startDate, data.endDate, getSeoulNow().dateKey, API_SEARCH_MAX_LOOKAHEAD_DAYS);
  if (rangeError) return { ok: false, reason: "INVALID", message: rangeError.message, field: rangeError.field };
  const equipmentId = data.equipmentId as string;
  const examTypeId = data.examTypeId as string;
  const startDate = data.startDate as DateKey;
  const endDate = data.endDate as DateKey;

  const context = await loadOwnedContext(equipmentId, access);
  if (!context.ok) return context;
  const blocked = checkGenerationContext(context, examTypeId);
  if (blocked) return blocked;

  const dates = listRangeDates(startDate, endDate);
  const { targets } = splitOperatingDates(dates, new Set(context.hours.map((day) => day.weekday)));
  if (targets.length === 0) {
    return { ok: false, reason: "INVALID", message: "선택한 기간에 장비가 운영하는 날이 없습니다. 운영 요일이 포함되도록 기간을 바꿔 주세요.", field: "endDate" };
  }
  const existing = await findDatesWithSlots(equipmentId, startDate, endDate, access.headers);
  if (!existing) {
    return { ok: false, reason: "ERROR", message: "기존 슬롯을 확인하지 못해 생성하지 않았습니다. 잠시 후 다시 시도해 주세요." };
  }

  const targetSet = new Set(targets);
  const days: GenerationDayResult[] = [];
  let stoppedReason: string | null = null;
  for (const date of dates) {
    if (!targetSet.has(date)) {
      days.push({ date, status: "SKIPPED", message: "운영하지 않는 요일", slots: [] });
      continue;
    }
    if (stoppedReason) {
      days.push({ date, status: "NOT_PROCESSED", message: "앞 날짜의 오류로 요청하지 않았습니다.", slots: [] });
      continue;
    }
    if (existing.has(date)) {
      days.push({ date, status: "CONFLICT", message: "이미 이 장비의 슬롯이 있어 만들지 않았습니다.", slots: [] });
      continue;
    }
    const posted = await postOneDay({ equipmentId, examTypeId, date }, access.headers);
    if (posted.ok) {
      days.push({ date, status: "SUCCESS", message: `슬롯 ${posted.slots.length}개`, slots: posted.slots });
      continue;
    }
    const { reason, message } = posted.failure;
    days.push({
      date,
      status: UNKNOWN_REASONS.has(reason) ? "UNKNOWN" : reason === "CONFLICT" ? "CONFLICT" : "FAILED",
      message: UNKNOWN_REASONS.has(reason) ? `생성 여부를 확인할 수 없습니다. 서버에서 확인해 주세요. (${message})` : message,
      slots: [],
    });
    if (STOP_REASONS.has(reason)) stoppedReason = message;
  }
  return { ok: true, equipmentId, examTypeId, startDate, endDate, days, summary: summarizeGeneration(days.map((day) => ({ status: day.status, slotCount: day.slots.length }))), stoppedReason };
}

/** 한 번의 확인 조회에서 받을 최대 슬롯 페이지 (100건 × 5) */
const LOOKUP_MAX_PAGES = 5;

/**
 * 생성 결과 재확인: 그날 이 장비·검사 유형의 예약 가능 슬롯을 슬롯 검색 API(view=SEARCH)로 다시 조회한다 (새로고침 뒤에도 서버 값으로 확인).
 * 장비가 우리 기관 것인지 먼저 확인한다. 시작 전인 AVAILABLE 슬롯만 온다 (예약된 슬롯·지난 시각은 빠진다).
 */
export async function loadGeneratedSlots(equipmentId: unknown, examTypeId: unknown, date: unknown): Promise<GeneratedSlotsLookupResult> {
  if (!isAvailable()) return NOT_AVAILABLE;
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return accessFailure(access);
  const validation = validateSlotGenerateRequest({ equipmentId, examTypeId, date });
  if (!validation.ok) return { ok: false, reason: "INVALID", message: validation.message, field: validation.field };
  const { body } = validation;
  const options = { headers: access.headers };
  try {
    const equipment = await fetchEquipment(body.equipmentId, options);
    if (!sameId(equipment.institutionId, access.user.institutionId)) {
      return { ok: false, reason: "FORBIDDEN", message: "우리 기관 장비의 슬롯만 확인할 수 있습니다." };
    }
    const found = await collectSlicePages(
      (page) =>
        searchSlots(
          {
            from: `${body.date}T00:00:00+09:00`,
            to: `${addDays(body.date, 1)}T00:00:00+09:00`,
            equipmentId: body.equipmentId,
            examTypeId: body.examTypeId,
            page,
            size: SLOT_SEARCH_MAX_SIZE,
          },
          options,
        ),
      LOOKUP_MAX_PAGES,
    );
    if (!found.ok) return { ok: false, reason: "ERROR", message: "슬롯이 너무 많아 모두 확인하지 못했습니다." };
    const slots = found.items
      .map((slot) => toGeneratedSlot({ ...slot }, seoulMinute))
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
    return { ok: true, slots };
  } catch (error) {
    unstable_rethrow(error);
    const failure = getSlotGenerateFailure(error);
    console.error("[slots] 생성 슬롯 확인 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
    return { ok: false, reason: failure.reason, message: failure.reason === "UNAUTHORIZED" ? failure.message : "슬롯 현황을 다시 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
