import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";

import type { ReferralDisplayStatus } from "../types";

interface ReferralStatusBadgeProps {
  /** FAILED: 백엔드 예약 실패 (API 화면 전용. 화면 표시 상태·필터 선택지에는 넣지 않는다) */
  status: ReferralDisplayStatus | "FAILED";
}

/**
 * 예약 상태 배지 (확정=녹색, 처리 중=파란색, 재조정 필요=빨간색, 취소·만료=회색).
 * 모양은 공통 상태 배지(StatusBadge)를 따른다. 화면 표시용 상태 기준이다.
 */
const STATUS_META: Record<ReferralDisplayStatus, { label: string; tone: StatusTone }> = {
  CONFIRMED: { label: "확정", tone: "success" },
  PROCESSING: { label: "처리 중", tone: "info" },
  RESCHEDULE_REQUIRED: { label: "재조정 필요", tone: "danger" },
  CANCELLED: { label: "취소", tone: "muted" },
  EXPIRED: { label: "재조정 기한 만료", tone: "muted" },
};

/** 백엔드 FAILED(예약 실패). Mock 상태·필터 선택지(REFERRAL_STATUS_LABELS)를 바꾸지 않도록 따로 둔다 */
const FAILED_META = { label: "예약 실패", tone: "warning" as const };

/** 상태 표시 문구 (필터 선택지 등에서 재사용) */
export const REFERRAL_STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS_META).map(([status, { label }]) => [status, label]),
) as Record<ReferralDisplayStatus, string>;

export default function ReferralStatusBadge({ status }: ReferralStatusBadgeProps) {
  const { label, tone } = status === "FAILED" ? FAILED_META : STATUS_META[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
