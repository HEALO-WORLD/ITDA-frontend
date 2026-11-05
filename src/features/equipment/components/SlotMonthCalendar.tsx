import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  addDays,
  addMonths,
  getDaysInMonth,
  getWeekday,
  parseDateKey,
  toDateKey,
  type DateKey,
} from "@/lib/date/seoulDate";
import { formatDateLong, WEEKDAYS } from "@/lib/format/date";

import { isSelectableDay, type DayStatus } from "../dayStatus";

interface SlotMonthCalendarProps {
  /** 표시 중인 달의 1일 */
  monthStart: DateKey;
  today: DateKey;
  range: { start: DateKey; end: DateKey };
  /** null = 선택한 날짜 없음 */
  selectedDate: DateKey | null;
  /** 날짜별 상태 (조회 대상 장비 기준) */
  statuses: Map<DateKey, DayStatus>;
  /** 달력 위 안내 (예: 예약 가능한 날짜가 있는 달로 이동한 경우) */
  notice?: string | null;
  onSelectDate: (date: DateKey) => void;
  onChangeMonth: (monthStart: DateKey) => void;
  /** 달력 제목 옆 조회 대상 (예: MRI 1호기, 전체 장비 2대) */
  scopeLabel: string;
}

/** 키보드 이동량 (APG Grid 패턴, 공통 DatePicker와 같은 규칙) */
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

const monthOf = (key: DateKey) => `${key.slice(0, 7)}-01`;

/**
 * 월간 슬롯 달력. 날짜마다 슬롯 수와 예약 가능 수를 보여 주고, 날짜를 고르면 상위가 그날 목록을 갱신한다.
 * 오늘 이전·조회 범위(오늘~+119일) 밖 날짜는 선택할 수 없다.
 */
