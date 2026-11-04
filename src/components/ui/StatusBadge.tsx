import type { ReactNode } from "react";

/**
 * 공통 상태 배지 (의뢰·예약·장비·슬롯·검사·회원 상태 등 모든 화면에서 같은 크기·모양).
 * 색 의미: success 완료·확정 / info 진행 중 / warning 실패·주의 / danger 재조정·장애 / neutral 대기·일반 / muted 취소·비활성
 */
export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  info: "bg-primary-soft text-primary ring-primary/20",
  warning: "bg-orange-50 text-orange-700 ring-orange-600/20",
  danger: "bg-red-50 text-red-600 ring-red-600/20",
  neutral: "bg-gray-100 text-gray-700 ring-gray-500/20",
  muted: "bg-gray-100 text-gray-500 ring-gray-400/20",
};

const DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  info: "bg-primary",
  warning: "bg-orange-500",
  danger: "bg-red-500",
  neutral: "bg-gray-500",
  muted: "bg-gray-400",
};

export default function StatusBadge({ tone, children, dot = true }: { tone: StatusTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ring-1 ring-inset ${TONE_CLASS[tone]}`}>
      {dot && <span className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
