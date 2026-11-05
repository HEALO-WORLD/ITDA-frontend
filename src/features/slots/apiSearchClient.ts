import { addDays, addMonths, toDateKey, type DateKey } from "@/lib/date/seoulDate";

import type { ApiExamSlot } from "./apiSlots";
import { getTimeOfDay } from "./availability";
import type { ExamType, SlotSearchCriteria } from "./types";

/**
 * 슬롯 검색 화면(API 모드) ↔ Next GET Route Handler `/referring/slots/search` (브라우저·서버 공통, server-only 아님).
 *
 * 브라우저는 Gateway를 직접 부르지 않는다: 같은 출처의 Route Handler가 HttpOnly 쿠키의 JWT로 users/me(REQUESTER)를 확인한 뒤
 * loadApiSlotSearch로 조회한다. 브라우저가 보내는 값은 검색 기간·검사기관 UUID·CT/MRI뿐이고 사용자·기관 ID는 보내지 않는다.
 * 응답에는 슬롯 화면 데이터만 있다 (토큰·서버 오류 본문 없음).
 */

export const SLOT_SEARCH_ROUTE = "/referring/slots/search";
/** 서버 최대 검색 기간 (백엔드 SlotService 31일). remote.ts의 SLOT_SEARCH_MAX_RANGE_DAYS와 같다 */
export const API_SEARCH_RANGE_DAYS = 31;
/**
 * 검색할 수 있는 서울 날짜 범위: 어제(자정 직후 브라우저·서버 날짜 차이 허용)부터 오늘 + 이 일수까지 (서버 server.ts가 검사한다).
 * 달력은 월 단위로 앞으로 이동할 수 있어 31일보다 길지만, 무제한으로 미래를 조회하지는 않는다
 */
export const API_SEARCH_MAX_LOOKAHEAD_DAYS = 366;
/** 브라우저 쪽 응답 대기 한도(ms). 서버는 여러 Gateway 요청(협약·검사 유형·장비·슬롯 페이지)을 모아 응답한다 */
export const SLOT_SEARCH_CLIENT_TIMEOUT_MS = 30_000;

export interface SlotSearchRouteParams {
  /** 서울 날짜 (포함) */
  startDate: DateKey;
  /** 서울 날짜 (제외). startDate부터 31일 이하 */
  endDateExclusive: DateKey;
  institutionId?: string;
  modality?: ExamType;
}

/** Route Handler 성공 응답 */
export interface SlotSearchRouteSuccess {
  ok: true;
  slots: ApiExamSlot[];
  window: { startDate: DateKey; endDateExclusive: DateKey };
  /** 이번 조회의 Gateway 요청 수 (users/me 제외). 성능 확인용 */
  requestCount: number;
}

/** Route Handler 실패 응답 (reason은 server.ts의 SlotSearchLoadFailureReason) */
export interface SlotSearchRouteFailure {
  ok: false;
  reason: string;
  message: string;
}

/** 화면이 구분하는 실패 */
export type SlotSearchClientFailureReason =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "PARSE"
  | "TOO_MANY_RESULTS"
  | "NOT_AVAILABLE"
  /** 화면이 취소함 (새 검색·초기화·화면 이동). 안내하지 않는다 */
  | "ABORTED";

export type SlotSearchClientFailure = { ok: false; reason: SlotSearchClientFailureReason; message: string };
export type SlotSearchClientResult = SlotSearchRouteSuccess | SlotSearchClientFailure;

export const SLOT_SEARCH_FAILURE_MESSAGES: Record<SlotSearchClientFailureReason, string> = {
  INVALID_REQUEST: "검색 조건이 올바르지 않습니다. 조건을 확인한 뒤 다시 검색해 주세요.",
  UNAUTHORIZED: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.",
  FORBIDDEN: "검사 슬롯을 검색할 권한이 없습니다. 의뢰기관 계정으로 로그인했는지 확인해 주세요.",
  SERVER_ERROR: "서버 오류로 검사 슬롯을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.",
  TIMEOUT: "응답이 지연되어 검색을 중단했습니다. 잠시 후 다시 검색해 주세요.",
  NETWORK: "서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 검색해 주세요.",
  PARSE: "서버 응답을 확인할 수 없어 결과를 표시하지 않았습니다. 잠시 후 다시 검색해 주세요.",
  TOO_MANY_RESULTS: "검색 결과가 너무 많아 모두 불러오지 못했습니다. 날짜·검사기관·검사 유형을 좁혀 다시 검색해 주세요.",
  NOT_AVAILABLE: "슬롯 검색 API가 아직 연결되지 않았습니다.",
  ABORTED: "검색을 취소했습니다.",
};

// ── 검색 기간 (서울 날짜) ──

export interface SearchDateWindow {
  startDate: DateKey;
  endDateExclusive: DateKey;
}

/** 검색 버튼: 날짜를 고르면 그 날짜 하루, 없으면 오늘부터 31일 (무제한 검색 금지) */
export function getCriteriaSearchWindow(date: DateKey | "", today: DateKey): SearchDateWindow {
  if (date) return { startDate: date, endDateExclusive: addDays(date, 1) };
  return { startDate: today, endDateExclusive: addDays(today, API_SEARCH_RANGE_DAYS) };
}

