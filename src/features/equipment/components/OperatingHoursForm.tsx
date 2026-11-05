import { AlertTriangle, CopyCheck, Info } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { WEEKDAYS } from "@/lib/format/date";

import { updateMockOperatingHours } from "../mockEquipmentStore";
import { WEEK_ORDER } from "../operatingHours";
import { hasErrors, validateOperatingDay, type OperatingDayErrors, type OperatingDayInput } from "../rules";
import type { DailyOperatingHours } from "../types";

interface OperatingHoursFormProps {
  organizationId: string;
  equipmentId: string;
  equipmentName: string;
  operatingHours: DailyOperatingHours[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}

const timeClass =
  "h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-400";

/** 평일 (월~금) */
const WEEKDAY_NUMBERS = [1, 2, 3, 4, 5];

/** 저장된 운영 시간 → 요일별 입력 (휴무일은 기본 시간을 채워 두고 꺼 둔다) */
export const toOperatingDayInputs = (hours: DailyOperatingHours[]): OperatingDayInput[] => {
  const byWeekday = new Map(hours.map((item) => [item.weekday, item]));
  return WEEK_ORDER.map((weekday) => {
    const item = byWeekday.get(weekday);
    return {
      weekday,
      isOpen: Boolean(item),
      open: item?.open ?? "09:00",
      close: item?.close ?? "18:00",
      breakStart: item?.breakTime?.start ?? "",
      breakEnd: item?.breakTime?.end ?? "",
    };
  });
};

/** 요일별 입력이 모두 올바른지 (휴무일은 검사하지 않는다) */
export const isOperatingDaysValid = (days: readonly OperatingDayInput[]) =>
  !days.map(validateOperatingDay).some(hasErrors);

interface OperatingHoursFieldsProps {
  days: OperatingDayInput[];
  onChange: (days: OperatingDayInput[]) => void;
  /** 저장(또는 다음 단계)을 시도한 뒤에만 오류를 보인다 */
  showErrors: boolean;
  disabled?: boolean;
  /** 휴게 시간 입력을 보일지 (기본 true). API 모드는 백엔드에 휴게 시간이 없어 false로 숨긴다 */
  allowBreak?: boolean;
}

/**
 * 요일별 운영 시간 입력 (운영 여부·운영 시간·휴게 시간) + 평일 일괄 적용.
 * 운영 시간 수정 폼과 장비 등록 2단계가 함께 쓴다. 검증은 rules.ts의 validateOperatingDay.
 */
export function OperatingHoursFields({ days, onChange, showErrors, disabled = false, allowBreak = true }: OperatingHoursFieldsProps) {
  const update = (weekday: number, patch: Partial<OperatingDayInput>) =>
    onChange(days.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));

