"use client";

import { AlertTriangle, CheckCircle2, RotateCcw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { removeMockIncidentsForEquipments } from "@/features/incidents/mockIncidentStore";
import { useFailedEquipmentIds } from "@/features/incidents/useMockIncidents";
import type { ExamSlot } from "@/features/slots/types";
import { addDays, addMonths, parseDateKey, type DateKey } from "@/lib/date/seoulDate";
import { useSeoulNow } from "@/lib/date/useSeoulNow";

import { getOrganizationSlots, getSlotDataRange } from "../api";
import {
  buildMonthDayStatuses,
  findFirstAvailableDate,
  isSelectableDay,
  type DayStatus,
  type DayStatusContext,
} from "../dayStatus";
import {
  countEquipmentChanges,
  getCreatedEquipmentIds,
  getEquipmentEditLocksFrom,
  resetMockEquipmentChanges,
} from "../mockEquipmentStore";
import type { Equipment } from "../types";
import { useEquipmentChanges, useLiveEquipments, useSlotDataKey } from "../useLiveEquipments";

import DaySlotList from "./DaySlotList";
import EquipmentForm from "./EquipmentForm";
import EquipmentPicker, { toMockPickerRow, type EquipmentSelection, type ExamTypeFilter } from "./EquipmentPicker";
import EquipmentScheduleDetail from "./EquipmentScheduleDetail";
import OperatingHoursForm from "./OperatingHoursForm";
import SlotDetail from "./SlotDetail";
import SlotGenerationForm from "./SlotGenerationForm";
import SlotMonthCalendar from "./SlotMonthCalendar";

/** 장비 관련 모달: 등록 / 장비 상세(운영 스케줄) / 장비 정보 수정 / 운영 시간 수정 */
type EquipmentModal =
  | { type: "register" }
  /** fromList: 장비 목록의 운영시간 버튼에서 바로 연 경우 (닫으면 상세로 돌아가지 않는다) */
  | { type: "detail" | "editInfo" | "editHours"; equipmentId: string; fromList?: boolean }
  | null;

interface EquipmentSlotWorkspaceProps {
  organizationId: string;
}

/** 아직 불러온 달이 없음 (렌더링마다 새 객체가 생기지 않도록 공유) */
const NO_MONTHS: Record<DateKey, ExamSlot[]> = {};

/** 대소문자·공백 차이를 무시한 검색용 문자열 */
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, "");

const monthOf = (key: DateKey) => `${key.slice(0, 7)}-01`;

const filterEquipments = (equipments: Equipment[], query: string, typeFilter: ExamTypeFilter) => {
  const keyword = normalize(query);
  return equipments.filter(
    (equipment) =>
      (typeFilter === "ALL" || equipment.examType === typeFilter) &&
      (!keyword || normalize(equipment.name).includes(keyword)),
  );
};

/** 같은 시각이면 장비명(숫자 자연 정렬) → 장비 ID 순 */
const compareSlots = (a: ExamSlot, b: ExamSlot) =>
  a.startAt.localeCompare(b.startAt) ||
  a.equipmentName.localeCompare(b.equipmentName, "ko", { numeric: true }) ||
  a.equipmentId.localeCompare(b.equipmentId);

/**
 * 장비 선택 → 날짜 확인 → 그날 슬롯 조회 흐름의 클라이언트 경계.
 *
 * - 조회 대상(scope): 선택 장비가 현재 목록(검색·필터 결과)에 있으면 그 장비, 아니면 목록 전체.
 *   선택 상태와 달력 조회 조건이 항상 같은 값에서 계산된다.
 * - 슬롯은 월 단위로 불러와 캐시한다. 장비·날짜·필터 변경은 캐시된 데이터를 거르기만 한다.
 * - 날짜는 예약 가능하거나(파랑) 슬롯이 있는(조회 전용) 날만 고를 수 있다. 조회 대상이 바뀌어
 *   선택 날짜를 더 고를 수 없게 되면 선택을 해제하고 목록에 이유를 안내한다.
 * - 처음에는 오늘 이후 가장 가까운 예약 가능 날짜를 고르고, 그 날짜가 있는 달을 함께 표시한다.
 */