/** `YYYY-MM` */
export const toMonthKey = (year: number, month: number) => toDateKey(year, month, 1).slice(0, 7);

/**
 * 달력 표시 월의 조회 기간: 그 달 1일(이번 달이면 오늘)부터 다음 달 1일까지 (최대 31일, 한 번에 조회).
 * 다 지난 달이면 null (조회하지 않는다)
 */
export function getMonthSearchWindow(year: number, month: number, today: DateKey): SearchDateWindow | null {
  const first = toDateKey(year, month, 1);
  const next = addMonths(first, 1);
  if (next <= today) return null;
  // 한 달은 31일 이하이므로 서버 검색 기간 제한을 넘지 않는다
  return { startDate: first < today ? today : first, endDateExclusive: next };
}

export function buildSlotSearchUrl(params: SlotSearchRouteParams): string {
  const query = new URLSearchParams({ startDate: params.startDate, endDateExclusive: params.endDateExclusive });
  if (params.institutionId) query.set("institutionId", params.institutionId);
  if (params.modality) query.set("modality", params.modality);
  return `${SLOT_SEARCH_ROUTE}?${query.toString()}`;
}

// ── 응답 해석 ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function isApiExamSlot(value: unknown): value is ApiExamSlot {
  if (typeof value !== "object" || value === null) return false;
  const slot = value as Record<string, unknown>;
  return (
    typeof slot.id === "string" && UUID.test(slot.id) &&
    typeof slot.organizationId === "string" && UUID.test(slot.organizationId) &&
    typeof slot.equipmentId === "string" && UUID.test(slot.equipmentId) &&
    typeof slot.examTypeId === "string" && UUID.test(slot.examTypeId) &&
    isText(slot.organizationName) &&
    isText(slot.equipmentName) &&
    isText(slot.examTypeName) &&
    (slot.examType === "CT" || slot.examType === "MRI") &&
    typeof slot.startAt === "string" && MINUTE.test(slot.startAt) &&
    typeof slot.endAt === "string" && MINUTE.test(slot.endAt) &&
    isText(slot.startsAt) &&
    isText(slot.endsAt) &&
    slot.status === "AVAILABLE" &&
    slot.isAvailable === true
  );
}

/** 서버 실패 구분(SlotSearchLoadFailureReason) → 화면 구분 */
const CLIENT_REASON_BY_SERVER_REASON: Record<string, SlotSearchClientFailureReason> = {
  NOT_AVAILABLE: "NOT_AVAILABLE",
  SIGNED_OUT: "UNAUTHORIZED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_INPUT: "INVALID_REQUEST",
  INVALID_REQUEST: "INVALID_REQUEST",
  CONFLICT: "SERVER_ERROR",
  NETWORK: "NETWORK",
  TIMEOUT: "TIMEOUT",
  SERVER_ERROR: "SERVER_ERROR",
  INVALID_RESPONSE: "PARSE",
  METADATA_MISSING: "PARSE",
  METADATA_MISMATCH: "PARSE",
  INVALID_TIME: "PARSE",
  TOO_MANY_RESULTS: "TOO_MANY_RESULTS",
  ERROR: "SERVER_ERROR",
};

/** 본문을 해석하지 못했을 때 HTTP 상태로만 구분 */
function reasonFromStatus(status: number): SlotSearchClientFailureReason {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 504) return "TIMEOUT";
  if (status >= 500) return "SERVER_ERROR";
  return "PARSE";
}

/** 검색 조건을 직접 안내하는 서버 메시지만 화면에 그대로 쓴다 (그 밖은 화면 문구) */
const USES_SERVER_MESSAGE: ReadonlySet<SlotSearchClientFailureReason> = new Set(["INVALID_REQUEST", "TOO_MANY_RESULTS"]);

const failure = (reason: SlotSearchClientFailureReason, serverMessage?: unknown): SlotSearchClientFailure => ({
  ok: false,
  reason,
  message:
    USES_SERVER_MESSAGE.has(reason) && typeof serverMessage === "string" && serverMessage.length > 0 && serverMessage.length <= 200
      ? serverMessage
      : SLOT_SEARCH_FAILURE_MESSAGES[reason],
});

/**
 * Route Handler 응답(HTTP 상태 + JSON 본문) → 화면 결과.
 * 성공 응답도 형식·요청 기간을 확인한다: 하나라도 맞지 않으면 일부만 보여 주지 않고 PARSE 실패.
 */
