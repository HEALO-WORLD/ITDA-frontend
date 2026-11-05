import { addDays, addMonths, getDaysInMonth, parseDateKey, toDateKey, type DateKey } from "@/lib/date/seoulDate";

import type { DayStatus } from "@/features/equipment/dayStatus";
import { buildMonthDayStatuses } from "@/features/equipment/dayStatus";

import { API_SEARCH_MAX_LOOKAHEAD_DAYS } from "./apiSearchClient";
import { isBookableSlot } from "./availability";
import type { ApiExamSlot } from "./apiSlots";
import type { SlotStatusDto } from "./remote";

/**
 * 검사기관 슬롯 관리 달력(API 모드)의 월 단위 데이터 (브라우저·서버 공통, server-only 아님).
 * - 조회 기간: 오늘 기준 3달 전 1일 ~ 1년 뒤 달 (지난 슬롯도 관리 목적으로 본다)
 * - 월 캐시(createMonthSlotStore): 받은 달은 다시 요청하지 않고, 슬롯 생성 뒤에는 invalidate로 다시 받는다.
 *   늦게 도착한 이전 요청 응답은 버전으로 걸러 최신 값을 덮어쓰지 않는다. 실패는 저장하지 않고 다시 시도할 수 있다
 */

export const MANAGEMENT_PAST_MONTHS = 3;

/** 조회할 수 있는 달 (그 달 1일) */
export function getManagementMonthRange(today: DateKey): { first: DateKey; last: DateKey } {
  const thisMonth = `${today.slice(0, 7)}-01`;
  return { first: addMonths(thisMonth, -MANAGEMENT_PAST_MONTHS), last: `${addDays(today, API_SEARCH_MAX_LOOKAHEAD_DAYS).slice(0, 7)}-01` };
}

/** 달력 날짜 범위 (조회 가능한 첫 달 1일 ~ 마지막 달 말일) */
export function getManagementDayRange(today: DateKey): { start: DateKey; end: DateKey } {
  const { first, last } = getManagementMonthRange(today);
  const { year, month } = parseDateKey(last);
  return { start: first, end: toDateKey(year, month, getDaysInMonth(year, month)) };
}

export type MonthSlotsFailureReason = string;

export type MonthSlotsState =
  | { status: "loading" }
  | { status: "loaded"; slots: ApiExamSlot[] }
  | { status: "error"; reason: MonthSlotsFailureReason; message: string };

type MonthLoader = (monthStart: DateKey) => Promise<{ ok: true; slots: ApiExamSlot[] } | { ok: false; reason: string; message: string }>;

