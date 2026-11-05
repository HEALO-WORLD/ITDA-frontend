"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import { secondaryButtonClass } from "@/components/ui/styles";
import { useDetailResult } from "@/features/admin/components/AdminDetailParts";
import type { ApiExamSlot } from "@/features/slots/apiSlots";
import { loadSlotDetailAction } from "@/features/slots/managementActions";
import type { ManagementSlotDetailResult } from "@/features/slots/managementServer";
import {
  API_SLOT_STATUS_META,
  buildApiMonthDayStatuses,
  buildDaySlotView,
  EMPTY_DAY_SLOT_FILTERS,
  isDaySlotFiltered,
  type DaySlotFilters,
  getApiSlotStatusView,
  getManagementDayRange,
  type MonthSlotsState,
  type MonthSlotStore,
} from "@/features/slots/managementMonth";
import type { ExamSlot } from "@/features/slots/types";
import type { DateKey } from "@/lib/date/seoulDate";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import type { EquipmentDto } from "../remote";

import DaySlotList, { type DayListState } from "./DaySlotList";
import SlotMonthCalendar from "./SlotMonthCalendar";

/**
 * 장비·슬롯 운영(API 모드)의 월간 달력 + 선택 날짜 슬롯 + 슬롯 상세(조회만).
 * 기존 SlotMonthCalendar·DaySlotList를 그대로 쓰고, 데이터만 실제 관리 조회(GET /api/v1/slots?view=MANAGEMENT)로 바꾼다.
 * - 표시 중인 달만 조회하고(월 캐시 store), 장비 선택·CT/MRI·검색은 받은 슬롯에서 거른다 (다시 요청하지 않는다)
 * - 조회 실패는 0건·슬롯 없음으로 보이지 않고 '불러오지 못함'으로 둔다 (Mock으로 대신하지 않는다)
 * - 지난 날짜도 관리 목적으로 조회할 수 있다 (오늘 기준 3달 전 달부터). 지난 슬롯은 원본 상태 옆에 '지난 시간'을 표시한다
 * - 슬롯 상세는 조회만 한다: Mock 상세(SlotDetail)의 운영 중단·재개는 API 계약 확인 전이라 쓰지 않는다
 */

const monthOf = (key: DateKey) => `${key.slice(0, 7)}-01`;

interface ApiSlotScheduleProps {
  store: MonthSlotStore;
  monthStates: Readonly<Record<DateKey, MonthSlotsState>>;
  today: DateKey;
  nowDateTime: string;
  /** 검색·CT/MRI 필터를 적용한 장비 */
  visibleEquipments: EquipmentDto[];
  /** 개별 선택한 장비 (전체 보기면 null) */
  selectedEquipment: EquipmentDto | null;
  totalEquipmentCount: number;
  scopeLabel: string;
}