export function parseSlotSearchResponse(status: number, body: unknown, requested: SearchDateWindow): SlotSearchClientResult {
  if (typeof body !== "object" || body === null) return failure(status >= 200 && status < 300 ? "PARSE" : reasonFromStatus(status));
  const data = body as Record<string, unknown>;
  if (data.ok === false) {
    const reason = typeof data.reason === "string" ? CLIENT_REASON_BY_SERVER_REASON[data.reason] : undefined;
    return failure(reason ?? reasonFromStatus(status), data.message);
  }
  if (status !== 200 || data.ok !== true) return failure(status >= 300 ? reasonFromStatus(status) : "PARSE");

  const window = data.window as Record<string, unknown> | null | undefined;
  if (
    typeof window !== "object" || window === null ||
    window.startDate !== requested.startDate || window.endDateExclusive !== requested.endDateExclusive ||
    !Array.isArray(data.slots) || !data.slots.every(isApiExamSlot) ||
    !Number.isSafeInteger(data.requestCount)
  ) {
    return failure("PARSE");
  }
  const slots = data.slots as ApiExamSlot[];
  // 요청한 기간 밖의 슬롯이 있으면 계약 위반
  const outside = slots.some((slot) => {
    const date = slot.startAt.slice(0, 10);
    return !DATE.test(date) || date < requested.startDate || date >= requested.endDateExclusive;
  });
  if (outside) return failure("PARSE");
  return { ok: true, slots, window: { startDate: requested.startDate, endDateExclusive: requested.endDateExclusive }, requestCount: data.requestCount as number };
}

export interface FetchSlotSearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 테스트용 */
  fetchImpl?: typeof fetch;
}

/**
 * Route Handler 호출 (같은 출처, 쿠키는 브라우저가 붙인다). 오류를 던지지 않고 결과로 돌려준다.
 * 캐시하지 않는다 (cache: "no-store"). 호출한 쪽의 signal로 취소하면 ABORTED, 제한 시간을 넘기면 TIMEOUT.
 */
export async function fetchApiSlotSearch(params: SlotSearchRouteParams, options: FetchSlotSearchOptions = {}): Promise<SlotSearchClientResult> {
  const { signal, timeoutMs = SLOT_SEARCH_CLIENT_TIMEOUT_MS, fetchImpl = fetch } = options;
  if (signal?.aborted) return failure("ABORTED");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchImpl(buildSlotSearchUrl(params), {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return failure(timedOut ? "TIMEOUT" : signal?.aborted ? "ABORTED" : "NETWORK");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (timedOut) return failure("TIMEOUT");
      if (signal?.aborted) return failure("ABORTED");
      body = null;
    }
    return parseSlotSearchResponse(response.status, body, params);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ── 받은 결과 거르기 (화면 조건) ──

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** 검사 종류·검사기관·시간대 조건 (날짜 제외). 기관 UUID는 대소문자를 구분하지 않는다 */
export function matchesApiSlotFilter(
  slot: ApiExamSlot,
  filter: Pick<SlotSearchCriteria, "examType" | "organizationId" | "timeOfDay">,
): boolean {
  return (
    (!filter.examType || slot.examType === filter.examType) &&
    (!filter.organizationId || sameId(slot.organizationId, filter.organizationId)) &&
    (!filter.timeOfDay || getTimeOfDay(slot.startAt) === filter.timeOfDay)
  );
}

/**
 * 검색 결과 표시용 거르기: 화면 조건 + 이미 시작한 슬롯 제외 (응답 뒤 시간이 지났을 수 있다).
 * `예약 가능한 슬롯만 보기`: SEARCH 응답은 AVAILABLE만 오므로 결과가 같다 (isAvailable도 다시 확인한다).
 */
export function filterApiSearchResults(slots: readonly ApiExamSlot[], criteria: SlotSearchCriteria, nowDateTime: string): ApiExamSlot[] {
  return slots.filter(
    (slot) =>
      matchesApiSlotFilter(slot, criteria) &&
      (!criteria.date || slot.startAt.startsWith(criteria.date)) &&
      slot.startAt > nowDateTime &&
      (!criteria.availableOnly || slot.isAvailable),
  );
}

/** 달력: 날짜별 예약 가능 슬롯 수 (조건 + 아직 시작하지 않은 슬롯). 없는 날짜 = 예약 가능한 슬롯 없음 */
export function countApiSlotsByDate(
  slots: readonly ApiExamSlot[],
  filter: Pick<SlotSearchCriteria, "examType" | "organizationId" | "timeOfDay">,
  nowDateTime: string,
): Record<DateKey, number> {
  const counts: Record<DateKey, number> = {};
  for (const slot of slots) {
    if (!slot.isAvailable || slot.startAt <= nowDateTime || !matchesApiSlotFilter(slot, filter)) continue;
    const date = slot.startAt.slice(0, 10);
    counts[date] = (counts[date] ?? 0) + 1;
  }
  return counts;
}

/**
 * 가장 최근 요청만 반영하기 위한 순번 (조건을 빠르게 바꿔도 오래된 응답이 최신 결과를 덮어쓰지 않게 한다).
 * start()가 돌려준 함수가 true일 때만 결과를 반영한다. cancel()은 진행 중 요청을 모두 무효로 만든다.
 */
export function createLatestGuard() {
  let current = 0;
  let controller: AbortController | null = null;
  return {
    start() {
      controller?.abort();
      const next = new AbortController();
      controller = next;
      const id = ++current;
      return { signal: next.signal, isLatest: () => id === current };
    },
    cancel() {
      controller?.abort();
      controller = null;
      current++;
    },
  };
}
