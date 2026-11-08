import type { ExamSlot } from "../types";

interface SlotStatusBadgeProps {
  isAvailable: boolean;
  /** 장비 장애로 막힌 슬롯이면 마감과 구분해 표시한다 */
  blockedReason?: ExamSlot["blockedReason"];
}

/**
 * 슬롯 예약 상태 배지 (가용=녹색, 마감=회색 · screen-spec 2.4)
 * 서버 상태 enum 확정 시 이 매핑만 교체한다.
 */
const STATUS_META = {
  // 브랜드 범위(itda)에서는 민트 계열 (진한 청록 글자로 대비 유지). 변형 클래스는 CSS에서 뒤에 생성되어 기본 색보다 우선한다
  available: {
    label: "예약 가능",
    className:
      "itda:bg-brand-mint-soft itda:text-brand-mint-strong itda:ring-1 itda:ring-inset itda:ring-brand-mint/70 bg-emerald-50 text-emerald-700",
  },
  closed: { label: "예약 마감", className: "bg-gray-100 text-gray-500" },
  equipmentFailure: { label: "장비 장애", className: "bg-red-50 text-red-600" },
  suspended: { label: "운영 중단", className: "bg-gray-100 text-gray-600" },
} as const;

export default function SlotStatusBadge({ isAvailable, blockedReason }: SlotStatusBadgeProps) {
  const { label, className } =
    STATUS_META[
      blockedReason === "EQUIPMENT_FAILURE"
        ? "equipmentFailure"
        : blockedReason === "OPERATOR_SUSPENDED"
          ? "suspended"
          : isAvailable
            ? "available"
            : "closed"
    ];

  return (
    // 한 줄 고정, 내용 너비만 (상태별 색상은 그대로)
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ${className}`}>
      {label}
    </span>
  );
}