export default function ApiSlotSchedule({
  store,
  monthStates,
  today,
  nowDateTime,
  visibleEquipments,
  selectedEquipment,
  totalEquipmentCount,
  scopeLabel,
}: ApiSlotScheduleProps) {
  const range = getManagementDayRange(today);
  const [monthStart, setMonthStart] = useState<DateKey>(() => monthOf(today));
  const [selectedDate, setSelectedDate] = useState<DateKey | null>(null);
  const [detailSlot, setDetailSlot] = useState<ExamSlot | null>(null);

  // 표시 중인 달과 선택 날짜의 달을 요청한다 (받은 달·요청 중인 달은 store가 건너뛴다)
  const selectedMonth = selectedDate ? monthOf(selectedDate) : null;
  useEffect(() => {
    store.request(monthStart);
    if (selectedMonth) store.request(selectedMonth);
  }, [store, monthStart, selectedMonth, monthStates]);

  const scopeIds = selectedEquipment ? [selectedEquipment.id] : visibleEquipments.map((item) => item.id);
  const monthState = monthStates[monthStart];
  const statuses = buildApiMonthDayStatuses(monthStart, monthState, scopeIds, range, nowDateTime);

  // 선택 날짜의 슬롯: 상단 장비 범위 → 날짜 → CT/MRI → 상태 → 오전/오후 → 10건씩 (받은 월 데이터에서 계산, 서버 재요청 없음)
  // 필터 값은 날짜를 바꿔도 유지하고, 페이지는 날짜·필터가 바뀌면 1페이지로 돌아간다
  const [filters, setFilters] = useState<DaySlotFilters>(EMPTY_DAY_SLOT_FILTERS);
  const pageKey = `${selectedDate}|${filters.modality}|${filters.status}|${filters.timeOfDay}`;
  const [pageState, setPageState] = useState({ key: pageKey, page: 1 });
  const requestedPage = pageState.key === pageKey ? pageState.page : 1;
  const dayState = selectedMonth ? monthStates[selectedMonth] : undefined;
  const equipmentModality = new Map(visibleEquipments.map((item) => [item.id.toLowerCase(), item.modality]));
  const view =
    selectedDate && dayState?.status === "loaded"
      ? buildDaySlotView({ monthSlots: dayState.slots, date: selectedDate, scopeEquipmentIds: scopeIds, equipmentModality, filters, page: requestedPage })
      : null;
  const daySlots: ApiExamSlot[] = view?.items ?? [];
  const otherEquipmentSlotCount = selectedEquipment ? (view?.otherEquipmentCount ?? 0) : 0;
  const changeFilters = (patch: Partial<DaySlotFilters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const goToPage = (page: number) => setPageState({ key: pageKey, page });

  const listState: DayListState =
    totalEquipmentCount === 0
      ? { kind: "NO_EQUIPMENT" }
      : visibleEquipments.length === 0
        ? { kind: "NO_MATCH" }
        : !selectedDate
          ? { kind: "MESSAGE", message: "달력에서 날짜를 선택하면 그날 슬롯을 보여 줍니다." }
          : !dayState || dayState.status === "loading"
            ? { kind: "LOADING" }
            : dayState.status === "error"
              ? { kind: "MESSAGE", message: `슬롯을 불러오지 못했습니다. ${dayState.message}` }
              : { kind: "READY" };

  const byId = new Map(daySlots.map((slot) => [slot.id, slot]));
  const statusOf = (slot: ExamSlot) => {
    const api = byId.get(slot.id);
    return api ? getApiSlotStatusView(api, nowDateTime) : { label: "확인 불가", className: "bg-gray-100 text-gray-600", isPast: false };
  };
  const endTimeOf = (slot: ExamSlot) => byId.get(slot.id)?.endAt.slice(11, 16) ?? "";

  return (
    // 달력 40% : 선택 날짜 슬롯 60% (좁은 화면은 세로 배치)
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        {monthState?.status === "error" && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {monthStart.slice(0, 7)} 슬롯을 불러오지 못했습니다. {monthState.message}
            </p>
            <button type="button" onClick={() => store.retry(monthStart)} className={`${secondaryButtonClass} h-9`}>
              <RefreshCw className="size-4" aria-hidden="true" />
              다시 시도
            </button>
          </div>
        )}
        <SlotMonthCalendar
          monthStart={monthStart}
          today={today}
          range={range}
          selectedDate={selectedDate}
          statuses={statuses}
          notice={monthState?.status === "loading" ? "슬롯을 불러오고 있습니다." : null}
          onSelectDate={setSelectedDate}
          onChangeMonth={setMonthStart}
          scopeLabel={scopeLabel}
        />
      </div>
      <DaySlotList
        date={selectedDate}
        state={listState}
        slots={daySlots}
        scopeLabel={scopeLabel}
        singleEquipmentName={selectedEquipment?.name ?? null}
        otherEquipmentSlotCount={otherEquipmentSlotCount}
        slotMinutes={new Map()}
        nowDateTime={nowDateTime}
        onSelectSlot={setDetailSlot}
        statusOf={statusOf}
        endTimeOf={endTimeOf}
        toolbar={selectedDate && listState.kind !== "NO_EQUIPMENT" && listState.kind !== "NO_MATCH" ? <DaySlotFilterBar filters={filters} onChange={changeFilters} /> : null}
        countSummary={
          view && view.total > 0 ? (
            <>
              {" "}
              · 전체 {view.total}건{isDaySlotFiltered(filters) && <> · 필터 결과 {view.filtered}건</>}
              {view.filtered > 0 && (
                <>
                  {" "}
                  · {view.page} / {view.totalPages}페이지
                </>
              )}
            </>
          ) : null
        }
        emptyMessage={
          view && view.total > 0 ? "현재 조건에 맞는 슬롯이 없습니다. 필터를 바꾸거나 초기화해 주세요." : undefined
        }
        footer={
          view && (view.allUnavailable || view.totalPages > 1) ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {view.allUnavailable ? (
                <p role="status" className="text-sm text-gray-500">
                  이 날짜의 슬롯 {view.total}건은 모두 예약할 수 없는 상태입니다.
                </p>
              ) : (
                <span />
              )}
              {view.totalPages > 1 && <Pager page={view.page} totalPages={view.totalPages} onChange={goToPage} />}
            </div>
          ) : null
        }
      />
      {detailSlot && <ApiSlotDetailDialog slotId={detailSlot.id} nowDateTime={nowDateTime} onClose={() => setDetailSlot(null)} />}
    </div>
  );
}

