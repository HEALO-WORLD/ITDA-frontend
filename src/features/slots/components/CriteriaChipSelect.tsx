"use client";

import { Check, ChevronDown, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { SelectOption } from "@/components/ui/FormControls";

/**
 * 검색 조건 칩 (PC 슬롯 검색 화면). 칩을 누르면 선택지 목록(listbox)이 열리고, 고르면 입력 상태만 바꾼다 (검색은 [검색 적용]).
 * - 키보드: 칩에서 Enter/Space/↓로 열기, 목록에서 ↑↓·Home/End로 이동, Enter/Space로 선택, Esc로 닫기(칩으로 포커스 복귀), Tab으로 닫기
 * - changed: 마지막으로 검색한 조건과 다르면(아직 결과에 적용 안 됨) 강조하고 읽어 준다
 */

/** 칩 공통 모양 (날짜 칩·토글 칩도 같은 모양을 쓴다) */
export function chipClass(changed: boolean, disabled = false): string {
  const base =
    "relative inline-flex h-10 max-w-full items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  if (disabled) return `${base} cursor-not-allowed border-line bg-gray-50 text-gray-500`;
  if (changed) return `${base} border-amber-400 bg-amber-50 text-gray-900 hover:border-amber-500`;
  return `${base} border-line bg-white text-gray-900 hover:border-primary/50 hover:bg-primary-soft`;
}

/** 칩 안의 '이름 값' 내용 */
export function ChipContent({ label, value, changed, icon }: { label: string; value: ReactNode; changed: boolean; icon?: ReactNode }) {
  return (
    <>
      <span className="shrink-0 text-gray-500">{label}</span>
      <strong className="min-w-0 truncate font-semibold">{value}</strong>
      {changed && (
        <>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="sr-only">, 변경됨 (아직 검색에 적용되지 않음)</span>
        </>
      )}
      {icon}
    </>
  );
}

interface CriteriaChipSelectProps {
  id: string;
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  changed?: boolean;
  /** 고를 수 없는 조건 (재조정의 고정 항목·선택지 없음). 이유는 title·읽기 문구로 알린다 */
  disabled?: boolean;
  disabledReason?: string;
  /** 칩에 보일 값 (기본: 고른 선택지 이름) */
  valueLabel?: string;
  /** 칩 설명(aria-describedby). 예: 세부 검사 항목 초기화 안내 */
  describedBy?: string;
}

export default function CriteriaChipSelect({
  id,
  label,
  options,
  value,
  onChange,
  changed = false,
  disabled = false,
  disabledReason,
  valueLabel,
  describedBy,
}: CriteriaChipSelectProps) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const shownValue = valueLabel ?? options[selectedIndex]?.label ?? "";

  const open = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  };
  const close = (returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  // 열면(또는 키보드로 옮기면) 해당 선택지로 포커스
  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.focus();
  }, [isOpen, activeIndex]);

  // 바깥 클릭 시 닫기 (포커스는 옮기지 않는다)
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, activeIndex + 1),
      ArrowUp: () => Math.max(0, activeIndex - 1),
      Home: () => 0,
      End: () => last,
    };
    if (moves[event.key]) {
      event.preventDefault();
      setActiveIndex(moves[event.key]());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-disabled={disabled || undefined}
        aria-describedby={describedBy}
        title={disabled ? disabledReason : undefined}
        onClick={() => (isOpen ? close(false) : open())}
        onKeyDown={handleTriggerKeyDown}
        className={chipClass(changed, disabled)}
      >
        <ChipContent
          label={label}
          value={shownValue}
          changed={changed}
          icon={
            disabled ? (
              <Lock className="size-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            ) : (
              <ChevronDown className={`size-4 shrink-0 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            )
          }
        />
        {disabled && disabledReason && <span className="sr-only">, 변경할 수 없음: {disabledReason}</span>}
      </button>

      {isOpen && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`${label} 선택`}
          onKeyDown={handleListKeyDown}
          className="absolute left-0 top-full z-30 mt-1.5 max-h-72 min-w-full overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value || "ALL"}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => choose(index)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm outline-none ${
                  index === activeIndex ? "bg-primary-soft" : ""
                } ${isSelected ? "font-semibold text-primary" : "text-gray-800"} focus-visible:ring-2 focus-visible:ring-primary`}
              >
                <Check className={`size-4 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
