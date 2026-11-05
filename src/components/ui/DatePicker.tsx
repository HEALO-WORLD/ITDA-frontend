import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import {
  addDays,
  addMonths,
  getDaysInMonth,
  getSeoulNow,
  getWeekday,
  parseDateKey,
  toDateKey,
  type DateKey,
} from "@/lib/date/seoulDate";
import { formatDateLong, WEEKDAYS } from "@/lib/format/date";

import { controlClass, fieldLabelClass, iconClass } from "./FormControls";

interface DatePickerProps {
  id: string;
  label: string;
  /** 선택한 날짜. 빈 문자열은 미선택 */
  value: DateKey | "";
  onChange: (value: DateKey | "") => void;
  /** 날짜별 선택 불가 사유. null을 반환하면 선택 가능 */
  getDisabledReason?: (dateKey: DateKey) => string | null;
  /** 오늘(한국 시간) 이전 날짜 선택 불가 */
  disablePast?: boolean;
  /** 미선택 상태 표시 문구 */
  placeholder?: string;
  /** 범례 아래 선택 불가 사유 안내 */
  disabledNote?: string;
  /**
   * 달력을 열었을 때와 표시 월이 바뀔 때(월 이동 버튼·키보드 이동) 표시 중인 월을 알린다.
   * 날짜별 가용 정보를 월 단위로 불러오는 화면에서 쓴다 (달력 동작·포커스에는 영향 없음)
   */
  onViewMonthChange?: (year: number, month: number) => void;
  /**
   * 달력 팝업을 화면 기준(position: fixed)으로 띄운다. 스크롤되는 모달 본문 안에서 팝업이 잘리거나
   * 본문에 스크롤을 만들지 않게 할 때 쓴다 (아래 공간이 부족하면 위로 연다). 기본값(false)은 기존과 같은 absolute 배치
   */
  floating?: boolean;
}

/** floating 팝업 크기 (w-[320px]와 대략의 높이). 위·아래 배치를 고르는 데만 쓴다 */
const POPUP_WIDTH = 320;
const POPUP_HEIGHT_ESTIMATE = 430;
const POPUP_GAP = 8;

/** 트리거 위치 → 팝업 위치 (화면 안쪽으로 맞춘다) */
function getFloatingStyle(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const left = Math.max(POPUP_GAP, Math.min(rect.left, window.innerWidth - POPUP_WIDTH - POPUP_GAP));
  const below = window.innerHeight - rect.bottom;
  if (below >= POPUP_HEIGHT_ESTIMATE + POPUP_GAP || below >= rect.top) return { left, top: rect.bottom + POPUP_GAP };
  return { left, bottom: window.innerHeight - rect.top + POPUP_GAP };
}

interface MonthView {
  year: number;
  month: number;
}

const toMonthView = (key: DateKey): MonthView => {
  const { year, month } = parseDateKey(key);
  return { year, month };
};

/** 키보드 이동량 (APG Date Picker Dialog 패턴) */
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

/**
 * 날짜별 선택 가능 여부를 지정할 수 있는 달력 입력.
 * 날짜는 한국 시간 기준 `YYYY-MM-DD` 문자열로만 다룬다.
 * 선택 불가 날짜는 포커스(탐색)는 되지만 마우스·키보드로 선택되지 않는다.
 */