export default function EquipmentSlotWorkspace({ organizationId }: EquipmentSlotWorkspaceProps) {
  const now = useSeoulNow();
  // 장비 목록·운영 시간·상태는 원본 Mock + 화면 변경분(장비 등록·수정, 장애 등록·복구)을 반영한 현재 값
  const equipments = useLiveEquipments(organizationId);
  // 장애 장비·슬롯 데이터가 바뀌면 캐시 키가 바뀌어 슬롯을 다시 불러온다 (선택한 장비·날짜는 유지)
  const slotDataKey = useSlotDataKey();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ExamTypeFilter>("ALL");
  const [selection, setSelection] = useState<EquipmentSelection>("ALL");
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  /** null = 이번 달 (현재 시각을 알기 전에는 정할 수 없다) */
  const [viewMonth, setViewMonth] = useState<DateKey | null>(null);
  /** 사용자가(또는 첫 진입 시 자동으로) 고른 날짜. 지금 조건에서 고를 수 없으면 화면에서는 선택 해제로 본다 */
  const [pickedDate, setPickedDate] = useState<DateKey | null>(null);
  const [monthNotice, setMonthNotice] = useState<string | null>(null);
  const [slotCacheState, setSlotCacheState] = useState<{ key: string; months: Record<DateKey, ExamSlot[]> }>({
    key: slotDataKey,
    months: NO_MONTHS,
  });
  const slotCache = slotCacheState.key === slotDataKey ? slotCacheState.months : NO_MONTHS;
  /** 캐시 키 + 달 → 요청 */
  const monthRequestsRef = useRef(new Map<string, Promise<ExamSlot[]>>());
  /** 가장 최근 캐시 키 (이전 키로 보낸 요청의 늦은 응답은 버린다) */
  const latestSlotDataKeyRef = useRef(slotDataKey);
  useEffect(() => {
    latestSlotDataKeyRef.current = slotDataKey;
    // 키가 이전 값으로 돌아오는 경우(장애 등록 → 복구)에도 다시 요청하도록 이전 요청을 비운다.
    // 남겨 두면 이미 끝난 요청을 그대로 돌려줘 캐시가 채워지지 않고 '불러오는 중'에 머문다
    monthRequestsRef.current.clear();
  }, [slotDataKey]);
  const didInitDateRef = useRef(false);
  const [detailSlot, setDetailSlot] = useState<ExamSlot | null>(null);
  const [equipmentModal, setEquipmentModal] = useState<EquipmentModal>(null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  /** 슬롯 생성 모달에서 처음 선택할 장비 (등록 완료 안내의 [슬롯 생성하기]) */
  const [generateEquipmentId, setGenerateEquipmentId] = useState<string | null>(null);
  /** 등록·수정·생성 등 처리 결과 안내. slotEquipmentId가 있으면 [슬롯 생성하기]를 함께 보인다 */
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "warning";
    slotEquipmentId?: string;
  } | null>(null);
  const changes = useEquipmentChanges();
  const { ids: failedEquipmentIds } = useFailedEquipmentIds();
  const changeCount = countEquipmentChanges(changes);
  const modalEquipment =
    equipmentModal && equipmentModal.type !== "register"
      ? (equipments.find(({ id }) => id === equipmentModal.equipmentId) ?? null)
      : null;

  const visibleEquipments = useMemo(
    () => filterEquipments(equipments, query, typeFilter),
    [equipments, query, typeFilter],
  );
  const selectedEquipment =
    selection === "ALL" ? null : (visibleEquipments.find(({ id }) => id === selection) ?? null);
  const scopeEquipments = useMemo(
    () => (selectedEquipment ? [selectedEquipment] : visibleEquipments),
    [selectedEquipment, visibleEquipments],
  );
  const scopeIds = useMemo(() => new Set(scopeEquipments.map(({ id }) => id)), [scopeEquipments]);
  const slotMinutes = useMemo(
    () => new Map(equipments.map(({ id, slotMinutes }) => [id, slotMinutes])),
    [equipments],
  );

  const nowDateTime = now?.dateTime ?? null;
  const today = now?.dateKey ?? null;
  const range = useMemo(() => (today ? getSlotDataRange(today) : null), [today]);
  const monthStart = viewMonth ?? (today ? monthOf(today) : null);

  /** 한 달 슬롯을 불러와 캐시한다. 같은 캐시 키·같은 달은 한 번만 요청한다 */
  const loadMonth = useCallback(
    (month: DateKey): Promise<ExamSlot[]> => {
      const requestKey = `${slotDataKey}:${month}`;
      const cached = monthRequestsRef.current.get(requestKey);
      if (cached) return cached;
      if (!range) return Promise.resolve([]);
      const from = month < range.start ? range.start : month;
      const monthEnd = addDays(addMonths(month, 1), -1);
      const to = monthEnd > range.end ? range.end : monthEnd;
      const request = from > to ? Promise.resolve([]) : getOrganizationSlots(organizationId, from, to);
      monthRequestsRef.current.set(requestKey, request);
      request.then((slots) => {
        if (latestSlotDataKeyRef.current !== slotDataKey) return;
        setSlotCacheState((prev) =>
          prev.key === slotDataKey
            ? { key: slotDataKey, months: { ...prev.months, [month]: slots } }
            : { key: slotDataKey, months: { [month]: slots } },
        );
      });
      return request;
    },
    [organizationId, range, slotDataKey],
  );

  const statusContext = useMemo<DayStatusContext | null>(
    () => (range && nowDateTime ? { range, scopeEquipments, nowDateTime } : null),
    [range, scopeEquipments, nowDateTime],
  );

  // 필요한 달(표시 중인 달, 선택 날짜의 달)만 불러온다
  useEffect(() => {
    if (!monthStart || equipments.length === 0) return;
    void loadMonth(monthStart);
    if (pickedDate) void loadMonth(monthOf(pickedDate));
  }, [loadMonth, monthStart, pickedDate, equipments.length]);

  // 첫 진입: 오늘 이후 가장 가까운 예약 가능 날짜를 고르고, 그 달을 표시한다 (한 번만)
  useEffect(() => {
    if (didInitDateRef.current || !today || !range || !statusContext || equipments.length === 0) return;
    didInitDateRef.current = true;
    const initialContext = statusContext;
    void (async () => {
      for (let month = monthOf(today); month <= range.end; month = addMonths(month, 1)) {
        const date = findFirstAvailableDate(month, await loadMonth(month), today, initialContext);
        if (date) {
          setPickedDate(date);
          if (month !== monthOf(today)) {
            setViewMonth(month);
            setMonthNotice(`이번 달에는 예약 가능한 날짜가 없어 ${parseDateKey(month).month}월을 표시합니다.`);
          }
          return;
        }
      }
      setMonthNotice("조회 기간 안에 예약 가능한 날짜가 없습니다.");
    })();
  }, [today, range, statusContext, equipments.length, loadMonth]);

  /** 검색·필터가 바뀌어 선택 장비가 목록에서 빠지면 전체 보기로 바꾸고 알린다 */
  const applyFilter = (nextQuery: string, nextType: ExamTypeFilter) => {
    setQuery(nextQuery);
    setTypeFilter(nextType);
    if (selection === "ALL") return setSelectionNotice(null);
    const stillVisible = filterEquipments(equipments, nextQuery, nextType).some(({ id }) => id === selection);
    if (stillVisible) return setSelectionNotice(null);
    const name = equipments.find(({ id }) => id === selection)?.name ?? "선택한 장비";
    setSelection("ALL");
    setSelectionNotice(`${name}이(가) 검색 결과에서 빠져 전체 보기로 바꿨습니다.`);
  };

  const monthStatuses = useMemo(
    () =>
      monthStart && statusContext
        ? buildMonthDayStatuses(monthStart, slotCache[monthStart], statusContext)
        : new Map<DateKey, DayStatus>(),
    [monthStart, slotCache, statusContext],
  );

  /** 고른 날짜의 현재 조건 기준 상태 (다른 달일 수 있어 따로 계산) */
  const pickedStatus = useMemo<DayStatus | null>(() => {
    if (!pickedDate || !statusContext) return null;
    return (
      buildMonthDayStatuses(monthOf(pickedDate), slotCache[monthOf(pickedDate)], statusContext).get(pickedDate) ??
      null
    );
  }, [pickedDate, slotCache, statusContext]);
  // 불러오는 중에는 선택을 유지하고, 고를 수 없는 상태로 확인되면 선택 해제로 본다
  const selectedDate =
    pickedDate && pickedStatus && (pickedStatus.kind === "LOADING" || isSelectableDay(pickedStatus))
      ? pickedDate
      : null;

  const daySlots = useMemo(() => {
    if (!selectedDate) return { scoped: [], others: 0, loaded: false };
    const monthSlots = slotCache[monthOf(selectedDate)];
    if (!monthSlots) return { scoped: [], others: 0, loaded: false };
    const sameDay = monthSlots.filter((slot) => slot.startAt.startsWith(selectedDate));
    const scoped = sameDay.filter((slot) => scopeIds.has(slot.equipmentId)).sort(compareSlots);
    const visibleIds = new Set(visibleEquipments.map(({ id }) => id));
    const others = sameDay.filter((slot) => visibleIds.has(slot.equipmentId) && !scopeIds.has(slot.equipmentId)).length;
    return { scoped, others, loaded: true };
  }, [slotCache, selectedDate, scopeIds, visibleEquipments]);

  const selectableInMonth = [...monthStatuses.values()].some(isSelectableDay);
  const noDateMessage =
    pickedDate && !selectedDate && pickedStatus
      ? `${parseDateKey(pickedDate).month}/${parseDateKey(pickedDate).day}은(는) 현재 조건에서 ${
          pickedStatus.kind === "CLOSED" ? "휴무일" : "조회할 슬롯이 없는 날짜"
        }입니다. 달력에서 다른 날짜를 선택해 주세요.`
      : selectableInMonth
        ? "달력에서 파란색(예약 가능) 또는 테두리(예약 불가) 날짜를 선택해 주세요."
        : "이 달에는 조회할 슬롯이 있는 날짜가 없습니다. 다른 달을 확인해 주세요.";

  const scopeLabel = selectedEquipment
    ? `${selectedEquipment.name} · ${selectedEquipment.examType}`
    : `${query.trim() || typeFilter !== "ALL" ? "검색 결과 전체" : "전체 장비"} ${visibleEquipments.length}대`;

  /** 상세 모달의 슬롯은 다시 불러온 최신 데이터에서 찾는다 (운영 중단·재개 후 상태 반영) */
  const liveDetailSlot = detailSlot
    ? (slotCache[monthOf(detailSlot.startAt.slice(0, 10))]?.find(({ id }) => id === detailSlot.id) ?? detailSlot)
    : null;

  const closeEquipmentModal = () => setEquipmentModal(null);
  const showNotice = (message: string) => setNotice({ message, tone: "success" });

  const openSlotGeneration = (equipmentId: string | null) => {
    setGenerateEquipmentId(equipmentId);
    setIsGenerateOpen(true);
  };

  /** 장비와 운영 시간이 모두 저장된 뒤에만 완료 안내를 보인다 (슬롯은 자동 생성하지 않는다) */
  const handleRegistered = (equipment: { id: string; name: string }) => {
    closeEquipmentModal();
    setQuery("");
    setTypeFilter("ALL");
    setSelection(equipment.id);
    setSelectionNotice(null);
    setNotice({
      message: `${equipment.name} 장비와 운영시간을 등록했습니다. 예약을 받으려면 검사 슬롯을 생성해 주세요.`,
      tone: "success",
      slotEquipmentId: equipment.id,
    });
  };

  /** 장비만 저장되고 운영 시간은 저장되지 않은 경우 (등록 모달은 열린 채 다시 시도할 수 있다) */
  const handlePartiallyRegistered = (equipment: { id: string; name: string }) => {
    setNotice({
      message: `${equipment.name} 장비는 등록되었지만 운영 시간은 저장되지 않았습니다. 운영 시간을 설정해야 슬롯을 만들 수 있습니다.`,
      tone: "warning",
    });
  };

  /** 슬롯을 생성한 장비·날짜로 이동해 결과를 바로 보여 준다 */
  const handleGenerated = (message: string, equipmentId: string, firstDate: DateKey) => {
    setIsGenerateOpen(false);
    showNotice(message);
    setQuery("");
    setTypeFilter("ALL");
    setSelection(equipmentId);
    setSelectionNotice(null);
    setPickedDate(firstDate);
    setViewMonth(monthOf(firstDate));
    setMonthNotice(null);
  };

  const handleResetChanges = () => {
    if (!window.confirm("이 브라우저에 저장된 장비 등록·수정, 운영 시간, 생성한 슬롯을 지우고 원본 예시 데이터로 되돌릴까요?")) {
      return;
    }
    // 등록 장비가 사라지므로 그 장비에 등록한 장애 기록도 함께 정리한다 (원본 장애 이력은 그대로)
    removeMockIncidentsForEquipments(getCreatedEquipmentIds());
    resetMockEquipmentChanges();
    setSelection("ALL");
    setNotice({ message: "장비·슬롯 변경 내역을 초기화했습니다.", tone: "success" });
  };

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-[15px] ${
            notice.tone === "warning"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex min-w-0 flex-1 basis-[280px] items-start gap-2">
              {notice.tone === "warning" ? (
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {notice.message}
                <span className="ml-1 text-sm opacity-80">(개발용 예시: 이 브라우저에만 저장됩니다.)</span>
              </span>
            </p>
            {notice.slotEquipmentId && (
              <button
                type="button"
                onClick={() => openSlotGeneration(notice.slotEquipmentId ?? null)}
                aria-haspopup="dialog"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-primary-hover"
              >
                <Sparkles className="size-4" aria-hidden="true" />
                슬롯 생성하기
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="안내 닫기"
            className="shrink-0 rounded p-1 hover:bg-black/5"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {/* 상단: 장비 목록(전체 너비) / 하단: 달력 + 선택 날짜의 슬롯 */}
      <div className="flex min-w-0 flex-col gap-5">
      <EquipmentPicker
        totalCount={equipments.length}
        visibleEquipments={visibleEquipments.map(toMockPickerRow)}
        query={query}
        onQueryChange={(value) => applyFilter(value, typeFilter)}
        typeFilter={typeFilter}
        onTypeFilterChange={(value) => applyFilter(query, value)}
        selection={selectedEquipment ? selectedEquipment.id : "ALL"}
        onSelect={(value) => {
          setSelection(value);
          setSelectionNotice(null);
        }}
        selectionNotice={selectionNotice}
        onShowSchedule={(equipment) => setEquipmentModal({ type: "detail", equipmentId: equipment.id })}
        onEditHours={(equipment) => setEquipmentModal({ type: "editHours", equipmentId: equipment.id, fromList: true })}
        onRegister={() => setEquipmentModal({ type: "register" })}
        onGenerateSlots={() => openSlotGeneration(null)}
      />

      {/* 현재 시각을 알기 전(서버 렌더링·hydration 전)에는 장비 패널만 먼저 보여 준다 */}
      {!now || !today || !range || !monthStart ? (
        <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
          슬롯 현황을 불러오고 있습니다.
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-5 min-[900px]:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] min-[1400px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <SlotMonthCalendar
            monthStart={monthStart}
            today={today}
            range={range}
            selectedDate={selectedDate}
            statuses={monthStatuses}
            notice={monthNotice}
            onSelectDate={setPickedDate}
            onChangeMonth={(month) => {
              setViewMonth(month);
              setMonthNotice(null);
            }}
            scopeLabel={scopeLabel}
          />
          <DaySlotList
            date={selectedDate}
            state={
              equipments.length === 0
                ? { kind: "NO_EQUIPMENT" }
                : visibleEquipments.length === 0
                  ? { kind: "NO_MATCH" }
                  : !selectedDate
                    ? { kind: "MESSAGE", message: noDateMessage }
                    : !daySlots.loaded
                      ? { kind: "LOADING" }
                      : { kind: "READY" }
            }
            slots={daySlots.scoped}
            scopeLabel={scopeLabel}
            singleEquipmentName={selectedEquipment?.name ?? null}
            otherEquipmentSlotCount={daySlots.others}
            slotMinutes={slotMinutes}
            nowDateTime={nowDateTime ?? ""}
            onSelectSlot={setDetailSlot}
          />
        </div>
      )}

      <Modal open={liveDetailSlot !== null} title="슬롯 정보" onClose={() => setDetailSlot(null)}>
        {liveDetailSlot && nowDateTime && (
          <SlotDetail
            organizationId={organizationId}
            slot={liveDetailSlot}
            slotMinutes={slotMinutes.get(liveDetailSlot.equipmentId) ?? 30}
            nowDateTime={nowDateTime}
            changes={changes}
            onClose={() => setDetailSlot(null)}
            onChanged={(message) => {
              setDetailSlot(null);
              showNotice(message);
            }}
          />
        )}
      </Modal>

      <Modal
        open={equipmentModal !== null && (equipmentModal.type === "register" || modalEquipment !== null)}
        size={equipmentModal?.type === "editHours" || equipmentModal?.type === "register" ? "lg" : "md"}
        title={
          equipmentModal?.type === "register"
            ? "장비 등록"
            : !modalEquipment
              ? ""
              : equipmentModal?.type === "editInfo"
                ? `${modalEquipment.name} 정보 수정`
                : equipmentModal?.type === "editHours"
                  ? `${modalEquipment.name} 운영 시간 ${modalEquipment.operatingHours.length > 0 ? "수정" : "설정"}`
                  : `${modalEquipment.name} 운영 스케줄`
        }
        description={
          equipmentModal?.type === "register"
            ? "기본 정보와 운영 시간을 입력하면 장비를 등록합니다."
            : modalEquipment
              ? `${modalEquipment.examType} · 슬롯 ${modalEquipment.slotMinutes}분 단위`
              : undefined
        }
        closeOnBackdrop={equipmentModal?.type === "detail"}
        onClose={closeEquipmentModal}
      >
        {equipmentModal?.type === "register" && (
          <EquipmentForm
            organizationId={organizationId}
            otherNames={equipments.map(({ name }) => name)}
            onCancel={closeEquipmentModal}
            onRegistered={handleRegistered}
            onPartiallyRegistered={handlePartiallyRegistered}
          />
        )}
        {equipmentModal?.type === "detail" && modalEquipment && (
          <EquipmentScheduleDetail
            equipment={modalEquipment}
            onClose={closeEquipmentModal}
            onEditInfo={() => setEquipmentModal({ type: "editInfo", equipmentId: modalEquipment.id })}
            onEditHours={() => setEquipmentModal({ type: "editHours", equipmentId: modalEquipment.id })}
          />
        )}
        {equipmentModal?.type === "editInfo" && modalEquipment && (
          <EquipmentForm
            organizationId={organizationId}
            equipment={modalEquipment}
            locks={getEquipmentEditLocksFrom(changes, modalEquipment)}
            otherNames={equipments.filter(({ id }) => id !== modalEquipment.id).map(({ name }) => name)}
            onCancel={() => setEquipmentModal({ type: "detail", equipmentId: modalEquipment.id })}
            onSaved={(message) => {
              setEquipmentModal({ type: "detail", equipmentId: modalEquipment.id });
              showNotice(message);
            }}
          />
        )}
        {equipmentModal?.type === "editHours" && modalEquipment && (
          <OperatingHoursForm
            organizationId={organizationId}
            equipmentId={modalEquipment.id}
            equipmentName={modalEquipment.name}
            operatingHours={modalEquipment.operatingHours}
            onCancel={() =>
              equipmentModal.fromList ? closeEquipmentModal() : setEquipmentModal({ type: "detail", equipmentId: modalEquipment.id })
            }
            onSaved={(message) => {
              if (equipmentModal.fromList) closeEquipmentModal();
              else setEquipmentModal({ type: "detail", equipmentId: modalEquipment.id });
              showNotice(message);
            }}
          />
        )}
      </Modal>

      <Modal
        open={isGenerateOpen}
        size="lg"
        title="슬롯 생성"
        description="장비 운영 시간과 슬롯 소요 시간으로 검사 가능 슬롯을 만듭니다."
        closeOnBackdrop={false}
        onClose={() => setIsGenerateOpen(false)}
      >
        {isGenerateOpen && (
          <SlotGenerationForm
            organizationId={organizationId}
            equipments={equipments}
            initialEquipmentId={generateEquipmentId ?? selectedEquipment?.id ?? null}
            changes={changes}
            failedEquipmentIds={failedEquipmentIds}
            onCancel={() => setIsGenerateOpen(false)}
            onGenerated={handleGenerated}
          />
        )}
      </Modal>
      </div>

      {changeCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleResetChanges}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            개발용: 이 브라우저의 장비·슬롯 변경 내역 {changeCount}건 초기화
          </button>
        </div>
      )}
    </div>
  );
}
