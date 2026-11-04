import type { ExamProgressStatus, ResultRegistrationStatus } from "../types";

/** 검사 진행 상태 (예약 상태 배지와 같은 모양, 다른 색 체계로 혼동을 줄인다) */
const PROGRESS_META: Record<ExamProgressStatus, { label: string; className: string }> = {
  WAITING: { label: "검사 대기", className: "bg-gray-100 text-gray-700" },
  IN_PROGRESS: { label: "검사 진행 중", className: "bg-primary-soft text-primary" },
  COMPLETED: { label: "검사 완료", className: "bg-emerald-50 text-emerald-700" },
  NOT_PERFORMED: { label: "검사 미실시", className: "bg-gray-100 text-gray-400" },
};

/** 결과 등록 상태 */
const RESULT_META: Record<ResultRegistrationStatus, { label: string; className: string }> = {
  REGISTERED: { label: "등록 완료", className: "bg-emerald-50 text-emerald-700" },
  PENDING: { label: "미등록", className: "bg-amber-50 text-amber-800" },
  BEFORE_EXAM: { label: "검사 후 등록", className: "text-gray-500" },
  NOT_APPLICABLE: { label: "등록 대상 아님", className: "text-gray-400" },
};

export const PROGRESS_STATUS_LABELS = Object.fromEntries(
  Object.entries(PROGRESS_META).map(([status, { label }]) => [status, label]),
) as Record<ExamProgressStatus, string>;

export const RESULT_REGISTRATION_LABELS = Object.fromEntries(
  Object.entries(RESULT_META).map(([status, { label }]) => [status, label]),
) as Record<ResultRegistrationStatus, string>;

const badgeClass = "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ring-1 ring-inset ring-black/5";

export function ProgressStatusBadge({ status }: { status: ExamProgressStatus }) {
  const { label, className } = PROGRESS_META[status];
  return <span className={`${badgeClass} ${className}`}>{label}</span>;
}

export function ResultRegistrationBadge({ status }: { status: ResultRegistrationStatus }) {
  const { label, className } = RESULT_META[status];
  return <span className={`${badgeClass} ${className}`}>{label}</span>;
}
