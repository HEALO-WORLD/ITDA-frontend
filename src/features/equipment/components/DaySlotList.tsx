import { CalendarX2 } from "lucide-react";
import type { ReactNode } from "react";

import { isUpcomingSlot } from "@/features/slots/availability";
import type { ExamSlot } from "@/features/slots/types";
import type { DateKey } from "@/lib/date/seoulDate";
import { formatDateLong } from "@/lib/format/date";

import { addMinutesToTime } from "../operatingHours";

/**
 * 화면 표시용 슬롯 상태 (isAvailable·시작 시각·장비 장애 차단으로만 판단, 그 외 상태는 만들지 않는다)
 * EQUIPMENT_FAILURE = 원래 예약 가능했지만 장비 장애(진행 중)로 막힌 슬롯
 * SUSPENDED = 검사기관이 운영 중단한 슬롯 (생성한 슬롯만)
 */
export type SlotDisplayStatus = "AVAILABLE" | "UNAVAILABLE" | "EQUIPMENT_FAILURE" | "SUSPENDED" | "PAST";

export function getSlotDisplayStatus(slot: ExamSlot, nowDateTime: string): SlotDisplayStatus {
  if (!isUpcomingSlot(slot, nowDateTime)) return "PAST";
  if (slot.blockedReason === "EQUIPMENT_FAILURE") return "EQUIPMENT_FAILURE";
  if (slot.blockedReason === "OPERATOR_SUSPENDED") return "SUSPENDED";
  return slot.isAvailable ? "AVAILABLE" : "UNAVAILABLE";
}

export const SLOT_STATUS_META: Record<SlotDisplayStatus, { label: string; className: string }> = {
  AVAILABLE: { label: "예약 가능", className: "bg-primary-soft text-primary" },
  UNAVAILABLE: { label: "예약 불가", className: "bg-gray-100 text-gray-600" },
  EQUIPMENT_FAILURE: { label: "장비 장애", className: "bg-red-50 text-red-600" },
  SUSPENDED: { label: "운영 중단", className: "bg-gray-100 text-gray-500 line-through decoration-gray-400" },
  PAST: { label: "지난 시간", className: "bg-white text-gray-400 ring-1 ring-inset ring-line" },
};

/** 목록 위 안내가 필요한 경우 */
export type DayListState =
  | { kind: "LOADING" }
  | { kind: "NO_EQUIPMENT" }
  | { kind: "NO_MATCH" }
  /** 선택한 날짜가 없거나 더는 조회할 수 없는 경우의 안내 */
  | { kind: "MESSAGE"; message: string }
  | { kind: "READY" };

interface DaySlotListProps {
  /** null = 선택한 날짜 없음 */
  date: DateKey | null;
  state: DayListState;
  /** 조회 대상 장비의 그날 슬롯 (시작 시각 → 장비명 순) */
  slots: ExamSlot[];
  /** 조회 대상 표시 (예: MRI 1호기 · MRI, 검색 결과 전체 12대) */
  scopeLabel: string;
  /** 개별 장비 선택 시 장비명, 전체 보기면 null */
  singleEquipmentName: string | null;
  /** 개별 장비 모드에서 같은 날 다른 장비의 슬롯 수 (빈 상태 안내용) */
  otherEquipmentSlotCount: number;
  slotMinutes: Map<string, number>;
  nowDateTime: string;
  onSelectSlot: (slot: ExamSlot) => void;
  /**
   * 슬롯별 상태 표시 (API 모드: 서버 상태 원본 + 지난 시간 표시). 없으면 Mock 화면의 getSlotDisplayStatus를 쓴다
   * isPast면 행을 흐리게 하고 '지난 시간'을 덧붙인다 (원본 상태는 그대로 보여 준다)
   */
  statusOf?: (slot: ExamSlot) => { label: string; className: string; isPast: boolean };
  /** 슬롯별 종료 시각 `HH:mm` (API 모드: 서버 endsAt). 없으면 장비 소요 시간(slotMinutes)으로 계산한다 */
  endTimeOf?: (slot: ExamSlot) => string;
  /** 제목 아래 필터 영역 (API 모드). 없으면 표시하지 않는다 */
  toolbar?: ReactNode;
  /** 제목 아래 건수 줄 대신 보여 줄 내용 (API 모드: 전체·필터 결과·페이지). 없으면 넘겨받은 slots로 센다 */
  countSummary?: ReactNode;
  /** slots가 비었을 때 기본 안내 대신 보여 줄 문구 (API 모드: 필터 결과 0건) */
  emptyMessage?: ReactNode;
  /** 목록 아래 (API 모드: 페이지 이동) */
  footer?: ReactNode;
}

/**
 * 선택 날짜의 슬롯 (간결한 표).
 * 슬롯이 많아도 행 높이를 낮게 두고, 목록 안에서만 세로 스크롤하며 머리글은 고정한다 (모든 슬롯을 볼 수 있다).
 * 행이나 [상세]를 누르면 슬롯 상세(운영 중단·재개 포함)를 연다.
 */
