import { CalendarDays, ChevronDown } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** 검색 필터 등에서 쓰는 공통 입력 컨트롤 (와이어프레임: 흰 배경, 연회색 테두리, 우측 아이콘) */

export const fieldLabelClass = "mb-2 block text-[15px] font-bold text-gray-800";

export const controlClass =
  "h-12 w-full appearance-none rounded-lg border border-line bg-white pl-4 pr-11 text-[15px] text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50";

export const iconClass =
  "pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-gray-500";

interface FieldProps {
  id: string;
  label: string;
  /** 라벨 뒤에 붙는 요소 (예: 필수 표시 *, '(선택)'). 없으면 기존과 같다 */
  labelAddon?: ReactNode;
}

export interface SelectOption {
  value: string;
  label: string;
}

type SelectInputProps = FieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    options: SelectOption[];
  };

export function SelectInput({ id, label, labelAddon, options, className = "", ...props }: SelectInputProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
        {labelAddon}
      </label>
      <div className="relative">
        <select id={id} className={controlClass} {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className={iconClass} aria-hidden="true" />
      </div>
    </div>
  );
}

type TextInputProps = FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
    /** 입력 아래 오류 문구. 있으면 aria-invalid로 연결한다 */
    error?: string;
  };

export function TextInput({ id, label, labelAddon, error, className = "", ...props }: TextInputProps) {
  const errorId = `${id}-error`;

  return (
    <div className={className}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
        {labelAddon}
      </label>
      <input
        id={id}
        type="text"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${controlClass} pr-4 placeholder:text-gray-400 ${error ? "border-red-500" : ""}`}
        {...props}
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

type DateInputProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">;

export function DateInput({ id, label, labelAddon, className = "", ...props }: DateInputProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
        {labelAddon}
      </label>
      <div className="relative">
        {/* 브라우저 기본 달력 아이콘은 투명하게 아이콘 위치에 겹쳐 클릭 영역으로만 사용한다 */}
        <input
          id={id}
          type="date"
          className={`${controlClass} [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:size-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`}
          {...props}
        />
        <CalendarDays className={iconClass} aria-hidden="true" />
      </div>
    </div>
  );
}
