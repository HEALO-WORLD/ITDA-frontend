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

// 머리글·값은 한 줄 (한글은 단어 중간에서 끊지 않는다). 좁으면 표만 가로로 스크롤한다
const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";

export default function SlotSearchTable({
  slots,
  onRequestReservation,
  actionLabel = "예약 요청",
  actionDisabledReason,
  actionNoteId,
}: SlotSearchTableProps) {
  const button = (slot: ExamSlot, className: string) => (
    <button
      type="button"
      disabled={!slot.isAvailable || Boolean(actionDisabledReason)}
      title={actionDisabledReason}
      aria-describedby={actionDisabledReason ? actionNoteId : undefined}
      onClick={() => onRequestReservation(slot.id)}
      className={`${className} whitespace-nowrap rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400`}
    >
      {actionLabel}
    </button>
  );

  return (
    <>
    {/* 좁은 화면: 표 대신 카드 목록 (같은 열·같은 선택 버튼) */}
    <ul aria-label="검사 슬롯 검색 결과" className="flex flex-col gap-3 md:hidden">
      {slots.map((slot) => (
        <li key={slot.id} className="rounded-xl border border-line bg-white px-4 py-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900">{slot.organizationName}</p>
              <p className="mt-0.5 text-sm text-gray-600">
                {slot.examType} · {slot.examTypeName ?? "세부 검사 항목 확인 불가"}
              </p>
              <p className="mt-1 text-sm text-gray-800">{formatDateTimeWithWeekday(slot.startAt)}</p>
            </div>
            <SlotStatusBadge isAvailable={slot.isAvailable} blockedReason={slot.blockedReason} />
          </div>
          {button(slot, "mt-3 h-11 w-full")}
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto rounded-xl border border-line bg-white shadow-card md:block">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>검사기관</th>
            <th scope="col" className={thClass}>검사 유형</th>
            <th scope="col" className={thClass}>세부 검사 항목</th>
            <th scope="col" className={thClass}>검사 일시</th>
            {/* 상태·선택은 내용 너비만 (w-px): 남는 폭은 검사기관·세부 검사 항목 열로 간다 */}
            <th scope="col" className={`${thClass} w-px text-center!`}>상태</th>
            <th scope="col" className={`${thClass} w-px text-center!`}>선택</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className="border-t border-line">
              <td className={`${tdClass} whitespace-nowrap`}>{slot.organizationName}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{slot.examType}</td>
              <td className={`${tdClass} whitespace-nowrap break-keep`} title={slot.examTypeName}>
                {slot.examTypeName ?? <span className="text-gray-400">—</span>}
              </td>
              <td className={`${tdClass} whitespace-nowrap`}>
                {formatDateTimeWithWeekday(slot.startAt)}
              </td>
              <td className={`${tdClass} text-center`}>
                <SlotStatusBadge isAvailable={slot.isAvailable} blockedReason={slot.blockedReason} />
              </td>
              {/* 예약 요청 ≈ 100px, 대체 슬롯 선택 ≈ 120px (글자 길이만큼, 높이 40px) */}
              <td className={`${tdClass} text-center`}>{button(slot, "h-10 min-w-[100px] px-4")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