export default function DaySlotList({
  date,
  state,
  slots,
  scopeLabel,
  singleEquipmentName,
  otherEquipmentSlotCount,
  slotMinutes,
  nowDateTime,
  onSelectSlot,
  statusOf,
  endTimeOf,
  toolbar,
  countSummary,
  emptyMessage,
  footer,
}: DaySlotListProps) {
  const availableCount = slots.filter((slot) => getSlotDisplayStatus(slot, nowDateTime) === "AVAILABLE").length;
  const viewOf = (slot: ExamSlot) => {
    if (statusOf) return statusOf(slot);
    const status = getSlotDisplayStatus(slot, nowDateTime);
    return { ...SLOT_STATUS_META[status], isPast: status === "PAST" };
  };

  return (
    <section aria-labelledby="day-slot-title" className="flex min-w-0 flex-col rounded-xl border border-line bg-white px-4 pb-4 pt-5 sm:px-5">
      <div className="mb-3">
        <h2 id="day-slot-title" className="text-lg font-bold text-gray-900">
          선택 날짜의 슬롯
        </h2>
        <p className="mt-0.5 text-[15px] font-semibold text-gray-800">{date ? formatDateLong(date) : "날짜를 선택해 주세요"}</p>
        <p className="text-sm text-gray-500" aria-live="polite">
          <span className="break-all">{scopeLabel}</span>
          {countSummary !== undefined
            ? state.kind === "READY" && countSummary
            : state.kind === "READY" && slots.length > 0 && <> · 전체 {slots.length}건 · 예약 가능 {availableCount}건</>}
        </p>
      </div>
      {toolbar}

      {state.kind !== "READY" ? (
        <EmptyMessage>
          {state.kind === "LOADING" && "슬롯을 불러오고 있습니다."}
          {state.kind === "NO_EQUIPMENT" && "등록된 장비가 없어 표시할 슬롯이 없습니다."}
          {state.kind === "NO_MATCH" && "검색 조건에 맞는 장비가 없어 표시할 슬롯이 없습니다."}
          {state.kind === "MESSAGE" && state.message}
        </EmptyMessage>
      ) : slots.length === 0 ? (
        <EmptyMessage>
          {emptyMessage ?? (singleEquipmentName
            ? otherEquipmentSlotCount > 0
              ? `${singleEquipmentName}에는 이 날짜 슬롯이 없습니다. (다른 장비 ${otherEquipmentSlotCount}건)`
              : `${singleEquipmentName}에는 이 날짜 슬롯이 없습니다.`
            : "이 날짜에는 슬롯이 없습니다.")}
        </EmptyMessage>
      ) : (
        <div className="@container max-h-[560px] overflow-auto rounded-lg border border-line">
          {/*
            한 장비만 볼 때는 장비명을 위 제목에서 보여 주므로 장비명 열을 뺀다.
            전체 보기라도 목록 폭이 좁으면(컨테이너 기준) 장비명을 시간 아래 줄로 옮겨 상태·관리가 가로 스크롤 없이 보이게 한다.
            그보다 더 좁으면 최소 폭을 지키고 가로 스크롤한다.
          */}
          <table className="w-full min-w-[240px] table-fixed border-collapse text-sm">
            {/* 스크롤해도 머리글은 위에 고정 */}
            <thead className="sticky top-0 z-[1] bg-gray-100">
              <tr>
                <th scope="col" className="w-[104px] px-2.5 py-2 text-left font-semibold text-gray-700">시간</th>
                {!singleEquipmentName && (
                  <th scope="col" className="hidden px-2 py-2 text-left font-semibold text-gray-700 @min-[360px]:table-cell">
                    장비명
                  </th>
                )}
                <th scope="col" className="w-[84px] px-2 py-2 text-left font-semibold text-gray-700">상태</th>
                <th scope="col" className="w-[52px] px-2 py-2 text-center font-semibold text-gray-700">관리</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const { label: statusLabel, className, isPast } = viewOf(slot);
                // API 모드는 원본 상태 옆에 지난 시간을 덧붙인다 (Mock은 상태 자체가 '지난 시간')
                const label = statusOf && isPast ? `${statusLabel} · 지난 시간` : statusLabel;
                const start = slot.startAt.slice(11, 16);
                const end = endTimeOf ? endTimeOf(slot) : addMinutesToTime(start, slotMinutes.get(slot.equipmentId) ?? 30);
                return (
                  <tr
                    key={slot.id}
                    onClick={() => onSelectSlot(slot)}
                    className={`cursor-pointer border-t border-line hover:bg-gray-50 ${isPast ? "text-gray-400" : ""}`}
                  >
                    <td className="whitespace-nowrap px-2.5 py-1 font-semibold tabular-nums text-gray-900">
                      {start}
                      <span className="font-normal text-gray-400">~{end}</span>
                      {!singleEquipmentName && (
                        <span
                          className="block truncate text-xs font-medium text-gray-600 @min-[360px]:hidden"
                          title={`${slot.equipmentName} · ${slot.examType}`}
                        >
                          {slot.equipmentName}
                        </span>
                      )}
                    </td>
                    {!singleEquipmentName && (
                      <td
                        className="hidden truncate px-2 py-1 font-medium text-gray-800 @min-[360px]:table-cell"
                        title={`${slot.equipmentName} · ${slot.examType}`}
                      >
                        {slot.equipmentName}
                      </td>
                    )}
                    <td className="px-2 py-1">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectSlot(slot);
                        }}
                        aria-label={`${start}~${end} ${slot.equipmentName} ${slot.examType} ${label} 상세 보기`}
                        aria-haspopup="dialog"
                        className="h-6 whitespace-nowrap rounded-md border border-line bg-white px-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary"
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
      )}
      {state.kind === "READY" && footer}
    </section>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-gray-500">
      <CalendarX2 className="size-6 text-gray-300" aria-hidden="true" />
      {children}
    </p>
  );
}
