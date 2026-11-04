import { formatDateTime } from "@/lib/format/date";

import { getResultRegistrationStatus } from "../rules";
import type { Examination } from "../types";

import { ProgressStatusBadge, ResultRegistrationBadge } from "./ExaminationBadges";

interface ExaminationTableProps {
  rows: Examination[];
  /** 모달을 열고 있는 검사 (행 강조용) */
  selectedId: string | null;
  onOpenDetail: (examination: Examination) => void;
  onOpenRegister: (examination: Examination) => void;
  /** 결과가 없을 때 문구 (검사 없음 / 검색 결과 없음 구분) */
  emptyMessage: string;
  /** 검색 결과가 없을 때 조건 초기화 */
  onResetFilters?: () => void;
}

const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";
const actionClass =
  "h-9 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/**
 * 검사 목록. [상세]는 모든 행, [결과 등록]은 검사 완료·결과 미등록 행에만 둔다.
 * 좁은 화면에서는 표 안에서만 가로 스크롤한다.
 */
export default function ExaminationTable({
  rows,
  selectedId,
  onOpenDetail,
  onOpenRegister,
  emptyMessage,
  onResetFilters,
}: ExaminationTableProps) {
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
      {/* 고정 열 너비: 번호·일시·상태·버튼은 잘리지 않게, 장비명은 남는 폭에서 말줄임 */}
      <table className="w-full min-w-[1000px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[100px]" />
          <col className="w-[128px]" />
          <col className="w-[96px]" />
          <col />
          <col className="w-[168px]" />
          <col className="w-[136px]" />
          <col className="w-[136px]" />
          <col className="w-[184px]" />
        </colgroup>
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>의뢰번호</th>
            <th scope="col" className={thClass}>가상 환자 ID</th>
            <th scope="col" className={thClass}>검사 유형</th>
            <th scope="col" className={thClass}>검사 장비</th>
            <th scope="col" className={thClass}>검사 예정 일시</th>
            <th scope="col" className={`${thClass} text-center!`}>진행 상태</th>
            <th scope="col" className={`${thClass} text-center!`}>결과 상태</th>
            <th scope="col" className={thClass}>작업</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((examination) => {
            const resultStatus = getResultRegistrationStatus(examination);
            const isSelected = examination.id === selectedId;
            return (
              <tr
                key={examination.id}
                className={`border-t border-line transition-colors ${isSelected ? "bg-primary-soft" : "hover:bg-gray-50"}`}
              >
                <td className={`${tdClass} whitespace-nowrap font-semibold`}>{examination.referralNumber}</td>
                <td className={`${tdClass} truncate tabular-nums`} title={examination.virtualPatientId}>
                  {examination.virtualPatientId}
                </td>
                <td className={tdClass}>{examination.examType}</td>
                <td className={`${tdClass} truncate`} title={examination.equipmentName}>
                  {examination.equipmentName}
                </td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(examination.scheduledAt)}</td>
                <td className={`${tdClass} text-center`}>
                  <ProgressStatusBadge status={examination.progressStatus} />
                </td>
                <td className={`${tdClass} text-center`}>
                  <ResultRegistrationBadge status={resultStatus} />
                </td>
                <td className={tdClass}>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(examination)}
                      aria-label={`${examination.referralNumber} 상세 보기`}
                      aria-haspopup="dialog"
                      className={`${actionClass} border border-primary bg-white text-primary hover:bg-primary-soft`}
                    >
                      상세
                    </button>
                    {resultStatus === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => onOpenRegister(examination)}
                        aria-label={`${examination.referralNumber} 결과 등록`}
                        aria-haspopup="dialog"
                        className={`${actionClass} bg-primary text-white hover:bg-primary-hover`}
                      >
                        결과 등록
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