const NETWORK_FAILURE = { ok: false as const, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요." };

/**
 * 월별 슬롯 캐시 (React 밖 저장소, useSyncExternalStore로 읽는다).
 * request(달): 없는 달만 요청한다. retry(달): 실패한 달만 다시. invalidate(): 모든 달을 버리고 진행 중 응답도 무시한다
 */
export function createMonthSlotStore(load: MonthLoader) {
  let states: Readonly<Record<DateKey, MonthSlotsState>> = {};
  const versions = new Map<DateKey, number>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const set = (month: DateKey, state: MonthSlotsState) => {
    states = { ...states, [month]: state };
    emit();
  };

  const load_ = (month: DateKey) => {
    const version = (versions.get(month) ?? 0) + 1;
    versions.set(month, version);
    set(month, { status: "loading" });
    load(month).then(
      (result) => {
        if (versions.get(month) !== version) return; // 더 최근 요청·무효화가 있으면 버린다
        set(month, result.ok ? { status: "loaded", slots: result.slots } : { status: "error", reason: result.reason, message: result.message });
      },
      () => {
        if (versions.get(month) !== version) return;
        set(month, { status: "error", reason: NETWORK_FAILURE.reason, message: NETWORK_FAILURE.message });
      },
    );
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => states,
    /** 아직 없는 달만 요청한다 (받은 달·요청 중·실패한 달은 그대로. 실패는 retry로만 다시 요청해 자동 반복 요청을 막는다) */
    request(month: DateKey) {
      if (!states[month]) load_(month);
    },
    /** 실패한 달 다시 시도 */
    retry(month: DateKey) {
      if (states[month]?.status === "error") load_(month);
    },
    /** 슬롯 생성 등으로 서버 값이 바뀌었을 때: 모든 달을 버리고(진행 중 응답 무시) 다시 받게 한다 */
    invalidate() {
      for (const month of Object.keys(states)) versions.set(month, (versions.get(month) ?? 0) + 1);
      states = {};
      emit();
    },
  };
}

export type MonthSlotStore = ReturnType<typeof createMonthSlotStore>;

export type TodayAvailableCount =
  | { status: "loading" }
  | { status: "loaded"; count: number }
  | { status: "error"; message: string };

/**
 * 오늘 예약 가능 슬롯 수 (요약 바). 오늘이 속한 달의 월 캐시 값만 쓴다 (추가 요청 없음).
 * Mock의 isBookableSlot과 같은 기준: 서버 상태 AVAILABLE + 시작 시각이 지금(서울, 분 단위) 이후.
 * 기관 범위: 우리 기관(institutionIds) 장비 슬롯만. 화면의 장비 검색·선택과 관계없이 센다.
 * 조회 전·요청 중은 loading, 실패는 error (0건으로 바꾸지 않는다).
 */
export function countTodayAvailableSlots(
  state: MonthSlotsState | undefined,
  { today, nowDateTime, institutionIds }: { today: DateKey; nowDateTime: string; institutionIds: ReadonlySet<string> },
): TodayAvailableCount {
  if (!state || state.status === "loading") return { status: "loading" };
  if (state.status === "error") return { status: "error", message: state.message };
  const count = state.slots.filter(
    (slot) =>
      slot.startAt.slice(0, 10) === today &&
      slot.status === "AVAILABLE" &&
      isBookableSlot(slot, nowDateTime) &&
      institutionIds.has(slot.organizationId.toLowerCase()),
  ).length;
  return { status: "loaded", count };
}

/**
 * 달력 날짜 상태 (조회 대상 장비 기준). 받은 달: 기존 buildMonthDayStatuses 그대로
 * (예약 가능 수·전체 수, 슬롯은 있지만 모두 예약 불가, 실제 빈 날짜 = 슬롯 없음).
 * 운영 요일을 모르는 장비가 섞일 수 있어 빈 날짜를 '휴무'로 단정하지 않는다 (scopeEquipments의 운영시간을 비워 넘긴다).
 * 불러오는 중: LOADING. 실패: UNKNOWN (0건·슬롯 없음으로 표시하지 않는다)
 */
export function buildApiMonthDayStatuses(
  monthStart: DateKey,
  state: MonthSlotsState | undefined,
  scopeEquipmentIds: readonly string[],
  range: { start: DateKey; end: DateKey },
  nowDateTime: string,
): Map<DateKey, DayStatus> {
  const scopeEquipments = scopeEquipmentIds.map((id) => ({ id, operatingHours: [] }));
  if (state?.status === "loaded") return buildMonthDayStatuses(monthStart, state.slots, { range, scopeEquipments, nowDateTime });
  const statuses = buildMonthDayStatuses(monthStart, undefined, { range, scopeEquipments, nowDateTime });
  if (state?.status === "error") {
    for (const [key, status] of statuses) if (status.kind === "LOADING") statuses.set(key, { kind: "UNKNOWN" });
  }
  return statuses;
}

/** 서버 슬롯 상태 표시 (원본 상태를 그대로 보여 주고, 지난 슬롯은 따로 표시한다) */
export const API_SLOT_STATUS_META: Record<SlotStatusDto, { label: string; className: string }> = {
  AVAILABLE: { label: "예약 가능", className: "bg-primary-soft text-primary" },
  HELD: { label: "선점 중", className: "bg-amber-50 text-amber-800" },
  BOOKED: { label: "예약 완료", className: "bg-emerald-50 text-emerald-700" },
  UNAVAILABLE: { label: "사용 불가", className: "bg-gray-100 text-gray-600" },
};

export function getApiSlotStatusView(slot: Pick<ApiExamSlot, "status" | "startAt">, nowDateTime: string): { label: string; className: string; isPast: boolean } {
  const meta = API_SLOT_STATUS_META[slot.status];
  return { ...meta, isPast: slot.startAt <= nowDateTime };
}

// ── 선택 날짜의 슬롯 목록: 필터·페이지 (받은 월 데이터에서만 계산, 서버 재요청 없음) ──

/** 목록 한 페이지 건수 */
export const DAY_SLOT_PAGE_SIZE = 10;

export interface DaySlotFilters {
  /** 장비 종류 (서버 장비 데이터의 modality 기준) */
  modality: "" | "CT" | "MRI";
  /** 서버 원본 상태 (지난 시간이어도 바꾸지 않는다) */
  status: "" | SlotStatusDto;
  /** 시작 시각(서울) 기준. 오전 00:00~11:59 · 오후 12:00~23:59 */
  timeOfDay: "" | "AM" | "PM";
}

export const EMPTY_DAY_SLOT_FILTERS: DaySlotFilters = { modality: "", status: "", timeOfDay: "" };

export const isDaySlotFiltered = (filters: DaySlotFilters) => Boolean(filters.modality || filters.status || filters.timeOfDay);

export interface DaySlotView {
  /** 선택 날짜 · 조회 대상 장비(상단 선택)의 전체 슬롯 수 (필터 전) */
  total: number;
  /** 필터 결과 수 */
  filtered: number;
  /** 이 페이지 슬롯 (시작 시각 → 장비명 → ID 순) */
  items: ApiExamSlot[];
  /** 1부터. 범위를 넘으면 마지막 페이지로 맞춘다 */
  page: number;
  totalPages: number;
  /** 필터 전 슬롯이 있지만 모두 AVAILABLE이 아님 */
  allUnavailable: boolean;
  /** 같은 날 조회 대상 밖(다른 장비) 슬롯 수 */
  otherEquipmentCount: number;
}

/**
 * 선택 날짜 슬롯 목록 계산. 적용 순서: 상단 장비 선택·검색(scopeEquipmentIds) → 날짜 → CT/MRI → 상태 → 오전/오후 → 정렬 → 페이지.
 * 달력 집계(buildApiMonthDayStatuses)와는 별개다: 이 필터는 달력 수치에 영향을 주지 않는다.
 */
export function buildDaySlotView(input: {
  monthSlots: readonly ApiExamSlot[];
  date: DateKey;
  scopeEquipmentIds: readonly string[];
  /** 장비 ID(소문자) → 서버 장비 modality */
  equipmentModality: ReadonlyMap<string, "CT" | "MRI">;
  filters: DaySlotFilters;
  page: number;
  pageSize?: number;
}): DaySlotView {
  const { monthSlots, date, filters, pageSize = DAY_SLOT_PAGE_SIZE } = input;
  const scope = new Set(input.scopeEquipmentIds.map((id) => id.toLowerCase()));
  const daySlots = monthSlots.filter((slot) => slot.startAt.slice(0, 10) === date);
  const scoped = daySlots.filter((slot) => scope.has(slot.equipmentId.toLowerCase()));
  const filteredSlots = scoped
    .filter((slot) => !filters.modality || input.equipmentModality.get(slot.equipmentId.toLowerCase()) === filters.modality)
    .filter((slot) => !filters.status || slot.status === filters.status)
    .filter((slot) => !filters.timeOfDay || (slot.startAt.slice(11, 16) < "12:00" ? "AM" : "PM") === filters.timeOfDay)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.equipmentName.localeCompare(b.equipmentName, "ko") || a.id.localeCompare(b.id));
  const totalPages = Math.max(1, Math.ceil(filteredSlots.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(input.page) || 1), totalPages);
  return {
    total: scoped.length,
    filtered: filteredSlots.length,
    items: filteredSlots.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages,
    allUnavailable: scoped.length > 0 && scoped.every((slot) => slot.status !== "AVAILABLE"),
    otherEquipmentCount: daySlots.length - scoped.length,
  };
}
