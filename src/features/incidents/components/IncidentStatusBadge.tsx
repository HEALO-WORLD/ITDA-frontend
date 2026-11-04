import type { IncidentStatus } from "../types";

/** 장애 상태 배지 (진행 중=빨간색, 복구 완료=녹색 · 예약 상태 배지와 같은 모양) */
const STATUS_META: Record<IncidentStatus, { label: string; className: string; dotClass: string }> = {
  ACTIVE: { label: "장애 진행 중", className: "bg-red-50 text-red-600", dotClass: "bg-red-500" },
  RESOLVED: { label: "복구 완료", className: "bg-emerald-50 text-emerald-700", dotClass: "bg-emerald-500" },
};

/** 상태 표시 문구 (필터 선택지 등에서 재사용) */
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  ACTIVE: STATUS_META.ACTIVE.label,
  RESOLVED: STATUS_META.RESOLVED.label,
};

export default function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const { label, className, dotClass } = STATUS_META[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ring-1 ring-inset ring-black/5 ${className}`}
    >
      <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}