const MODALITY_OPTIONS: { value: DaySlotFilters["modality"]; label: string }[] = [
  { value: "", label: "전체" },
  { value: "CT", label: "CT" },
  { value: "MRI", label: "MRI" },
];
const STATUS_OPTIONS: { value: DaySlotFilters["status"]; label: string }[] = [
  { value: "", label: "전체" },
  ...(["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE"] as const).map((value) => ({ value, label: API_SLOT_STATUS_META[value].label })),
];
const TIME_OPTIONS: { value: DaySlotFilters["timeOfDay"]; label: string }[] = [
  { value: "", label: "전체" },
  { value: "AM", label: "오전" },
  { value: "PM", label: "오후" },
];

/** 선택 날짜 슬롯 필터 (장비 종류·상태·시간대 + 초기화). 각 묶음은 라디오 그룹이라 화살표 키로 고를 수 있다 */
function DaySlotFilterBar({ filters, onChange }: { filters: DaySlotFilters; onChange: (patch: Partial<DaySlotFilters>) => void }) {
  return (
    <div role="group" aria-label="슬롯 목록 필터" className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2">
      <Segmented name="day-slot-modality" legend="장비 종류" options={MODALITY_OPTIONS} value={filters.modality} onChange={(modality) => onChange({ modality })} />
      <Segmented name="day-slot-status" legend="상태" options={STATUS_OPTIONS} value={filters.status} onChange={(status) => onChange({ status })} />
      <Segmented name="day-slot-time" legend="시간대" options={TIME_OPTIONS} value={filters.timeOfDay} onChange={(timeOfDay) => onChange({ timeOfDay })} />
      <button
        type="button"
        onClick={() => onChange(EMPTY_DAY_SLOT_FILTERS)}
        disabled={!isDaySlotFiltered(filters)}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        필터 초기화
      </button>
    </div>
  );
}

function Segmented<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium text-gray-500">{legend}</legend>
      <div className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-gray-50 p-0.5">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value || "ALL"}
              className={`flex h-7 cursor-pointer items-center rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                checked ? "bg-white font-semibold text-primary shadow-sm ring-1 ring-primary/40" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <input type="radio" name={name} value={option.value} checked={checked} onChange={() => onChange(option.value)} className="sr-only" />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 이전·다음 + 현재/전체 페이지 */
function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  const buttonClass =
    "inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white";
  return (
    <nav aria-label="슬롯 목록 페이지" className="ml-auto flex items-center gap-2">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} className={buttonClass}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        이전
      </button>
      <span className="text-sm tabular-nums text-gray-600" aria-live="polite">
        {page} / {totalPages}
      </span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} className={buttonClass}>
        다음
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

/** 슬롯 상세 (조회만): 서버에서 슬롯을 다시 불러와 보여 준다 */
function ApiSlotDetailDialog({ slotId, nowDateTime, onClose }: { slotId: string; nowDateTime: string; onClose: () => void }) {
  const { value, retry } = useDetailResult<ManagementSlotDetailResult>(slotId, () => loadSlotDetailAction(slotId), {
    ok: false,
    reason: "NETWORK",
    message: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.",
  });
  const slot = value?.ok ? value.slot : null;
  const view = slot ? getApiSlotStatusView(slot, nowDateTime) : null;
  return (
    <Modal open title="슬롯 상세" description="서버에 저장된 슬롯 정보입니다." onClose={onClose}>
      {value === null ? (
        <p role="status" className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          슬롯 정보를 불러오고 있습니다.
        </p>
      ) : !value.ok ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {value.message}
          {value.reason !== "FORBIDDEN" && value.reason !== "INVALID" && (
            <button type="button" onClick={retry} className={secondaryButtonClass}>
              다시 시도
            </button>
          )}
        </div>
      ) : (
        slot &&
        view && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[15px]">
              <dt className="text-gray-500">검사 일시</dt>
              <dd className="font-semibold text-gray-900">
                {formatDateTimeWithWeekday(slot.startAt)} ~ {slot.endAt.slice(11, 16)}
              </dd>
              <dt className="text-gray-500">상태</dt>
              <dd>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${view.className}`}>{view.label}</span>
                {view.isPast && <span className="ml-2 text-sm text-gray-500">지난 시간</span>}
              </dd>
              <dt className="text-gray-500">장비</dt>
              <dd className="break-words text-gray-900">
                {slot.equipmentName} · {slot.examType}
              </dd>
              <dt className="text-gray-500">검사 유형</dt>
              <dd className="break-words text-gray-900">{slot.examTypeName}</dd>
              <dt className="text-gray-500">슬롯 ID</dt>
              <dd>
                <code className="break-all text-xs text-gray-600">{slot.id}</code>
              </dd>
            </dl>
            <p className="text-xs text-gray-500">운영 중단·재개 등 상태 변경은 서버 기능 확인 후 연결합니다.</p>
          </div>
        )
      )}
    </Modal>
  );
}
