import { formatDateTimeWithWeekday } from "@/lib/format/date";

import type { ExamSlot } from "../types";

import SlotStatusBadge from "./SlotStatusBadge";

interface SlotSearchTableProps {
  slots: ExamSlot[];
  /** 예약 요청 클릭 시 슬롯 식별자를 전달한다 */
  onRequestReservation: (slotId: string) => void;
  /** 선택 버튼 문구 (재조정 모드에서 신규 예약 요청과 구분) */
  actionLabel?: string;
  /**
   * 선택 버튼을 모두 비활성화하는 이유 (API 모드: 실제 슬롯 예약 요청 미연동).
   * 버튼 title과 aria-describedby(actionNoteId)로 이유를 알린다
   */
  actionDisabledReason?: string;
  /** 표 밖에 표시한 비활성 안내 요소의 id */
  actionNoteId?: string;
}

const thClass = "border-b border-line px-6 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-6 py-4 text-sm text-gray-700";

export default function SlotSearchTable({
  slots,
  onRequestReservation,
  actionLabel = "예약 요청",
  actionDisabledReason,
  actionNoteId,
}: SlotSearchTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
      <table className="w-full min-w-[880px] border-collapse">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>검사기관</th>
            <th scope="col" className={thClass}>검사 장비</th>
            <th scope="col" className={thClass}>검사 유형</th>
            <th scope="col" className={thClass}>검사 일시</th>
            <th scope="col" className={`${thClass} text-center!`}>상태</th>
            <th scope="col" className={`${thClass} text-center!`}>선택</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className="border-t border-line">
              <td className={`${tdClass} whitespace-nowrap`}>{slot.organizationName}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{slot.equipmentName}</td>
              <td className={tdClass}>{slot.examType}</td>
              <td className={`${tdClass} whitespace-nowrap`}>
                {formatDateTimeWithWeekday(slot.startAt)}
              </td>
              <td className={`${tdClass} text-center`}>
                <SlotStatusBadge isAvailable={slot.isAvailable} blockedReason={slot.blockedReason} />
              </td>
              <td className={`${tdClass} text-center`}>
                <button
                  type="button"
                  disabled={!slot.isAvailable || Boolean(actionDisabledReason)}
                  title={actionDisabledReason}
                  aria-describedby={actionDisabledReason ? actionNoteId : undefined}
                  onClick={() => onRequestReservation(slot.id)}
                  className="h-12 w-[136px] rounded-lg bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {actionLabel}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
