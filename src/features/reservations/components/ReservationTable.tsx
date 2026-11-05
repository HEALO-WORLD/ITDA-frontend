
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { formatDateTime } from "@/lib/format/date";

import type { Reservation } from "../types";

interface ReservationTableProps {
  /** 검색 조건에 맞는 예약 전체 */
  rows: Reservation[];

  /** 상세 모달을 열고 있는 예약 */
  selectedId: string | null;

  /** 상세 버튼 클릭 */
  onSelect: (reservation: Reservation) => void;

  /** 검색 결과가 없을 때 표시할 문구 */
  emptyMessage: string;

  /** 검색 조건 초기화 */
  onResetFilters?: () => void;
}

const thClass =
  "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";

const tdClass = "px-4 py-3.5 text-sm text-gray-700";

/**
 * 검사기관 예약 목록
 *
 * - 검색 결과 전체 표시
 * - 예약 상태 표시
 * - 예약 상세 모달 열기
 * - 검색 결과 0건 안내
 *
 * 프론트 페이지네이션은 적용하지 않는다.
 */
export default function ReservationTable({
  rows,
  selectedId,
  onSelect,
  emptyMessage,
  onResetFilters,
}: ReservationTableProps) {
  /**
   * 검색 결과가 없는 경우
   */
  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[15px] text-gray-500"
      >
        <p>{emptyMessage}</p>

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
      {/* 예약 목록 테이블 */}
      <table className="w-full min-w-[820px] table-fixed border-collapse">
        {/* 열 너비 */}
        <colgroup>
          <col className="w-[104px]" />
          <col />
          <col className="w-[96px]" />
          <col className="w-[18%]" />
          <col className="w-[168px]" />
          <col className="w-[132px]" />
          <col className="w-[96px]" />
        </colgroup>

        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>
              예약번호
            </th>

            <th scope="col" className={thClass}>
              의뢰기관
            </th>

            <th scope="col" className={thClass}>
              검사 유형
            </th>

            <th scope="col" className={thClass}>
              검사 장비
            </th>

            <th scope="col" className={thClass}>
              검사 일시
            </th>

            <th
              scope="col"
              className={`${thClass} text-center!`}
            >
              예약 상태
            </th>

            <th
              scope="col"
              className={`${thClass} text-center!`}
            >
              상세
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((reservation) => {
            const isSelected =
              reservation.id === selectedId;

            return (
              <tr
                key={reservation.id}
                className={`border-t border-line transition-colors ${
                  isSelected
                    ? "bg-primary-soft"
                    : "hover:bg-gray-50"
                }`}
              >
                {/* 예약번호 */}
                <td
                  className={`${tdClass} whitespace-nowrap font-semibold`}
                >
                  {reservation.referralNumber}
                </td>

                {/* 의뢰기관 */}
                <td
                  className={`${tdClass} truncate`}
                  title={
                    reservation.referringOrganizationName
                  }
                >
                  {reservation.referringOrganizationName}
                </td>

                {/* 검사 유형 */}
                <td className={tdClass}>
                  {reservation.examType}
                </td>

                {/* 검사 장비 */}
                <td
                  className={`${tdClass} truncate`}
                  title={reservation.equipmentName}
                >
                  {reservation.equipmentName}
                </td>

                {/* 검사 일시 */}
                <td
                  className={`${tdClass} whitespace-nowrap tabular-nums`}
                >
                  {formatDateTime(reservation.scheduledAt)}
                </td>

                {/* 예약 상태 */}
                <td
                  className={`${tdClass} text-center`}
                >
                  <ReferralStatusBadge
                    status={reservation.status}
                  />
                </td>

                {/* 상세 버튼 */}
                <td
                  className={`${tdClass} text-center`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(reservation)}
                    aria-label={`${reservation.referralNumber} 상세 보기`}
                    aria-haspopup="dialog"
                    className="h-9 rounded-md border border-primary bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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
