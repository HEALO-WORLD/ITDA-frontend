import { RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { useSlotDataKey } from "@/features/equipment/useLiveEquipments";
import { fieldLabelClass, SelectInput, type SelectOption } from "@/components/ui/FormControls";
import type { DateKey } from "@/lib/date/seoulDate";

import { getSeoulNow } from "@/lib/date/seoulDate";

import { getDateAvailability } from "../api";
import { API_SEARCH_RANGE_DAYS, countApiSlotsByDate, toMonthKey } from "../apiSearchClient";
import type { AvailabilityFilter, DateAvailability } from "../availability";
import { getExamTypeChoices, reconcileExamTypeId, type SlotExamTypeOption } from "../examTypeFilter";
import type { ExamType, PartnerOrganization, SlotSearchCriteria, TimeOfDay } from "../types";
import { useApiSlotCalendar, type ApiCalendarMonthState } from "../useApiSlotCalendar";

interface SlotSearchFilterProps {
  organizations: PartnerOrganization[];
  isSearching: boolean;
  onSearch: (criteria: SlotSearchCriteria) => void;
  /** 조건을 처음 상태로 되돌렸을 때 (이전 검색 결과 정리용) */
  onReset?: () => void;
  /** 처음 표시할 검색 조건 (재조정 모드에서 기존 예약의 검사 유형). 초기화도 이 조건으로 돌아간다 */
  initialCriteria?: SlotSearchCriteria;
  /** 검사 유형 변경 불가 (재조정 모드) */
  isExamTypeLocked?: boolean;
  /** 달력 가용 날짜 계산에서 제외할 장비 ID (재조정 모드의 장애 장비) */
  excludedEquipmentIds?: readonly string[];
  /**
   * 달력 데이터 출처. mock(기본): 기존 Mock 계산. api: 표시 중인 월의 실제 예약 가능 슬롯 (Route Handler 경유)
   * API 모드에서는 Mock 함수(getDateAvailability)를 부르지 않는다
   */
  dataSource?: "mock" | "api";
  /** API 재조정 모드: 달력 조회를 이 검사 유형으로 고정한다 */
  apiExamTypeId?: string;
  /**
   * 세부 검사 항목 선택지 원본 (ExamType: 협력 기관 장비가 실제 지원하는 검사 유형. Mock: 개발용 장비의 지원 검사 유형).
   * null = 목록을 불러오지 못함 (선택 비활성). 검사 유형(CT/MRI)·협력 검사기관 조건에 맞는 항목만 보인다
   */
  examTypeOptions?: readonly SlotExamTypeOption[] | null;
  /** 재조정: 세부 검사 항목을 이 항목으로 고정한다 (변경 불가. 기존 의뢰와 다른 항목의 슬롯은 검색하지 않는다) */
  lockedExamTypeItem?: { id: string; name: string } | null;
}

const EXAM_TYPE_OPTIONS: SelectOption[] = [
  { value: "", label: "전체" },
  { value: "CT", label: "CT" },
  { value: "MRI", label: "MRI" },
];

const TIME_OF_DAY_OPTIONS: { value: TimeOfDay | ""; label: string }[] = [
  { value: "", label: "전체" },
  { value: "AM", label: "오전" },
  { value: "PM", label: "오후" },
];

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = { AM: "오전", PM: "오후" };

export const INITIAL_SLOT_CRITERIA: SlotSearchCriteria = {
  examType: "",
  date: "",
  organizationId: "",
  timeOfDay: "",
  availableOnly: false,
  examTypeId: "",
};

const DISABLED_REASON = {
  FULL: "예약 마감",
  NONE: "검사 슬롯 없음",
} as const;

/**
 * API 모드 달력의 선택 불가 사유. SEARCH 응답은 예약 가능한 슬롯만 오므로 '마감'과 '슬롯 없음'을 구분할 수 없다:
 * 마감이라고 하지 않고 '예약 가능한 슬롯 없음'으로만 표시한다. 조회 실패는 '없음'과 따로 표시한다
 */
const API_DISABLED_REASON = {
  LOADING: "예약 가능 날짜 확인 중",
  ERROR: "예약 가능 날짜를 불러오지 못함",
  OUT_OF_RANGE: "검색할 수 있는 기간이 아님",
  NONE: "예약 가능한 슬롯 없음",
} as const;

/** API 모드 달력 안내 (범례 아래). 표시 중인 월의 조회 상태를 알린다 */
function getApiCalendarNote(state: ApiCalendarMonthState | undefined, timeOfDay: TimeOfDay | ""): string {
  if (!state || state.status === "loading") return "예약 가능 날짜를 확인하고 있습니다.";
  if (state.status === "error") {
    return `예약 가능 날짜를 불러오지 못해 이 달의 날짜를 선택할 수 없습니다. ${state.message} (달력을 다시 열면 다시 시도합니다.)`;
  }
  if (state.status === "out-of-range") return "검색할 수 있는 기간(오늘부터 1년 이내)이 아닙니다.";
  return timeOfDay
    ? `${TIME_OF_DAY_LABELS[timeOfDay]}에 예약 가능한 슬롯이 있는 날짜만 선택할 수 있습니다.`
    : "예약 가능한 슬롯이 있는 날짜만 선택할 수 있습니다.";
}

/**
 * 검색 조건 입력. 조건 변경은 내부 상태에만 반영하고, 검색 버튼을 눌러야 상위로 전달한다.
 * 달력의 날짜 선택 가능 여부는 검색 결과와 같은 판정(검사 유형·기관·시간대)으로, 조건이 바뀔 때마다 다시 계산한다.
 */
export default function SlotSearchFilter({
  organizations,
  isSearching,
  onSearch,
  onReset,
  initialCriteria = INITIAL_SLOT_CRITERIA,
  isExamTypeLocked = false,
  excludedEquipmentIds,
  dataSource = "mock",
  apiExamTypeId,
  examTypeOptions = null,
  lockedExamTypeItem = null,
}: SlotSearchFilterProps) {
  const isApi = dataSource === "api";
  const calendar = useApiSlotCalendar(isApi, apiExamTypeId);
  /** API 모드: 달력에 표시 중인 월 (`YYYY-MM`) */
  const [viewMonthKey, setViewMonthKey] = useState<string | null>(null);
  // 최초 조건·제외 장비는 마운트 시점 값으로 고정한다
  const [startCriteria] = useState(initialCriteria);
  const [queryOptions] = useState(() => ({ excludedEquipmentIds }));
  const [criteria, setCriteria] = useState<SlotSearchCriteria>(startCriteria);
  /** null = 아직 불러오지 않음 */
  const [availability, setAvailability] = useState<DateAvailability | null>(null);
  const [dateNotice, setDateNotice] = useState<string | null>(null);
  const [examTypeNotice, setExamTypeNotice] = useState<string | null>(null);
  const latestRequestRef = useRef(0);

  /**
   * 날짜별 예약 가능 여부를 다시 불러온다.
   * 선택돼 있던 날짜가 새 조건에서 선택 불가가 되면 날짜를 초기화하고 안내한다.
   */
  const refreshAvailability = useCallback(
    async (filter: AvailabilityFilter, selectedDate: DateKey | "") => {
      if (isApi) return; // API 모드는 checkApiSelectedDate (월별 실제 데이터)
      const requestId = ++latestRequestRef.current;
      const next = await getDateAvailability(filter, queryOptions);
      if (requestId !== latestRequestRef.current) return; // 더 최근 요청이 있으면 무시

      setAvailability(next);
      if (selectedDate && next[selectedDate] !== "AVAILABLE") {
        setCriteria((prev) => (prev.date === selectedDate ? { ...prev, date: "" } : prev));
        const timeText = filter.timeOfDay ? `${TIME_OF_DAY_LABELS[filter.timeOfDay]} ` : "";
        setDateNotice(
          `선택한 날짜(${selectedDate})에 바뀐 조건으로 예약 가능한 ${timeText}슬롯이 없어 날짜 선택을 초기화했습니다.`,
        );
      }
    },
    [queryOptions, isApi],
  );

  /**
   * API 모드: 조건이 바뀌었을 때 선택한 날짜에 예약 가능한 슬롯이 없으면 날짜를 초기화한다 (Mock과 같은 안내).
   * 그 월을 아직 받지 못했거나 조회에 실패했으면 '없음'으로 보지 않고 날짜를 그대로 둔다
   */
  const checkApiSelectedDate = (filter: AvailabilityFilter, selectedDate: DateKey | "") => {
    if (!selectedDate) return;
    const state = calendar.months[selectedDate.slice(0, 7)];
    if (state?.status !== "loaded") return;
    if ((countApiSlotsByDate(state.slots, filter, getSeoulNow().dateTime)[selectedDate] ?? 0) > 0) return;
    setCriteria((prev) => (prev.date === selectedDate ? { ...prev, date: "" } : prev));
    const timeText = filter.timeOfDay ? `${TIME_OF_DAY_LABELS[filter.timeOfDay]} ` : "";
    setDateNotice(`선택한 날짜(${selectedDate})에 바뀐 조건으로 예약 가능한 ${timeText}슬롯이 없어 날짜 선택을 초기화했습니다.`);
  };

  // 최초 진입 시 최초 조건으로 한 번 불러온다 (API 모드는 달력을 열 때 표시 월만 불러온다)
  useEffect(() => {
    if (isApi) return;
    const requestId = ++latestRequestRef.current;
    getDateAvailability(startCriteria, queryOptions).then((next) => {
      if (requestId === latestRequestRef.current) setAvailability(next);
    });
  }, [startCriteria, queryOptions, isApi]);

  // 장애 장비나 슬롯 데이터가 바뀌면(장애 등록·복구, 슬롯 생성·운영 중단) 현재 조건으로 달력 가용 날짜를 다시 계산한다.
  // 선택한 날짜가 더는 예약 불가면 refreshAvailability가 날짜를 비우고 안내한다
  const slotDataKey = useSlotDataKey();
  const latestCriteriaRef = useRef(criteria);
  useEffect(() => {
    latestCriteriaRef.current = criteria;
  });
  const refreshedKeyRef = useRef(slotDataKey);
  useEffect(() => {
    if (refreshedKeyRef.current === slotDataKey) return;
    refreshedKeyRef.current = slotDataKey;
    const current = latestCriteriaRef.current;
    void refreshAvailability(current, current.date);
  }, [slotDataKey, refreshAvailability]);

  /** 세부 검사 항목 선택지 (검사 유형·기관 조건 반영) */
  const choicesFor = (filter: Pick<SlotSearchCriteria, "examType" | "organizationId">) =>
    examTypeOptions ? getExamTypeChoices(examTypeOptions, organizations, filter) : [];
  const examTypeChoices = choicesFor(criteria);

  /** 달력에 영향을 주는 조건(유형·기관·세부 검사 항목·시간대) 변경 */
  const updateFilter = (patch: Partial<AvailabilityFilter>) => {
    const next = { ...criteria, ...patch };
    // 상위 조건(검사 유형·기관)이 바뀌어 고른 항목이 선택지에서 빠지면 전체 검사 항목으로 되돌린다 (재조정의 고정 항목은 그대로)
    if (!lockedExamTypeItem && ("examType" in patch || "organizationId" in patch)) {
      const examTypeId = reconcileExamTypeId(next.examTypeId, choicesFor(next));
      if (examTypeId !== (next.examTypeId ?? "")) {
        next.examTypeId = examTypeId;
        setExamTypeNotice("선택한 세부 검사 항목이 바뀐 조건에 맞지 않아 전체 검사 항목으로 바꿨습니다.");
      } else {
        setExamTypeNotice(null);
      }
    } else if ("examTypeId" in patch) {
      setExamTypeNotice(null);
    }
    setCriteria(next);
    setDateNotice(null);
    if (isApi) checkApiSelectedDate(next, next.date);
    else void refreshAvailability(next, next.date);
  };

  const handleReset = () => {
    setCriteria(startCriteria);
    setDateNotice(null);
    setExamTypeNotice(null);
    void refreshAvailability(startCriteria, "");
    onReset?.();
  };

  /** API 모드: 표시 중인 월의 날짜 → 예약 가능 슬롯 수 (현재 조건). 렌더링마다 한 번만 센다 */
  const viewMonthState = isApi && viewMonthKey ? calendar.months[viewMonthKey] : undefined;
  const viewMonthCounts =
    viewMonthState?.status === "loaded" ? countApiSlotsByDate(viewMonthState.slots, criteria, getSeoulNow().dateTime) : null;
  const getApiDisabledReason = (dateKey: DateKey): string | null => {
    const monthKey = dateKey.slice(0, 7);
    const state = calendar.months[monthKey];
    if (!state || state.status === "loading") return API_DISABLED_REASON.LOADING;
    if (state.status === "error") return API_DISABLED_REASON.ERROR;
    if (state.status === "out-of-range") return API_DISABLED_REASON.OUT_OF_RANGE;
    // 월을 옮긴 직후 한 번은 표시 월이 아직 바뀌지 않았을 수 있다: 그때는 그 월을 바로 센다
    const counts =
      monthKey === viewMonthKey && viewMonthCounts ? viewMonthCounts : countApiSlotsByDate(state.slots, criteria, getSeoulNow().dateTime);
    return (counts[dateKey] ?? 0) > 0 ? null : API_DISABLED_REASON.NONE;
  };

  const getDisabledReason = (dateKey: DateKey): string | null => {
    if (isApi) return getApiDisabledReason(dateKey);
    // 불러오기 전에는 모든 날짜를 선택 불가로 둔다
    if (!availability) return "예약 가능 날짜 확인 중";
    const status = availability[dateKey];
    if (status === "AVAILABLE") return null;
    return status === "FULL" ? DISABLED_REASON.FULL : DISABLED_REASON.NONE;
  };

  const organizationOptions: SelectOption[] = [
    { value: "", label: "전체" },
    ...organizations.map(({ id, name }) => ({ value: id, label: name })),
  ];

  const handleSearch = () => {
    if (isSearching) return;
    onSearch(criteria);
  };

  return (
    <div
      role="search"
      aria-label="검사 슬롯 검색 조건"
      className="flex flex-col gap-5 rounded-xl border border-line bg-white px-6 py-6 sm:px-8"
    >
      <div className="grid grid-cols-1 items-end gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(200px,0.9fr)]">
        <SelectInput
          id="slot-exam-type"
          label="검사 유형"
          options={EXAM_TYPE_OPTIONS}
          value={criteria.examType}
          disabled={isExamTypeLocked}
          onChange={(e) => updateFilter({ examType: e.target.value as ExamType | "" })}
        />
        <SelectInput
          id="slot-organization"
          label="협력 검사기관"
          options={organizationOptions}
          value={criteria.organizationId}
          onChange={(e) => updateFilter({ organizationId: e.target.value })}
        />
        {lockedExamTypeItem ? (
          // 재조정: 기존 의뢰의 세부 검사 항목으로 고정 (같은 CT·MRI라도 다른 항목은 고를 수 없다)
          <SelectInput
            id="slot-exam-item"
            label="세부 검사 항목"
            options={[{ value: lockedExamTypeItem.id, label: lockedExamTypeItem.name }]}
            value={lockedExamTypeItem.id}
            disabled
            onChange={() => undefined}
          />
        ) : (
          <SelectInput
            id="slot-exam-item"
            label="세부 검사 항목"
            options={
              examTypeOptions === null
                ? [{ value: "", label: "검사 항목을 불러오지 못했습니다" }]
                : examTypeChoices.length === 0
                  ? [{ value: "", label: "선택 가능한 검사 항목이 없습니다" }]
                  : [{ value: "", label: "전체 검사 항목" }, ...examTypeChoices]
            }
            value={examTypeOptions === null || examTypeChoices.length === 0 ? "" : (criteria.examTypeId ?? "")}
            disabled={examTypeOptions === null || examTypeChoices.length === 0}
            aria-describedby={examTypeNotice ? "slot-exam-item-notice" : undefined}
            onChange={(e) => updateFilter({ examTypeId: e.target.value })}
          />
        )}
        <DatePicker
          id="slot-date"
          label="검사 날짜"
          value={criteria.date}
          onChange={(date) => {
            setCriteria((prev) => ({ ...prev, date }));
            setDateNotice(null);
          }}
          getDisabledReason={getDisabledReason}
          disablePast
          // API 모드: 날짜를 고르지 않으면 오늘부터 31일만 검색한다 (서버 최대 검색 기간)
          placeholder={isApi ? `오늘부터 ${API_SEARCH_RANGE_DAYS}일` : "전체 기간"}
          disabledNote={
            isApi
              ? getApiCalendarNote(viewMonthState, criteria.timeOfDay)
              : criteria.timeOfDay
                ? `${TIME_OF_DAY_LABELS[criteria.timeOfDay]}에 예약 가능한 슬롯이 있는 날짜만 선택할 수 있습니다.`
                : ""
          }
          onViewMonthChange={
            isApi
              ? (year, month) => {
                  setViewMonthKey(toMonthKey(year, month));
                  calendar.requestMonth(year, month);
                }
              : undefined
          }
        />

        {/* 시간대: 검사 시작 시각 기준 (오전 12:00 이전 / 오후 12:00부터) */}
        <fieldset className="min-w-0">
          <legend className={fieldLabelClass}>시간대</legend>
          <div className="grid h-12 grid-cols-3 gap-1 rounded-lg border border-line bg-gray-50 p-1">
            {TIME_OF_DAY_OPTIONS.map(({ value, label }) => {
              const checked = criteria.timeOfDay === value;
              return (
                <label
                  key={value || "ALL"}
                  className={`flex cursor-pointer items-center justify-center rounded-md text-[15px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${checked ? "bg-white font-semibold text-primary shadow-sm ring-1 ring-primary/40" : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                  <input
                    type="radio"
                    name="slot-time-of-day"
                    value={value}
                    checked={checked}
                    onChange={() => updateFilter({ timeOfDay: value })}
                    className="sr-only"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      {examTypeNotice && (
        <p id="slot-exam-item-notice" role="status" className="-mt-2 text-sm text-amber-700">
          {examTypeNotice}
        </p>
      )}
      {dateNotice && (
        <p role="status" className="-mt-2 text-sm text-amber-700">
          {dateNotice}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[15px] text-gray-800">
          <input
            type="checkbox"
            checked={criteria.availableOnly}
            onChange={(e) => setCriteria((prev) => ({ ...prev, availableOnly: e.target.checked }))}
            className="size-[18px] cursor-pointer rounded border-line accent-primary"
          />
          예약 가능한 슬롯만 보기
          <span className="text-sm text-gray-500">(예약 불가 슬롯 제외)</span>
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            초기화
          </button>
          <button
            type="button"
            onClick={handleSearch}
            disabled={isSearching}
            className="inline-flex h-11 min-w-[148px] items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Search className="size-5" aria-hidden="true" />
            {isSearching ? "검색 중" : "슬롯 검색"}
          </button>
        </div>
      </div>
    </div>
  );
}
