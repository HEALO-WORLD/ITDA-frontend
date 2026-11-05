import SummaryBar, { type SummaryBarItem } from "@/components/ui/SummaryBar";
import type { IncidentSummaryCounts } from "../types";

/**
 * 장애 현황 요약 바 (집계 기준은 query.ts의 summarizeIncidents, 검색 조건과 무관).
 * - 장애 진행 중 장비: 진행 중 장애가 있는 장비 수
 * - 복구 완료 이력: 복구 완료된 장애 건수
 * - 재조정 필요 예약: 우리 기관이 받은 예약 중 재조정 필요 상태
 */
export default function IncidentSummary({ counts }: { counts: IncidentSummaryCounts }) {
  return (
    <IncidentSummaryBar
      items={[
        { label: "장애 진행 중 장비", value: `${counts.activeEquipmentCount}대`, valueClass: counts.activeEquipmentCount > 0 ? "text-red-600" : "text-gray-900" },
        { label: "복구 완료 이력", value: `${counts.resolvedIncidentCount}건`, valueClass: "text-emerald-700" },
        { label: "재조정 필요 예약", value: `${counts.rescheduleRequiredCount}건`, valueClass: counts.rescheduleRequiredCount > 0 ? "text-red-600" : "text-gray-900" },
      ]}
    />
  );
}

/** 요약 바 모양 (Mock·API 공용, components/ui/SummaryBar) */
export function IncidentSummaryBar({ items, note }: { items: SummaryBarItem[]; note?: string }) {
  return <SummaryBar ariaLabel="장애 현황 요약" items={items} note={note} />;
}
