import { Building2, CalendarDays, Info } from "lucide-react";

import { getWeekday, parseDateKey, type DateKey } from "@/lib/date/seoulDate";
import { formatDateLong, WEEKDAYS } from "@/lib/format/date";

import type { SlotCardGroup } from "../slotResultGroups";
import type { ExamSlot } from "../types";

interface SlotTimeCardsProps {
  /** 오른쪽에 보이는 날짜 (결과 달력에서 고른 날짜) */
  date: DateKey;
  /** 그 날짜의 카드 (groupSlotCards 결과) */
  cards: SlotCardGroup[];
  /** 시간 버튼을 누르면 원본 슬롯 ID를 그대로 넘긴다 (기존 예약 요청·재조정 흐름) */
  onRequestReservation: (slotId: string) => void;
  /** 시간 버튼 이름 끝말 (예약 요청 / 대체 슬롯 선택) */
  actionLabel: string;
  /** 선택 버튼을 모두 비활성화하는 이유 (SlotSearchTable과 같은 의미) */
  actionDisabledReason?: string;
  actionNoteId?: string;
  /** 검색 조건에서 날짜를 지정해 검색했으면 그 날짜 (다른 날짜 조회 안내) */
  lockedDate?: DateKey | "";
  /** PC 재조정 모달: 고른 대체 슬롯 (그 시간 버튼을 선택됨으로 표시, aria-pressed) */
  selectedSlotId?: string;
}

const BLOCKED_TEXT: Record<NonNullable<ExamSlot["blockedReason"]>, string> = {
  EQUIPMENT_FAILURE: "장비 장애",
  OPERATOR_SUSPENDED: "운영 중단",
};

/** 예약 불가 이유 (응답에 예약 불가 슬롯이 있을 때만: Mock). API 검색은 예약 가능한 슬롯만 온다 */
const unavailableText = (slot: ExamSlot) => (slot.blockedReason ? BLOCKED_TEXT[slot.blockedReason] : "예약 마감");

const timeOf = (slot: ExamSlot) => slot.startAt.slice(11, 16);

/**
 * 선택한 날짜의 예약 가능한 시간 카드 (PC 슬롯 검색 화면).
 * 카드 = 같은 날짜·검사기관·장비·세부 검사 항목. 시간 버튼 하나가 슬롯 하나이며 원본 slot.id로 예약 요청을 연다.
 * 상태(hook)를 두지 않는다: 날짜 선택·결과는 상위(SlotSearch)가 가진다
 */
export default function SlotTimeCards({
  date,
  cards,
  onRequestReservation,
  actionLabel,
  actionDisabledReason,
  actionNoteId,
  lockedDate = "",
  selectedSlotId,
}: SlotTimeCardsProps) {
  const { month, day } = parseDateKey(date);
  const availableTotal = cards.reduce((sum, card) => sum + card.availableCount, 0);
  const visibleCards = cards.filter((card) => card.availableCount > 0);

  return (
    <section aria-labelledby="slot-day-title" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="slot-day-title" className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <CalendarDays className="size-5 text-brand-navy/70" aria-hidden="true" />
          {month}월 {day}일 <span className="font-medium text-gray-500">({WEEKDAYS[getWeekday(date)]})</span>
        </h3>
        <p className="text-sm text-gray-600" aria-live="polite">
          예약 가능{" "}
          <strong className="rounded-full bg-brand-mint-soft px-2 py-0.5 font-semibold text-brand-mint-strong tabular-nums">
            {availableTotal}건
          </strong>
          {visibleCards.length > 0 && <span className="ml-1.5 text-gray-500">· 카드 {visibleCards.length}개</span>}
        </p>
      </div>

      {lockedDate && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-brand-canvas px-3.5 py-2.5 text-sm text-gray-700">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-navy/70" aria-hidden="true" />
          <span>
            검색 조건에서 날짜({lockedDate})를 지정해 이 날짜의 결과만 표시합니다. 다른 날짜를 조회하려면 검색 조건의{" "}
            <strong className="font-semibold">검사 날짜</strong>를 해제(날짜 선택 해제)한 뒤 다시 검색해 주세요.
          </span>
        </p>
      )}

      {visibleCards.length === 0 ? (
        <p
          role="status"
          className="rounded-xl border border-dashed border-line-strong bg-brand-canvas px-6 py-14 text-center text-[15px] text-gray-600"
        >
          {lockedDate
            ? "지정한 날짜에 예약 가능한 슬롯이 없습니다. 검사 날짜를 해제하거나 다른 날짜로 다시 검색해 주세요."
            : "선택한 날짜에 예약 가능한 슬롯이 없습니다. 달력에서 다른 날짜를 선택해 주세요."}
        </p>
      ) : (
        <ul aria-label="선택한 날짜의 검사 슬롯" className="flex flex-col gap-3">
          {visibleCards.map((card) => (
            <li key={card.key} className="rounded-xl border border-line bg-white px-5 py-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-gray-900">{card.organizationName}</span>
                    <span className="inline-flex rounded-md bg-brand-navy/5 px-2 py-0.5 text-xs font-semibold text-brand-navy">
                      {card.examType}
                    </span>
                    <span className="break-keep text-[15px] text-gray-800">
                      {card.examTypeName ?? <span className="text-gray-400">세부 검사 항목 확인 불가</span>}
                    </span>
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
                    <Building2 className="size-3.5" aria-hidden="true" />
                    {card.equipmentName}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-brand-mint-soft px-2.5 py-1 text-xs font-semibold text-brand-mint-strong ring-1 ring-inset ring-brand-mint/70">
                  예약 가능 {card.availableCount}
                </span>
              </div>
              <ul aria-label={`${card.organizationName} ${card.equipmentName} 예약 시간`} className="mt-3 flex flex-wrap gap-2">
                {card.slots.map((slot) => {
                  const disabled = !slot.isAvailable || Boolean(actionDisabledReason);
                  const time = timeOf(slot);
                  const isSelected = selectedSlotId !== undefined && slot.id === selectedSlotId;
                  return (
                    <li key={slot.id}>
                      <button
                        type="button"
                        data-slot-id={slot.id}
                        disabled={disabled}
                        aria-pressed={selectedSlotId !== undefined ? isSelected : undefined}
                        title={actionDisabledReason ?? (slot.isAvailable ? undefined : unavailableText(slot))}
                        aria-describedby={actionDisabledReason ? actionNoteId : undefined}
                        aria-label={[
                          time,
                          card.organizationName,
                          card.equipmentName,
                          card.examType,
                          card.examTypeName,
                          formatDateLong(slot.startAt.slice(0, 10)),
                          slot.isAvailable ? actionLabel : `${unavailableText(slot)}, 선택할 수 없음`,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => onRequestReservation(slot.id)}
                        className={`inline-flex h-10 min-w-[76px] items-center justify-center rounded-lg border px-3 text-[15px] font-semibold tabular-nums transition-colors hover:border-primary hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-gray-50 disabled:text-gray-400 disabled:line-through disabled:hover:text-gray-400 ${
                          isSelected ? "border-primary bg-primary text-white ring-2 ring-brand-mint ring-offset-1" : "border-primary/30 bg-white text-primary"
                        }`}
                      >
                        {time}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
