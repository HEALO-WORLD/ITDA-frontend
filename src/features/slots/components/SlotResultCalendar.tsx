"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { addDays, addMonths, getDaysInMonth, getWeekday, parseDateKey, toDateKey, type DateKey } from "@/lib/date/seoulDate";
import { formatDateLong, WEEKDAYS } from "@/lib/format/date";

import { isInResultRange, type ResultDateRange } from "../slotResultGroups";

interface SlotResultCalendarProps {
  /** 검색한 기간. 기간 밖 날짜는 결과가 없어 선택할 수 없다 */
  range: ResultDateRange;
  /** 날짜별 예약 가능 슬롯 수 (받은 검색 결과에서 센 값) */
  availableCounts: Record<DateKey, number>;
  selectedDate: DateKey | "";
  onSelectDate: (date: DateKey) => void;
  /** 검색 조건에서 날짜를 지정해 검색했는지 (기간 밖 안내 문구) */
  isDateLocked: boolean;
  /** 좁은 자리(PC 재조정 모달): 날짜 칸 높이·여백을 줄인다 */
  compact?: boolean;
}

/** 키보드 이동량 (APG Grid / Date Picker 패턴과 같다) */
const KEY_OFFSETS: Record<string, (key: DateKey) => DateKey> = {
  ArrowLeft: (key) => addDays(key, -1),
  ArrowRight: (key) => addDays(key, 1),
  ArrowUp: (key) => addDays(key, -7),
  ArrowDown: (key) => addDays(key, 7),
  Home: (key) => addDays(key, -getWeekday(key)),
  End: (key) => addDays(key, 6 - getWeekday(key)),
  PageUp: (key) => addMonths(key, -1),
  PageDown: (key) => addMonths(key, 1),
};

const monthOf = (key: DateKey) => key.slice(0, 7);

/**
 * 검색 결과 달력 (PC 슬롯 검색 화면). 이미 받은 결과를 날짜별로 보여 주고, 날짜를 고르면 오른쪽 카드만 바뀐다 (요청 없음).
 * - 날짜 아래 숫자: 그날 예약 가능한 슬롯 수
 * - 예약 가능한 슬롯이 없는 날짜·검색 기간 밖 날짜는 선택할 수 없다 (포커스는 되고 이유를 읽어 준다)
 * - 키보드: 방향키(하루·한 주), Home/End(주 처음·끝), PageUp/PageDown(한 달), Enter/Space(선택). 검색 기간 안에서만 움직인다
 */
