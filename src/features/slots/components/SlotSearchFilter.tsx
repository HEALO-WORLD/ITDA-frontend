import { CalendarDays, Check, Lock, RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { fieldLabelClass, SelectInput, type SelectOption } from "@/components/ui/FormControls";
import type { DateKey } from "@/lib/date/seoulDate";

import { getSeoulNow } from "@/lib/date/seoulDate";

import { API_SEARCH_RANGE_DAYS, countApiSlotsByDate, toMonthKey } from "../apiSearchClient";
import type { AvailabilityFilter } from "../availability";
import { getExamTypeChoices, reconcileExamTypeId, type SlotExamTypeOption } from "../examTypeFilter";
import type { ExamType, PartnerOrganization, SlotSearchCriteria, TimeOfDay } from "../types";
import { isPcViewport } from "../initialSearch";
import { useApiSlotCalendar, type ApiCalendarMonthState } from "../useApiSlotCalendar";

import CriteriaChipSelect, { ChipContent, chipClass } from "./CriteriaChipSelect";

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
  /** API 재조정 모드: 달력 조회를 이 검사 유형으로 고정한다 */
  apiExamTypeId?: string;
  /**
   * 세부 검사 항목 선택지 원본 (협력 기관 장비가 실제 지원하는 검사 유형).
   * null = 목록을 불러오지 못함 (선택 비활성). 검사 유형(CT/MRI)·협력 검사기관 조건에 맞는 항목만 보인다
   */
  examTypeOptions?: readonly SlotExamTypeOption[] | null;
  /** 재조정: 세부 검사 항목을 이 항목으로 고정한다 (변경 불가. 기존 의뢰와 다른 항목의 슬롯은 검색하지 않는다) */
  lockedExamTypeItem?: { id: string; name: string } | null;
  /** 검색 조건 영역 id */
  id?: string;
  /** 슬롯 검색 화면(대화상자 아님): 협력 검사기관을 맨 앞에 둔다 (xl 미만은 보이는 순서를 기존대로 유지) */
  orgFirst?: boolean;
  /**
   * PC(xl) 슬롯 검색 화면의 검색 뒤 상태: 전체 폼 대신 조건 칩 줄을 보인다. 칩과 전체 폼은 같은 입력 상태(criteria)를 쓰고,
   * 칩으로 바꾼 값은 [검색 적용]을 눌러야 검색된다. xl 미만에서는 항상 전체 폼
   */
  compact?: boolean;
  /** 마지막으로 검색을 실행한 조건 (아직 적용하지 않은 변경 표시용). 없으면 표시하지 않는다 */
  appliedCriteria?: SlotSearchCriteria;
  /** 바깥 모양. default: 기존 (슬롯 검색 화면·대화상자). wizard: PC 재조정 모달 오른쪽 열의 조건 칩 상자 */
  surface?: "default" | "wizard";
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
  apiExamTypeId,
  examTypeOptions = null,
  lockedExamTypeItem = null,
  id,
  orgFirst = false,
  compact = false,
  appliedCriteria,
  surface = "default",
}: SlotSearchFilterProps) {
  const calendar = useApiSlotCalendar(true, apiExamTypeId);
  /** API 모드: 달력에 표시 중인 월 (`YYYY-MM`) */
  const [viewMonthKey, setViewMonthKey] = useState<string | null>(null);
  // 최초 조건은 마운트 시점 값으로 고정한다
  const [startCriteria] = useState(initialCriteria);
  const [criteria, setCriteria] = useState<SlotSearchCriteria>(startCriteria);
  const [dateNotice, setDateNotice] = useState<string | null>(null);
  const [examTypeNotice, setExamTypeNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);

  /** 사용자가 이 폼에서 검색·초기화를 눌렀는지 (최초 자동 검색 뒤에는 포커스를 옮기지 않는다) */
  const userSearchRef = useRef(false);

  // 조건 칩 줄로 바뀌면(PC): 숨겨진 전체 폼에 있던 포커스(또는 검색 중 비활성으로 body로 빠진 포커스)를 [검색 적용]으로 옮긴다
  useEffect(() => {
    // [검색 적용]은 검색 중 비활성이라 포커스가 body로 빠진다: 검색이 끝나면(isSearching false) 다시 돌려준다
    if (!compact || isSearching || !userSearchRef.current || !isPcViewport()) return;
    userSearchRef.current = false;
    const active = document.activeElement;
    const isInHiddenForm = Boolean(active && rootRef.current?.contains(active) && !active.closest("[data-criteria-chips]"));
    if (!active || active === document.body || isInHiddenForm) applyButtonRef.current?.focus();
  }, [compact, isSearching]);

  /**
   * 조건이 바뀌었을 때 선택한 날짜에 예약 가능한 슬롯이 없으면 날짜를 초기화한다.
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
    checkApiSelectedDate(next, next.date);
  };

  const handleReset = () => {
    userSearchRef.current = true;
    setCriteria(startCriteria);
    setDateNotice(null);
    setExamTypeNotice(null);
    onReset?.();
  };

  /** API 모드: 표시 중인 월의 날짜 → 예약 가능 슬롯 수 (현재 조건). 렌더링마다 한 번만 센다 */
  const viewMonthState = viewMonthKey ? calendar.months[viewMonthKey] : undefined;
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

  const getDisabledReason = getApiDisabledReason;

  const organizationOptions: SelectOption[] = [
    { value: "", label: "전체" },
    ...organizations.map(({ id, name }) => ({ value: id, label: name })),
  ];

  const handleSearch = () => {
    if (isSearching) return;
    userSearchRef.current = true;
    onSearch(criteria);
  };

  // ── 세부 검사 항목 선택지 (전체 폼 select와 조건 칩이 같이 쓴다) ──
  const examItemUnavailableReason =
    examTypeOptions === null ? "검사 항목을 불러오지 못했습니다" : examTypeChoices.length === 0 ? "선택 가능한 검사 항목이 없습니다" : null;
  const examItemOptions: SelectOption[] = lockedExamTypeItem
    ? [{ value: lockedExamTypeItem.id, label: lockedExamTypeItem.name }]
    : examItemUnavailableReason
      ? [{ value: "", label: examItemUnavailableReason }]
      : [{ value: "", label: "전체 검사 항목" }, ...examTypeChoices];
  const examItemValue = lockedExamTypeItem ? lockedExamTypeItem.id : examItemUnavailableReason ? "" : (criteria.examTypeId ?? "");
  const isExamItemDisabled = Boolean(lockedExamTypeItem) || Boolean(examItemUnavailableReason);

  const datePlaceholder = `오늘부터 ${API_SEARCH_RANGE_DAYS}일`;
  const handleDateChange = (date: DateKey | "") => {
    setCriteria((prev) => ({ ...prev, date }));
    setDateNotice(null);
  };
  const dateDisabledNote = getApiCalendarNote(viewMonthState, criteria.timeOfDay);
  const handleViewMonthChange = (year: number, month: number) => {
    setViewMonthKey(toMonthKey(year, month));
    calendar.requestMonth(year, month);
  };

  // ── 아직 검색에 적용하지 않은 변경 (마지막으로 검색한 조건과 비교) ──
  const changed = {
    organizationId: Boolean(appliedCriteria) && criteria.organizationId !== appliedCriteria?.organizationId,
    examType: Boolean(appliedCriteria) && criteria.examType !== appliedCriteria?.examType,
    examTypeId: Boolean(appliedCriteria) && (criteria.examTypeId ?? "") !== (appliedCriteria?.examTypeId ?? ""),
    date: Boolean(appliedCriteria) && criteria.date !== appliedCriteria?.date,
    timeOfDay: Boolean(appliedCriteria) && criteria.timeOfDay !== appliedCriteria?.timeOfDay,
    availableOnly: Boolean(appliedCriteria) && criteria.availableOnly !== appliedCriteria?.availableOnly,
  };
  const hasPendingChanges = Object.values(changed).some(Boolean);

  // ── 전체 폼 입력칸 (PC 화면은 협력 검사기관 → 검사 유형 → 세부 검사 항목 → 날짜 → 시간대) ──
  // orgFirst: DOM 순서를 바꿔 키보드 순서도 같게 한다. xl 미만은 order로 기존 보이는 순서(검사 유형 먼저)를 유지한다
  const orderClass = (mobileOrder: string) => (orgFirst ? mobileOrder : "");
  const examTypeField = (
    <SelectInput
      key="exam-type"
      id="slot-exam-type"
      label="검사 유형"
      className={orderClass("max-xl:order-1")}
      options={EXAM_TYPE_OPTIONS}
      value={criteria.examType}
      disabled={isExamTypeLocked}
      onChange={(e) => updateFilter({ examType: e.target.value as ExamType | "" })}
    />
  );
  const organizationField = (
    <SelectInput
      key="organization"
      id="slot-organization"
      label="협력 검사기관"
      className={orderClass("max-xl:order-2")}
      options={organizationOptions}
      value={criteria.organizationId}
      onChange={(e) => updateFilter({ organizationId: e.target.value })}
    />
  );
  const examItemField = (
    <SelectInput
      key="exam-item"
      id="slot-exam-item"
      label="세부 검사 항목"
      className={orderClass("max-xl:order-3")}
      options={examItemOptions}
      value={examItemValue}
      // 재조정: 기존 의뢰의 세부 검사 항목으로 고정 (같은 CT·MRI라도 다른 항목은 고를 수 없다)
      disabled={isExamItemDisabled}
      aria-describedby={examTypeNotice ? "slot-exam-item-notice" : undefined}
      onChange={(e) => updateFilter({ examTypeId: e.target.value })}
    />
  );
  const dateField = (
    <div key="date" className={orderClass("max-xl:order-4")}>
      <DatePicker
        id="slot-date"
        label="검사 날짜"
        value={criteria.date}
        onChange={handleDateChange}
        getDisabledReason={getDisabledReason}
        disablePast
        // API 모드: 날짜를 고르지 않으면 오늘부터 31일만 검색한다 (서버 최대 검색 기간)
        placeholder={datePlaceholder}
        disabledNote={dateDisabledNote}
        onViewMonthChange={handleViewMonthChange}
      />
    </div>
  );
  const timeOfDayField = (
    // 시간대: 검사 시작 시각 기준 (오전 12:00 이전 / 오후 12:00부터)
    <fieldset key="time-of-day" className={`min-w-0 ${orderClass("max-xl:order-5")}`}>
      <legend className={fieldLabelClass}>시간대</legend>
      <div className="grid h-12 grid-cols-3 gap-1 rounded-lg border border-line bg-gray-50 p-1">
        {TIME_OF_DAY_OPTIONS.map(({ value, label }) => {
          const checked = criteria.timeOfDay === value;
          return (
            <label
              key={value || "ALL"}
              className={`flex cursor-pointer items-center justify-center rounded-md text-[15px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${checked ? "bg-white font-semibold text-primary shadow-sm ring-1 ring-primary/40 itda:bg-brand-mint-soft itda:ring-brand-mint" : "text-gray-600 hover:text-gray-900"
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
  );
  const fields = orgFirst
    ? [organizationField, examTypeField, examItemField, dateField, timeOfDayField]
    : [examTypeField, organizationField, examItemField, dateField, timeOfDayField];

  /** PC(xl) 조건 칩 줄일 때 전체 폼(제목·입력칸·아래 버튼 줄)은 xl에서만 숨긴다 (xl 미만은 그대로 전체 폼) */
  const fullFormClass = compact ? "itda:xl:hidden" : "";

  return (
    <div
      ref={rootRef}
      id={id}
      role="search"
      aria-label="검사 슬롯 검색 조건"
      // PC(xl) 슬롯 검색 화면: 통합 카드의 위쪽 영역 (테두리·그림자는 바깥 카드가, 아래 구분선·연한 배경으로 결과와 나눈다)
      className={
        surface === "wizard"
          ? // PC 재조정 모달: 오른쪽 열 위의 연한 배경 상자 (조건 칩 줄만)
            "flex flex-col gap-3 rounded-xl border border-line bg-brand-canvas/70 px-4 py-3"
          : `flex flex-col gap-5 rounded-xl border border-line bg-white px-6 py-6 sm:px-8 itda:px-5 itda:shadow-card itda:sm:px-8 itda:xl:rounded-b-none itda:xl:border-x-0 itda:xl:border-t-0 itda:xl:bg-brand-canvas/70 itda:xl:px-7 itda:xl:shadow-none ${compact ? "itda:xl:gap-3 itda:xl:py-4" : ""}`
      }
    >
      {compact && (
        // PC 조건 칩 줄: 칩을 눌러 바로 고치고(입력 상태만 바뀜) [검색 적용]을 눌러야 결과가 바뀐다. xl 미만에서는 숨긴다
        <div data-criteria-chips className="hidden flex-col gap-2.5 itda:xl:flex">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 flex shrink-0 items-center gap-2.5 text-base font-semibold text-gray-900">
              <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-navy" />
              검색 조건
            </h2>
            <CriteriaChipSelect
              id="slot-chip-organization"
              label="협력 검사기관"
              options={organizationOptions}
              value={criteria.organizationId}
              changed={changed.organizationId}
              onChange={(value) => updateFilter({ organizationId: value })}
            />
            {/* 검사 유형 + 세부 검사 항목: 연관 조건이라 한 묶음으로 */}
            <div role="group" aria-label="검사 유형과 세부 검사 항목" className="flex min-w-0 items-center gap-1 rounded-xl border border-dashed border-line-strong/80 p-1">
              <CriteriaChipSelect
                id="slot-chip-exam-type"
                label="검사 유형"
                options={EXAM_TYPE_OPTIONS}
                value={criteria.examType}
                changed={changed.examType}
                disabled={isExamTypeLocked}
                disabledReason="재조정 대상 예약의 검사 유형으로 고정됩니다"
                onChange={(value) => updateFilter({ examType: value as ExamType | "" })}
              />
              <CriteriaChipSelect
                id="slot-chip-exam-item"
                label="세부 검사 항목"
                options={examItemOptions}
                value={examItemValue}
                changed={changed.examTypeId}
                disabled={isExamItemDisabled}
                disabledReason={lockedExamTypeItem ? "재조정 대상 의뢰의 세부 검사 항목으로 고정됩니다" : (examItemUnavailableReason ?? undefined)}
                describedBy={examTypeNotice ? "slot-exam-item-notice" : undefined}
                onChange={(value) => updateFilter({ examTypeId: value })}
              />
            </div>
            <div className="relative">
              <DatePicker
                id="slot-chip-date"
                label="검사 날짜"
                value={criteria.date}
                onChange={handleDateChange}
                getDisabledReason={getDisabledReason}
                disablePast
                placeholder={datePlaceholder}
                disabledNote={dateDisabledNote}
                onViewMonthChange={handleViewMonthChange}
                chip={{
                  className: chipClass(changed.date),
                  content: (
                    <ChipContent
                      label="검사 날짜"
                      value={criteria.date || datePlaceholder}
                      changed={changed.date}
                      icon={<CalendarDays className="size-4 shrink-0 text-gray-500" aria-hidden="true" />}
                    />
                  ),
                }}
              />
            </div>
            <CriteriaChipSelect
              id="slot-chip-time-of-day"
              label="시간대"
              options={TIME_OF_DAY_OPTIONS}
              value={criteria.timeOfDay}
              changed={changed.timeOfDay}
              onChange={(value) => updateFilter({ timeOfDay: value as TimeOfDay | "" })}
            />
            <button
              type="button"
              aria-pressed={criteria.availableOnly}
              onClick={() => setCriteria((prev) => ({ ...prev, availableOnly: !prev.availableOnly }))}
              className={chipClass(changed.availableOnly)}
            >
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center rounded border ${criteria.availableOnly ? "border-primary bg-primary text-white" : "border-line-strong bg-white"}`}
              >
                {criteria.availableOnly && <Check className="size-3" />}
              </span>
              <span className="font-semibold">예약 가능한 슬롯만</span>
              {changed.availableOnly && (
                <>
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="sr-only">, 변경됨 (아직 검색에 적용되지 않음)</span>
                </>
              )}
            </button>

            <div className="ml-auto flex shrink-0 gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3.5 text-sm font-semibold text-gray-700 transition-colors hover:border-line-strong"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                초기화
              </button>
              <button
                ref={applyButtonRef}
                type="button"
                onClick={handleSearch}
                disabled={isSearching}
                aria-describedby={hasPendingChanges ? "slot-criteria-pending" : undefined}
                className={`inline-flex h-10 min-w-[120px] items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 ${hasPendingChanges ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-brand-canvas" : ""}`}
              >
                <Search className="size-4" aria-hidden="true" />
                {isSearching ? "검색 중" : "검색 적용"}
              </button>
            </div>
          </div>
          {surface === "wizard" && (isExamTypeLocked || lockedExamTypeItem) && (
            <p className="flex items-center gap-1.5 text-[13px] text-gray-600">
              <Lock className="size-3.5 shrink-0 text-gray-400" aria-hidden="true" />
              검사 유형·세부 검사 항목은 기존 의뢰와 같게 고정됩니다. 협력 검사기관·날짜·시간대는 바꿀 수 있습니다.
            </p>
          )}
          {hasPendingChanges && (
            <p id="slot-criteria-pending" role="status" className="flex items-center gap-2 text-sm text-amber-800">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
              변경한 조건이 아직 검색 결과에 적용되지 않았습니다. [검색 적용]을 누르면 결과가 갱신됩니다.
            </p>
          )}
        </div>
      )}

      {/* PC(xl)·슬롯 검색 화면에서만: 검색 조건 영역 제목 (검색 결과 영역과 구분) */}
      <div className={`hidden items-baseline justify-between gap-4 itda:xl:flex ${fullFormClass}`}>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-gray-900">
          <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-navy" />
          검색 조건
        </h2>
        <p className="text-sm text-gray-500">조건을 고른 뒤 [슬롯 검색]을 누르면 아래에 결과가 표시됩니다.</p>
      </div>
      {/* PC(xl)·슬롯 검색 화면: 5개 조건을 한 줄로 (기관 → 유형 → 세부 항목 → 날짜 → 시간대) */}
      <div
        className={`grid grid-cols-1 items-end gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(200px,0.9fr)] itda:xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] itda:xl:gap-x-4 ${fullFormClass}`}
      >
        {fields}
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

      <div className={`flex flex-wrap items-center justify-between gap-3 itda:border-t itda:border-line itda:pt-5 ${fullFormClass}`}>
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
        <div className="ml-auto flex gap-2 itda:max-sm:w-full">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 itda:transition-colors itda:hover:border-line-strong itda:max-sm:flex-1 itda:xl:h-12"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            초기화
          </button>
          <button
            type="button"
            onClick={handleSearch}
            disabled={isSearching}
            className="inline-flex h-11 min-w-[148px] items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 itda:shadow-sm itda:max-sm:flex-[2] itda:max-sm:min-w-0 itda:xl:h-12 itda:xl:min-w-[200px] itda:xl:px-8"
          >
            <Search className="size-5" aria-hidden="true" />
            {isSearching ? "검색 중" : "슬롯 검색"}
          </button>
        </div>
      </div>
    </div>
  );
}
