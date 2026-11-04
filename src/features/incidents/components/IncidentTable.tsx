import { formatDateTime } from "@/lib/format/date";

import type { IncidentRecord } from "../types";

import IncidentStatusBadge from "./IncidentStatusBadge";

interface IncidentTableProps {
  rows: IncidentRecord[];
  /** 상세 모달을 열고 있는 장애 (행 강조용) */
  selectedId: string | null;
  onSelect: (incident: IncidentRecord) => void;
  /** 결과가 없을 때 문구 (장애 이력 없음 / 검색 결과 없음 구분) */
  emptyMessage: string;
  /** 검색 결과가 없을 때 조건 초기화 */
  onResetFilters?: () => void;
}

const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";

/** 장비 장애 목록 (상세 버튼으로 상세 모달 열기). 좁은 화면에서는 표 안에서 가로 스크롤 */
export default function IncidentTable({ rows, selectedId, onSelect, emptyMessage, onResetFilters }: IncidentTableProps) {
  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[15px] text-gray-500"
      >
        {emptyMessage}
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="h-9 rounded-md border border-line bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            검색 조건 초기화
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
      {/* 고정 열 너비: 일시·상태·버튼은 잘리지 않게, 장비명은 남는 폭에서 말줄임 */}
      <table className="w-full min-w-[1000px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[104px]" />
          <col />
          <col className="w-[96px]" />
          <col className="w-[160px]" />
          <col className="w-[160px]" />
          <col className="w-[132px]" />
          <col className="w-[100px]" />
          <col className="w-[104px]" />
        </colgroup>
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>장애번호</th>
            <th scope="col" className={thClass}>장비명</th>
            <th scope="col" className={thClass}>검사 유형</th>
            <th scope="col" className={thClass}>장애 발생일시</th>
            <th scope="col" className={thClass}>복구일시</th>
            <th scope="col" className={`${thClass} text-center!`}>장애 상태</th>
            <th scope="col" className={`${thClass} text-center!`}>영향 예약</th>
            <th scope="col" className={`${thClass} text-center!`}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((incident) => {
            const isSelected = incident.id === selectedId;
            const equipmentName = incident.equipment.name ?? "확인 불가 장비";
            return (
              <tr
                key={incident.id}
                className={`border-t border-line transition-colors ${isSelected ? "bg-primary-soft" : "hover:bg-gray-50"}`}
              >
                <td className={`${tdClass} whitespace-nowrap font-semibold`}>{incident.incidentNumber}</td>
                <td className={`${tdClass} truncate`} title={equipmentName}>
                  {equipmentName}
                </td>
                <td className={tdClass}>{incident.equipment.examType ?? "-"}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(incident.occurredAt)}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                  {incident.resolvedAt ? formatDateTime(incident.resolvedAt) : <span className="text-gray-400">-</span>}
                </td>
                <td className={`${tdClass} text-center`}>
                  <IncidentStatusBadge status={incident.status} />
                </td>
                <td className={`${tdClass} text-center tabular-nums`}>
                  {incident.affectedReservations.length}건
                </td>
                <td className={`${tdClass} text-center`}>
                  <button
                    type="button"
                    onClick={() => onSelect(incident)}
                    aria-label={`${incident.incidentNumber} 상세 보기`}
                    aria-haspopup="dialog"
                    className="h-9 whitespace-nowrap rounded-md border border-primary bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    상세
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