  const monday = days.find(({ weekday }) => weekday === 1);
  /** 월요일 설정(운영 여부·시간·휴게)을 화~금에 그대로 적용한다 */
  const applyMondayToWeekdays = () => {
    if (!monday) return;
    onChange(
      days.map((day) =>
        WEEKDAY_NUMBERS.includes(day.weekday) && day.weekday !== 1
          ? { ...monday, weekday: day.weekday }
          : day,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">운영하는 요일을 체크하고 시간을 입력해 주세요.</p>
        <button
          type="button"
          onClick={applyMondayToWeekdays}
          disabled={disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CopyCheck className="size-4" aria-hidden="true" />
          월요일 설정을 평일(화~금)에 적용
        </button>
      </div>

      <fieldset disabled={disabled} className="flex flex-col divide-y divide-line rounded-lg border border-line">
        <legend className="sr-only">요일별 운영 시간</legend>
        {days.map((day) => {
          const errors: OperatingDayErrors = showErrors ? validateOperatingDay(day) : {};
          const label = WEEKDAYS[day.weekday];
          const errorMessages = [...new Set(Object.values(errors).filter(Boolean))];
          const errorId = `hours-${day.weekday}-error`;
          const describedBy = errorMessages.length > 0 ? errorId : undefined;
          return (
            <div key={day.weekday} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="inline-flex w-[88px] shrink-0 cursor-pointer items-center gap-2 text-[15px] font-semibold text-gray-900">
                  <input
                    type="checkbox"
                    checked={day.isOpen}
                    onChange={(e) => update(day.weekday, { isOpen: e.target.checked })}
                    className="size-[18px] cursor-pointer accent-primary"
                  />
                  {label}요일
                </label>
                {day.isOpen ? (
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:max-w-[420px]">
                    <TimeRange
                      label={`${label}요일 운영`}
                      caption="운영"
                      start={day.open}
                      end={day.close}
                      onStart={(open) => update(day.weekday, { open })}
                      onEnd={(close) => update(day.weekday, { close })}
                      startInvalid={Boolean(errors.open)}
                      endInvalid={Boolean(errors.close)}
                      describedBy={describedBy}
                    />
                    {allowBreak && <TimeRange
                      label={`${label}요일 휴게 (선택)`}
                      caption="휴게"
                      start={day.breakStart}
                      end={day.breakEnd}
                      onStart={(breakStart) => update(day.weekday, { breakStart })}
                      onEnd={(breakEnd) => update(day.weekday, { breakEnd })}
                      startInvalid={Boolean(errors.breakStart)}
                      endInvalid={Boolean(errors.breakEnd)}
                      describedBy={describedBy}
                    />}
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">휴무 · 슬롯을 만들지 않습니다</span>
                )}
              </div>
              {errorMessages.length > 0 && (
                <p id={errorId} className="pl-[100px] text-sm text-red-600 max-sm:pl-0">
                  {errorMessages.join(" ")}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}

/**
 * 요일별 운영 시간 수정 (⚠️ Mock: 이 브라우저에만 저장된다).
 * 이미 만들어진 슬롯·예약은 바꾸지 않으며, 새 운영 시간은 이후 슬롯 생성에만 적용된다.
 */
export default function OperatingHoursForm({
  organizationId,
  equipmentId,
  equipmentName,
  operatingHours,
  onCancel,
  onSaved,
}: OperatingHoursFormProps) {
  const [days, setDays] = useState<OperatingDayInput[]>(() => toOperatingDayInputs(operatingHours));
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const isValid = isOperatingDaysValid(days);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowErrors(true);
    if (submittingRef.current || !isValid) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await updateMockOperatingHours(organizationId, equipmentId, days);
      if (result.ok) {
        onSaved(`${equipmentName} 운영 시간을 저장했습니다. 이미 만든 슬롯·예약은 바뀌지 않습니다.`);
        return;
      }
      setSubmitError(result.message);
    } catch {
      setSubmitError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    submittingRef.current = false;
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      {submitError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{submitError}</p>
        </div>
      )}
      {showErrors && !isValid && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          표시된 요일의 운영 시간을 확인해 주세요.
        </p>
      )}

      <OperatingHoursFields days={days} onChange={setDays} showErrors={showErrors} disabled={isSubmitting} />

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <strong className="mr-1 font-semibold">[API 미연동]</strong>
          이 브라우저에만 저장됩니다. 운영 시간을 바꿔도 이미 만든 슬롯·예약은 지우거나 바꾸지 않으며, 새 운영 시간은
          이후 슬롯 생성에 적용됩니다. (기존 슬롯 처리 정책은 백엔드 확정 필요)
        </p>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="h-12 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-12 rounded-lg bg-primary px-6 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {isSubmitting ? "저장 중" : "운영 시간 저장"}
        </button>
      </div>
    </form>
  );
}

function TimeRange({
  label,
  caption,
  start,
  end,
  onStart,
  onEnd,
  startInvalid,
  endInvalid,
  describedBy,
}: {
  label: string;
  caption: string;
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  startInvalid: boolean;
  endInvalid: boolean;
  describedBy?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 items-center gap-1.5">
      <span className="w-8 shrink-0 text-xs font-medium text-gray-500">{caption}</span>
      <input
        type="time"
        step={300}
        aria-label={`${label} 시작`}
        value={start}
        aria-invalid={startInvalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onStart(e.target.value)}
        className={`${timeClass} ${startInvalid ? "border-red-500" : "border-line"}`}
      />
      <span className="text-gray-400" aria-hidden="true">
        ~
      </span>
      <input
        type="time"
        step={300}
        aria-label={`${label} 종료`}
        value={end}
        aria-invalid={endInvalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onEnd(e.target.value)}
        className={`${timeClass} ${endInvalid ? "border-red-500" : "border-line"}`}
      />
    </div>
  );
}
