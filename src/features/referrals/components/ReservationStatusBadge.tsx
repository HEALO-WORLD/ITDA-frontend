import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";

import { RESERVATION_STATUS_LABELS } from "../labels";
import type { ReservationStatusDto } from "../remote";

const TONE: Record<ReservationStatusDto, StatusTone> = {
  REQUESTED: "neutral",
  HELD: "info",
  CONFIRMED: "success",
  FAILED: "warning",
  BLOCKED: "danger",
  CANCELED: "muted",
};

/** 예약 처리 상태 배지 (의뢰기관 상세 대화상자·관리자 의뢰/예약 화면 공용) */
export default function ReservationStatusBadge({ status }: { status: ReservationStatusDto }) {
  return <StatusBadge tone={TONE[status]}>{RESERVATION_STATUS_LABELS[status]}</StatusBadge>;
}