export default function DatePicker({
  id,
  label,
  value,
  onChange,
  getDisabledReason,
  disablePast = false,
  placeholder = "날짜 선택",
  disabledNote,
  onViewMonthChange,
  floating = false,
}: DatePickerProps) {
  const labelId = useId();
  const dialogId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const shouldFocusGridRef = useRef(false);

  const [isOpen, setIsOpen] = useState(false);
  const [todayKey, setTodayKey] = useState<DateKey>("");
  const [focusedKey, setFocusedKey] = useState<DateKey>("");
  const [view, setView] = useState<MonthView>({ year: 0, month: 0 });
  /** floating일 때 팝업 위치 */
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties | null>(null);

  const getReason = (key: DateKey): string | null => {
    if (disablePast && key < todayKey) return "지난 날짜";
    return getDisabledReason?.(key) ?? null;
  };

  const open = () => {
    // 오늘 날짜는 열 때마다 다시 계산한다 (자정이 지나도 기준이 맞도록)
    const today = getSeoulNow().dateKey;
    const start = value || today;
    setTodayKey(today);
    setFocusedKey(start);
    setView(toMonthView(start));
    if (floating && triggerRef.current) setFloatingStyle(getFloatingStyle(triggerRef.current));
    setIsOpen(true);
    shouldFocusGridRef.current = true;
  };

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const select = (key: DateKey) => {
    if (getReason(key)) return;
    onChange(key);
    close();
  };

  const moveFocus = (key: DateKey) => {
    setFocusedKey(key);
    setView(toMonthView(key));
    shouldFocusGridRef.current = true;
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const getNext = KEY_OFFSETS[event.key];
    if (!getNext || !focusedKey) return;
    event.preventDefault();
    moveFocus(getNext(focusedKey));
  };

  // 열 때와 키보드 이동 시에만 날짜 버튼으로 포커스를 옮긴다 (월 이동 버튼 클릭 시에는 유지)
  useEffect(() => {
    if (!isOpen || !shouldFocusGridRef.current) return;
    shouldFocusGridRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedKey}"]`)?.focus();
  }, [isOpen, focusedKey, view]);

  // floating: 열려 있는 동안 창 크기·스크롤이 바뀌면 트리거 기준으로 위치를 다시 잡는다
  useEffect(() => {
    if (!floating || !isOpen) return;
    const update = () => triggerRef.current && setFloatingStyle(getFloatingStyle(triggerRef.current));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [floating, isOpen]);

  // 표시 월 알림 (열려 있을 때만). 콜백이 렌더링마다 바뀌어도 같은 월을 다시 알리지 않도록 최신 콜백은 ref로 읽는다
  const onViewMonthChangeRef = useRef(onViewMonthChange);
  useEffect(() => {
    onViewMonthChangeRef.current = onViewMonthChange;
  });
  useEffect(() => {
    if (isOpen) onViewMonthChangeRef.current?.(view.year, view.month);
  }, [isOpen, view.year, view.month]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const firstKey = toDateKey(view.year, view.month, 1);
  const monthPrefix = firstKey.slice(0, 7);
  const canGoPrev = !disablePast || monthPrefix > todayKey.slice(0, 7);
  const tabbableKey = focusedKey.startsWith(monthPrefix) ? focusedKey : firstKey;

  const weeks: (DateKey | null)[][] = [];
  if (isOpen) {
    const cells: (DateKey | null)[] = Array(getWeekday(firstKey)).fill(null);
    for (let day = 1; day <= getDaysInMonth(view.year, view.month); day++) {
      cells.push(toDateKey(view.year, view.month, day));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  }

  return (
    <div ref={containerRef} className="relative">
      <label id={labelId} htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="relative">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? dialogId : undefined}
          aria-labelledby={`${labelId} ${id}`}
          onClick={() => (isOpen ? close() : open())}
          className={`${controlClass} text-left`}
        >
          {value || <span className="text-gray-500">{placeholder}</span>}
        </button>
        <CalendarDays className={iconClass} aria-hidden="true" />
      </div>

      {isOpen && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={`${label} 선택`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
          style={floating ? (floatingStyle ?? undefined) : undefined}
          className={`${floating ? "fixed" : "absolute left-0 top-full mt-2"} z-30 w-[320px] rounded-xl border border-line bg-white p-4 shadow-lg`}
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(toMonthView(addMonths(firstKey, -1)))}
              disabled={!canGoPrev}
              aria-label="이전 달"
              className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <p className="text-base font-bold text-gray-900" aria-live="polite">
              {view.year}년 {view.month}월
            </p>
            <button
              type="button"
              onClick={() => setView(toMonthView(addMonths(firstKey, 1)))}
              aria-label="다음 달"
              className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>

          <table
            ref={gridRef}
            role="grid"
            aria-label={`${view.year}년 ${view.month}월`}
            onKeyDown={handleGridKeyDown}
            className="w-full border-collapse"
          >
            <thead>
              <tr>
                {WEEKDAYS.map((weekday) => (
                  <th
                    key={weekday}
                    scope="col"
                    abbr={`${weekday}요일`}
                    className="pb-1 text-center text-xs font-medium text-gray-500"
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
                    if (!key) return <td key={`empty-${dayIndex}`} />;

                    const reason = getReason(key);
                    const isSelected = key === value;
                    const isToday = key === todayKey;

                    let stateClass = "text-gray-900 hover:bg-primary-soft";
                    if (isSelected) stateClass = "bg-primary font-bold text-white";
                    else if (reason) stateClass = "cursor-not-allowed bg-gray-100 text-gray-400";

                    return (
                      <td key={key} aria-selected={isSelected} className="p-0.5">
                        <button
                          type="button"
                          data-date={key}
                          tabIndex={key === tabbableKey ? 0 : -1}
                          aria-disabled={reason ? true : undefined}
                          aria-label={[
                            formatDateLong(key),
                            isToday && "오늘",
                            reason && `선택 불가: ${reason}`,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                          title={reason ?? undefined}
                          onClick={() => select(key)}
                          onFocus={() => setFocusedKey(key)}
                          className={`flex h-10 w-full items-center justify-center rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${stateClass} ${
                            isToday && !isSelected ? "ring-1 ring-inset ring-primary" : ""
                          }`}
                        >
                          {parseDateKey(key).day}
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
              <LegendItem swatchClass="border border-line bg-white" label="선택 가능" />
              <LegendItem swatchClass="bg-primary" label="선택됨" />
              <LegendItem swatchClass="ring-1 ring-inset ring-primary" label="오늘" />
              <LegendItem swatchClass="bg-gray-100" label="선택 불가" />
            </ul>
            {disabledNote && <p className="mt-1.5 text-xs text-gray-500">{disabledNote}</p>}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  close();
                }}
                disabled={!value}
                className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
              >
                날짜 선택 해제
              </button>
            </div>
          </div>
        </div>
      )}
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