export default function SlotMonthCalendar({
  monthStart,
  today,
  range,
  selectedDate,
  statuses,
  notice,
  onSelectDate,
  onChangeMonth,
  scopeLabel,
}: SlotMonthCalendarProps) {
  const gridRef = useRef<HTMLTableElement>(null);
  const [focusedDate, setFocusedDate] = useState<DateKey | null>(null);
  const shouldFocusRef = useRef(false);

  const { year, month } = parseDateKey(monthStart);
  const canGoPrev = monthStart > monthOf(range.start);
  const canGoNext = monthStart < monthOf(range.end);
  const isCurrentMonth = monthStart === monthOf(today);
  const statusOf = (key: DateKey): DayStatus => statuses.get(key) ?? { kind: "LOADING" };
  const isLoading = [...statuses.values()].some(({ kind }) => kind === "LOADING");

  // 탭 순서에 들어갈 날짜: 키보드로 옮긴 날짜 → 이 달의 선택 날짜 → 오늘 → 1일
  const tabbableDate =
    focusedDate && focusedDate.startsWith(monthStart.slice(0, 7))
      ? focusedDate
      : selectedDate?.startsWith(monthStart.slice(0, 7))
        ? selectedDate
        : today.startsWith(monthStart.slice(0, 7))
          ? today
          : monthStart;

  useEffect(() => {
    if (!shouldFocusRef.current) return;
    shouldFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${tabbableDate}"]`)?.focus();
  }, [tabbableDate, monthStart]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const getNext = KEY_OFFSETS[event.key];
    const current = (event.target as HTMLElement).dataset.date;
    if (!getNext || !current) return;
    event.preventDefault();
    // 이동 가능한 달(조회 범위가 걸친 달) 안으로 제한한다
    const minKey = monthOf(range.start);
    const maxKey = addDays(addMonths(monthOf(range.end), 1), -1);
    const candidate = getNext(current);
    const next = candidate < minKey ? minKey : candidate > maxKey ? maxKey : candidate;
    shouldFocusRef.current = true;
    setFocusedDate(next);
    if (monthOf(next) !== monthStart) onChangeMonth(monthOf(next));
  };

  const cells: (DateKey | null)[] = Array(getWeekday(monthStart)).fill(null);
  for (let day = 1; day <= getDaysInMonth(year, month); day++) cells.push(toDateKey(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <section aria-labelledby="slot-calendar-title" className="@container min-w-0 rounded-xl border border-line bg-white px-3 pb-4 pt-5 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 id="slot-calendar-title" className="text-lg font-bold text-gray-900">
            {year}년 {month}월
          </h2>
          <p className="truncate text-sm text-gray-500" title={scopeLabel}>
            {scopeLabel}
          </p>
          {notice && (
            <p role="status" className="mt-0.5 text-xs text-amber-700">
              {notice}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeMonth(monthOf(today))}
            disabled={isCurrentMonth}
            className="mr-1 h-8 rounded-md border border-line px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
          >
            이번 달
          </button>
          <button
            type="button"
            onClick={() => onChangeMonth(addMonths(monthStart, -1))}
            disabled={!canGoPrev}
            aria-label="이전 달"
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onChangeMonth(addMonths(monthStart, 1))}
            disabled={!canGoNext}
            aria-label="다음 달"
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby="slot-calendar-title"
        aria-busy={isLoading}
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
                className={`pb-1.5 text-center text-xs font-medium ${index === 0 ? "text-red-400" : "text-gray-500"}`}
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
                const status = statusOf(key);
                const selectable = isSelectableDay(status);
                const isSelected = key === selectedDate && selectable;
                const isToday = key === today;
                const meta = DAY_META[status.kind];
                const label = [formatDateLong(key), isToday && "오늘", describeStatus(status)]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <td key={key} aria-selected={isSelected} className="p-0.5">
                    <button
                      type="button"
                      data-date={key}
                      tabIndex={key === tabbableDate ? 0 : -1}
                      aria-disabled={selectable ? undefined : true}
                      aria-label={label}
                      title={describeStatus(status)}
                      // 선택할 수 없는 날짜는 클릭·Enter·Space 모두 무시하고 기존 선택을 유지한다
                      onClick={() => selectable && onSelectDate(key)}
                      onFocus={() => setFocusedDate(key)}
                      className={`flex h-[60px] w-full flex-col items-center justify-start overflow-hidden rounded-lg px-0.5 pt-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary @min-[400px]:h-[68px] ${
                        isSelected ? "bg-primary text-white" : meta.cellClass
                      } ${isToday && !isSelected ? "ring-1 ring-inset ring-primary" : ""}`}
                    >
                      <span className={`font-semibold ${isToday && !isSelected ? "text-primary" : ""}`}>
                        {parseDateKey(key).day}
                      </span>
                      <DayBadge status={status} isSelected={isSelected} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-gray-500" aria-label="달력 표시 안내">
        <LegendItem swatchClass={DAY_META.AVAILABLE.cellClass} label="예약 가능 (숫자: 가능 건수)" />
        <LegendItem swatchClass={DAY_META.UNAVAILABLE.cellClass} label="예약 불가 · 조회만 가능" />
        <LegendItem swatchClass="bg-white ring-1 ring-inset ring-line" label="휴무 · 슬롯 없음 (선택 불가)" />
        <LegendItem swatchClass={DAY_META.PAST_DAY.cellClass} label="지난 날짜 · 조회 범위 밖" />
        <LegendItem swatchClass="ring-1 ring-inset ring-primary" label="오늘" />
      </ul>
    </section>
  );
}

/** 날짜 상태별 칸 스타일 (선택 가능: 파랑 강조 / 조회만 가능: 회색 테두리 / 그 외: 흐린 비활성) */
const DAY_META: Record<DayStatus["kind"], { cellClass: string }> = {
  AVAILABLE: { cellClass: "bg-primary-soft text-gray-900 hover:bg-primary/20" },
  UNAVAILABLE: { cellClass: "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50" },
  NO_SLOTS: { cellClass: "cursor-not-allowed text-gray-300" },
  CLOSED: { cellClass: "cursor-not-allowed text-gray-300" },
  LOADING: { cellClass: "cursor-wait text-gray-300" },
  UNKNOWN: { cellClass: "cursor-not-allowed text-gray-400" },
  PAST_DAY: { cellClass: "cursor-not-allowed bg-gray-50 text-gray-300" },
  OUT_OF_RANGE: { cellClass: "cursor-not-allowed bg-gray-50 text-gray-300" },
};

/** 스크린리더·툴팁용 상태 설명 (색상만으로 구분하지 않도록) */
function describeStatus(status: DayStatus): string {
  switch (status.kind) {
    case "AVAILABLE":
      return `예약 가능 ${status.available}건, 전체 슬롯 ${status.total}건`;
    case "UNAVAILABLE":
      return status.allPast
        ? `슬롯 ${status.total}건 모두 지난 시간, 조회만 가능`
        : `예약 가능 슬롯 없음, 예약 불가 슬롯 ${status.total}건 조회 가능`;
    case "CLOSED":
      return "휴무, 선택 불가";
    case "NO_SLOTS":
      return "슬롯 없음, 선택 불가";
    case "LOADING":
      return "불러오는 중";
    case "UNKNOWN":
      return "슬롯 조회 불가 (서버 기능 준비 중)";
    case "PAST_DAY":
      return "지난 날짜, 선택 불가";
    case "OUT_OF_RANGE":
      return "조회 범위 밖, 선택 불가";
  }
}

/**
 * 날짜 숫자 아래 짧은 표시. 달력 폭(컨테이너 기준)이 좁아 칸이 작으면 문구를 빼고 숫자만 보여
 * 세 자리 건수도 잘리지 않게 한다 (전체 정보는 날짜 버튼의 title·aria-label에 있다)
 */
function DayBadge({ status, isSelected }: { status: DayStatus; isSelected: boolean }) {
  if (status.kind === "AVAILABLE") {
    return (
      <>
        <span
          className={`mt-0.5 max-w-full truncate text-xs font-semibold tabular-nums ${isSelected ? "text-white" : "text-primary"}`}
        >
          <span className="hidden @min-[400px]:inline">가능 </span>
          {status.available}
        </span>
        <span
          className={`hidden max-w-full truncate text-[11px] @min-[400px]:block ${isSelected ? "text-white/85" : "text-gray-500"}`}
        >
          총 {status.total}건
        </span>
      </>
    );
  }
  if (status.kind === "UNAVAILABLE") {
    const text = status.allPast ? "지난 시간" : "예약 불가";
    return (
      <>
        <span className={`mt-0.5 hidden text-[11px] font-medium @min-[400px]:block ${isSelected ? "text-white" : "text-gray-500"}`}>
          {text}
        </span>
        <span className={`mt-0.5 text-[11px] font-medium @min-[400px]:hidden ${isSelected ? "text-white" : "text-gray-500"}`}>
          {status.allPast ? "지남" : "불가"}
        </span>
        <span className={`hidden text-[11px] @min-[400px]:block ${isSelected ? "text-white/85" : "text-gray-400"}`}>
          {status.total}건
        </span>
      </>
    );
  }
  if (status.kind === "CLOSED") {
    return <span className="mt-0.5 text-[11px] text-gray-300">휴무</span>;
  }
  return null;
}

function LegendItem({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded ${swatchClass}`} aria-hidden="true" />
      {label}
    </li>
  );
}