export default function SlotResultCalendar({
  range,
  availableCounts,
  selectedDate,
  onSelectDate,
  isDateLocked,
  compact = false,
}: SlotResultCalendarProps) {
  const lastDate = addDays(range.endDateExclusive, -1);
  const clamp = (key: DateKey) => (key < range.startDate ? range.startDate : key > lastDate ? lastDate : key);
  const initial = clamp(selectedDate || range.startDate);

  const [viewMonth, setViewMonth] = useState(monthOf(initial));
  const [focusedKey, setFocusedKey] = useState<DateKey>(initial);
  const gridRef = useRef<HTMLTableElement>(null);
  const shouldFocusRef = useRef(false);

  // 바깥에서 선택 날짜가 바뀌면(새 검색) 그 달을 보인다 (렌더링 중 상태 맞추기)
  const [syncedSelection, setSyncedSelection] = useState(selectedDate);
  if (syncedSelection !== selectedDate) {
    setSyncedSelection(selectedDate);
    if (selectedDate) {
      setViewMonth(monthOf(clamp(selectedDate)));
      setFocusedKey(clamp(selectedDate));
    }
  }

  useEffect(() => {
    if (!shouldFocusRef.current) return;
    shouldFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedKey}"]`)?.focus();
  }, [focusedKey, viewMonth]);

  const getDisabledReason = (key: DateKey): string | null => {
    if (!isInResultRange(key, range)) return isDateLocked ? "검색 조건에서 지정한 날짜가 아님" : "검색 기간 밖";
    return (availableCounts[key] ?? 0) > 0 ? null : "예약 가능한 슬롯 없음";
  };

  const select = (key: DateKey) => {
    if (key !== selectedDate && getDisabledReason(key)) return;
    onSelectDate(key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const getNext = KEY_OFFSETS[event.key];
    if (!getNext) return;
    event.preventDefault();
    const next = clamp(getNext(focusedKey));
    shouldFocusRef.current = true;
    setFocusedKey(next);
    setViewMonth(monthOf(next));
  };

  const { year, month } = parseDateKey(`${viewMonth}-01`);
  const firstKey = toDateKey(year, month, 1);
  const canGoPrev = viewMonth > monthOf(range.startDate);
  const canGoNext = viewMonth < monthOf(lastDate);
  const tabbableKey = monthOf(focusedKey) === viewMonth ? focusedKey : clamp(firstKey);

  const moveMonth = (delta: number) => {
    const nextMonth = monthOf(addMonths(firstKey, delta));
    setViewMonth(nextMonth);
    // 새 달의 첫 선택 가능 위치로 키보드 기준을 옮긴다 (월 버튼 포커스는 그대로)
    setFocusedKey(clamp(`${nextMonth}-01`));
  };

  const cells: (DateKey | null)[] = Array(getWeekday(firstKey)).fill(null);
  for (let day = 1; day <= getDaysInMonth(year, month); day++) cells.push(toDateKey(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (DateKey | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className={`rounded-xl border border-line bg-white shadow-card ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          disabled={!canGoPrev}
          aria-label="이전 달"
          className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <p id="slot-result-calendar-title" className="text-base font-bold text-gray-900" aria-live="polite">
          {year}년 {month}월
        </p>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          disabled={!canGoNext}
          aria-label="다음 달"
          className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-label={`검색 결과 날짜 선택, ${year}년 ${month}월`}
        aria-describedby="slot-result-calendar-help"
        onKeyDown={handleKeyDown}
        className="w-full table-fixed border-collapse"
      >
        <thead>
          <tr>
            {WEEKDAYS.map((weekday, index) => (
              <th
                key={weekday}
                scope="col"
                abbr={`${weekday}요일`}
                className={`pb-1.5 text-center text-xs font-medium ${index === 0 ? "text-red-500/80" : "text-gray-500"}`}
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((key, dayIndex) => {
                if (!key) return <td key={`empty-${dayIndex}`} className="p-0.5" />;
                const count = availableCounts[key] ?? 0;
                const inRange = isInResultRange(key, range);
                const reason = getDisabledReason(key);
                const isSelected = key === selectedDate;

                let stateClass = "bg-white text-gray-900 ring-1 ring-inset ring-line hover:bg-brand-mint-soft hover:ring-brand-mint";
                if (isSelected) stateClass = "bg-primary text-white ring-0";
                else if (!inRange) stateClass = "cursor-not-allowed text-gray-300";
                else if (reason) stateClass = "cursor-not-allowed bg-gray-50 text-gray-400";

                return (
                  <td key={key} role="gridcell" aria-selected={isSelected} className="p-0.5">
                    <button
                      type="button"
                      data-date={key}
                      data-available-count={inRange ? count : undefined}
                      tabIndex={key === tabbableKey ? 0 : -1}
                      aria-disabled={reason && !isSelected ? true : undefined}
                      aria-current={isSelected ? "date" : undefined}
                      aria-label={[
                        formatDateLong(key),
                        inRange && (count > 0 ? `예약 가능 ${count}건` : "예약 가능한 슬롯 없음"),
                        isSelected && "선택됨",
                        reason && !isSelected && "선택할 수 없음",
                        !inRange && reason,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      title={reason ?? undefined}
                      onClick={() => select(key)}
                      onFocus={() => setFocusedKey(key)}
                      className={`flex ${compact ? "h-11" : "h-14"} w-full flex-col items-center justify-center gap-0.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${stateClass}`}
                    >
                      <span className="tabular-nums">{parseDateKey(key).day}</span>
                      {inRange && (
                        <span
                          aria-hidden="true"
                          className={`min-w-6 rounded px-1 text-[11px] font-semibold leading-4 tabular-nums ${
                            isSelected
                              ? "bg-brand-mint text-brand-navy"
                              : count > 0
                                ? "bg-brand-mint-soft text-brand-mint-strong"
                                : "text-gray-400"
                          }`}
                        >
                          {count > 0 ? count : "–"}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 border-t border-line pt-3">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          <LegendItem swatchClass="bg-brand-mint-soft ring-1 ring-inset ring-brand-mint" label="숫자: 예약 가능 건수" />
          <LegendItem swatchClass="bg-primary" label="선택한 날짜" />
          <LegendItem swatchClass="bg-gray-50 ring-1 ring-inset ring-line" label="예약 가능 슬롯 없음" />
          <li className="flex items-center gap-1.5">
            <span className="w-3 text-center text-[11px] font-semibold text-gray-300" aria-hidden="true">
              7
            </span>
            {isDateLocked ? "지정한 날짜 외" : "검색 기간 밖"}
          </li>
        </ul>
        <p id="slot-result-calendar-help" className="mt-1.5 text-xs text-gray-500">
          날짜를 고르면 오른쪽에 그날의 예약 가능한 시간이 표시됩니다. 방향키로 날짜를 옮기고 Enter로 선택합니다.
        </p>
      </div>
    </div>
  );
}

function LegendItem({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`size-3 rounded-sm ${swatchClass}`} aria-hidden="true" />
      {label}
    </li>
  );
}
