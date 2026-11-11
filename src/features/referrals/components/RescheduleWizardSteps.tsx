import { Check } from "lucide-react";

/** PC 예약 재조정 모달의 3단계 */
export const RESCHEDULE_WIZARD_STEPS = ["기존 예약 확인", "대체 슬롯 선택", "변경 내용 확인·요청"] as const;

/**
 * 예약 재조정 진행 단계 표시 (PC 단일 모달).
 * 1·2단계는 한 화면(왼쪽 기존 예약 + 오른쪽 대체 슬롯 검색)이라, 슬롯을 고르는 동안 1단계는 완료로 보인다.
 * 단계 이동은 화면의 버튼으로만 한다 (표시 전용, 누를 수 없음)
 */
export default function RescheduleWizardSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="예약 재조정 단계" className="flex items-center gap-2">
      {RESCHEDULE_WIZARD_STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < current ? "done" : step === current ? "current" : "upcoming";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 items-center gap-2">
            {index > 0 && <span aria-hidden="true" className={`h-px w-8 shrink-0 ${step <= current ? "bg-brand-navy" : "bg-line-strong"}`} />}
            <span
              aria-hidden="true"
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === "done"
                  ? "bg-brand-mint text-brand-navy"
                  : state === "current"
                    ? "bg-brand-navy text-white"
                    : "bg-white text-gray-400 ring-1 ring-inset ring-line-strong"
              }`}
            >
              {state === "done" ? <Check className="size-3.5" /> : step}
            </span>
            <span className={`whitespace-nowrap text-sm ${state === "current" ? "font-bold text-gray-900" : state === "done" ? "font-medium text-gray-700" : "text-gray-400"}`}>
              {label}
              <span className="sr-only">{state === "done" ? " (완료)" : state === "current" ? " (현재 단계)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
