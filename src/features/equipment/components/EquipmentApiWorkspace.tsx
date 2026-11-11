"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { controlClass, fieldLabelClass, SelectInput, TextInput } from "@/components/ui/FormControls";
import Modal from "@/components/ui/Modal";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { NETWORK_FAILURE, useDetailResult } from "@/features/admin/components/AdminDetailParts";
import { useRenderedLoginSession } from "@/features/auth/loginSessionContext";
import type { ExamTypeDto } from "@/features/referrals/remote";
import { addDays, getDaysInMonth, parseDateKey, toDateKey, type DateKey } from "@/lib/date/seoulDate";
import { useSeoulNow } from "@/lib/date/useSeoulNow";
import { isApiFeature } from "@/lib/api/config";
import { loadMonthSlotsAction } from "@/features/slots/managementActions";
import { countTodayAvailableSlots, createMonthSlotStore } from "@/features/slots/managementMonth";

import ApiSlotSchedule from "./ApiSlotSchedule";

import {
  createEquipmentWithExamTypesAction,
  loadEquipmentOperatingHoursAction,
  loadExamTypeOptionsAction,
  loadSupportedExamTypesAction,
  saveEquipmentOperatingHoursAction,
  type EquipmentActionResult,
} from "../actions";
import type { DayStatus } from "../dayStatus";
import { formatOperatingHoursSummary } from "../operatingHours";
import { EQUIPMENT_MODALITIES, EQUIPMENT_NAME_MAX_LENGTH, validateEquipmentName, type EquipmentDto, type EquipmentModalityDto, type EquipmentStatusDto } from "../remote";
import { hasOpenDay, type OperatingDayInput } from "../rules";
import type { EquipmentOperatingHoursResult, ExamTypeOptionsResult, SupportedExamTypesResult } from "../server";
import { markEquipmentSessionChanged, useEquipmentSessionChanged } from "../sessionChangeLock";
import type { DailyOperatingHours } from "../types";

import DaySlotList from "./DaySlotList";
import { DurationInput, EquipmentDetailDialog, EquipmentFormDialog, readDuration } from "./EquipmentApiDialogs";
import EquipmentPicker, { type EquipmentPickerRow, type EquipmentSelection, type ExamTypeFilter } from "./EquipmentPicker";
import { EquipmentSummaryBar } from "./EquipmentSummary";
import { isOperatingDaysValid, OperatingHoursFields, toOperatingDayInputs } from "./OperatingHoursForm";
import SlotMonthCalendar from "./SlotMonthCalendar";
import ApiSlotGenerationDialog from "./ApiSlotGenerationDialog";

interface EquipmentApiWorkspaceProps {
  /** 우리 기관 장비 (서버가 users/me 기관으로 조회, 최대 100대) */
  equipments: EquipmentDto[];
  totalElements: number;
  /** 100대를 넘어 일부만 받았는지 (검색·탭은 받은 목록 안에서만 동작) */
  truncated: boolean;
  /** 기관 전체 종류별 장비 수. 알 수 없으면 null */
  counts: { CT: number; MRI: number } | null;
}

/** 지원 검사 유형을 목록에 미리 보여 줄 장비 수 (서버 SUPPORTED_LOOKUP_MAX와 같다: 행마다 요청이 생겨 제한한다) */
const SUPPORTED_PREVIEW_COUNT = 10;
/** 달력에서 이동할 수 있는 기간 (Mock 화면과 같은 오늘~+119일) */
const RANGE_DAYS = 120;

const SLOT_UNAVAILABLE = "슬롯 목록 조회 기능이 서버에 아직 없어 날짜별 슬롯 현황을 표시할 수 없습니다.";
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

/** 목록 위 안내 (등록·수정 결과) */
type WorkspaceNotice = { message: string; tone: "success" | "warning" };

const API_STATUS_META: Record<EquipmentStatusDto, { label: string; dotClass: string; textClass: string }> = {
  OPERATIONAL: { label: "정상", dotClass: "bg-emerald-500", textClass: "text-emerald-700" },
  MAINTENANCE: { label: "점검 중", dotClass: "bg-amber-500", textClass: "text-amber-700" },
  FAILED: { label: "장애", dotClass: "bg-red-500", textClass: "text-red-600" },
};

/** Mock 장비 상태 표시(EquipmentStatusBadge)와 같은 점 + 글자 모양 */
function ApiStatusDot({ status }: { status: EquipmentStatusDto }) {
  const { label, dotClass, textClass } = API_STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-2 text-[15px] font-medium ${textClass}`}>
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}

type Dialog =
  | { kind: "create" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "hours"; id: string }
  | { kind: "slots" }
  | null;

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, "");
const monthOf = (key: DateKey) => `${key.slice(0, 7)}-01`;

/**
 * 장비·슬롯 운영 (검사기관, API 모드). 배포 와이어프레임(Mock 화면 EquipmentSlotWorkspace)과 같은 구성:
 * 요약 바 → 장비 목록(검색·CT/MRI 탭·등록·슬롯 생성) → 월간 달력 + 선택 날짜의 슬롯.
 * - 장비 목록·등록·정보 수정·지원 검사 유형(장비별 소요 시간)·운영시간은 실제 API (Server Function, 저장 후 refresh·재조회로 서버 값에 맞춘다)
 * - 슬롯 목록·슬롯 일괄 생성·휴게 시간은 백엔드 API가 없다: 모양은 두고 '조회 준비 중'·비활성으로 안내한다 (Mock 값·0으로 채우지 않는다)
 */
export default function EquipmentApiWorkspace({ equipments, totalElements, truncated, counts }: EquipmentApiWorkspaceProps) {
  const now = useSeoulNow();
  const today = now?.dateKey ?? null;
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ExamTypeFilter>("ALL");
  const [selection, setSelection] = useState<EquipmentSelection>("ALL");
  const [viewMonth, setViewMonth] = useState<DateKey | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);

  // 월별 슬롯 조회 결과 관리
  const [slotStore] = useState(() =>
    createMonthSlotStore((monthStart) => loadMonthSlotsAction(monthStart)),
  );

  const monthStates = useSyncExternalStore(
    slotStore.subscribe,
    slotStore.getSnapshot,
    slotStore.getSnapshot,
  );

  // 오늘 예약 가능 슬롯 수: 오늘이 속한 달의 월 캐시를 함께 쓴다 (달력이 같은 달을 보면 추가 요청 없음).
  // 슬롯 생성 뒤 invalidate로 캐시가 비면 다시 요청하고, 현재 시각(분)이 바뀌면 다시 센다
  const slotsApi = isApiFeature("slots");
  const todayMonth = today ? monthOf(today) : null;
  useEffect(() => {
    if (slotsApi && todayMonth) slotStore.request(todayMonth);
  }, [slotsApi, slotStore, todayMonth, monthStates]);
  const institutionIds = useMemo(() => new Set(equipments.map((item) => item.institutionId.toLowerCase())), [equipments]);
  const todayAvailable =
    slotsApi && today && now && todayMonth
      ? countTodayAvailableSlots(monthStates[todayMonth], { today, nowDateTime: now.dateTime, institutionIds })
      : null;

  const visible = useMemo(() => {
    const keyword = normalize(query);
    return equipments.filter((item) => (typeFilter === "ALL" || item.modality === typeFilter) && (!keyword || normalize(item.name).includes(keyword)));
  }, [equipments, query, typeFilter]);
  const selected = selection === "ALL" ? null : (visible.find((item) => item.id === selection) ?? null);
  const isFiltered = query.trim() !== "" || typeFilter !== "ALL";
  const scopeLabel = selected ? `${selected.name} · ${selected.modality}` : `${isFiltered ? "검색 결과 전체" : "전체 장비"} ${visible.length}대`;

  // 지원 검사 유형·운영시간: 목록 앞쪽 장비만 미리 조회한다 (장비당 2회, 최대 10대). 나머지는 상세·운영시간 수정에서 확인
  const previewIds = useMemo(() => equipments.slice(0, SUPPORTED_PREVIEW_COUNT).map((item) => item.id), [equipments]);
  const previewKey = previewIds.length > 0 ? previewIds.join(",") : null;
  const { value: supported, retry: reloadPreview } = useDetailResult<SupportedExamTypesResult>(
    previewKey,
    () => loadSupportedExamTypesAction(previewIds),
    NETWORK_FAILURE,
  );
  const previewOf = (id: string) => (supported?.ok ? (supported.byEquipment[id.toLowerCase()] ?? null) : null);

  const supportedOf = (id: string): EquipmentPickerRow["supported"] => {
    if (!previewIds.includes(id)) return { placeholder: "상세에서 확인" };
    if (supported === null) return { placeholder: "불러오는 중" };
    const names = previewOf(id)?.names;
    return names ? names : { placeholder: "확인 불가" };
  };

  const hoursOf = (id: string): EquipmentPickerRow["hours"] => {
    if (!previewIds.includes(id)) return { kind: "unavailable", label: "[운영시간 수정]에서 확인" };
    if (supported === null) return { kind: "unavailable", label: "불러오는 중" };
    const hours = previewOf(id)?.hours;
    if (!hours) return { kind: "unavailable", label: "확인 불가" };
    return hours.length > 0 ? { kind: "set", summary: formatOperatingHoursSummary(hours) } : { kind: "unset" };
  };

  const rows: EquipmentPickerRow[] = visible.map((item) => ({
    id: item.id,
    name: item.name,
    examType: item.modality,
    statusBadge: <ApiStatusDot status={item.status} />,
    hours: hoursOf(item.id),
    supported: supportedOf(item.id),
  }));

  const byId = (id: string) => equipments.find((item) => item.id === id) ?? null;
  const dialogEquipment = dialog && "id" in dialog ? byId(dialog.id) : null;
  const finish = (next: WorkspaceNotice) => {
    setDialog(null);
    setNotice(next);
    reloadPreview();
  };
  const finishAction = (result: EquipmentActionResult) => finish({ message: result.message, tone: result.ok ? "success" : "warning" });

  // 달력: 슬롯을 조회할 수 없으므로 지난 날짜·범위 밖만 구분하고 나머지는 '조회 불가'로 둔다 (휴무·슬롯 없음으로 단정하지 않는다)
  const range = today ? { start: today, end: addDays(today, RANGE_DAYS - 1) } : null;
  const monthStart = viewMonth ?? (today ? monthOf(today) : null);
  const statuses = useMemo(() => {
    const map = new Map<DateKey, DayStatus>();
    if (!monthStart || !range) return map;
    const { year, month } = parseDateKey(monthStart);
    for (let day = 1; day <= getDaysInMonth(year, month); day++) {
      const key = toDateKey(year, month, day);
      map.set(key, key < range.start ? { kind: "PAST_DAY" } : key > range.end ? { kind: "OUT_OF_RANGE" } : { kind: "UNKNOWN" });
    }
    return map;
  }, [monthStart, range?.start, range?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <EquipmentSummaryBar
        mri={counts ? `${counts.MRI}대` : <Pending>확인 불가</Pending>}
        ct={counts ? `${counts.CT}대` : <Pending>확인 불가</Pending>}
        todaySlots={
          !slotsApi ? (
            <Pending title={SLOT_UNAVAILABLE}>조회 준비 중</Pending>
          ) : !todayAvailable || todayAvailable.status === "loading" ? (
            <Pending>불러오는 중</Pending>
          ) : todayAvailable.status === "error" ? (
            <span className="inline-flex items-center gap-2">
              <Pending title={todayAvailable.message}>확인 불가</Pending>
              <button
                type="button"
                onClick={() => todayMonth && slotStore.retry(todayMonth)}
                className="rounded-md border border-line bg-white px-2 py-0.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                다시 시도
              </button>
            </span>
          ) : (
            <span title={now ? `${now.dateTime.replace("T", " ")} 기준` : undefined}>{todayAvailable.count}개</span>
          )
        }
      />

      {notice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-[15px] ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
        >
          <p className="flex items-start gap-2">
            {notice.tone === "success" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
            {notice.message}
          </p>
          <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기" className="shrink-0 rounded p-1 hover:bg-black/5">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <EquipmentPicker
        totalCount={equipments.length}
        visibleEquipments={rows}
        query={query}
        onQueryChange={setQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        selection={selected ? selected.id : "ALL"}
        onSelect={setSelection}
        selectionNotice={truncated ? `장비가 ${totalElements}대라 처음 ${equipments.length}대 안에서만 검색·표시합니다.` : null}
        onShowSchedule={(row) => setDialog({ kind: "detail", id: row.id })}
        onEditHours={(row) => setDialog({ kind: "hours", id: row.id })}
        onRegister={() => {
          setNotice(null);
          setDialog({ kind: "create" });
        }}
        onGenerateSlots={() => setDialog({ kind: "slots" })}
        note={equipments.length > SUPPORTED_PREVIEW_COUNT ? `지원 검사는 앞쪽 ${SUPPORTED_PREVIEW_COUNT}대만 표시합니다. 나머지는 [상세]에서 확인해 주세요.` : null}
      />

      {isApiFeature("slots") && today && now ? (
        <ApiSlotSchedule
          store={slotStore}
          monthStates={monthStates}
          today={today}
          nowDateTime={now.dateTime}
          visibleEquipments={visible}
          selectedEquipment={selected}
          totalEquipmentCount={equipments.length}
          scopeLabel={scopeLabel}
        />
      ) : !today || !range || !monthStart ? (
        <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
          슬롯 현황을 불러오고 있습니다.
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-5 min-[900px]:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] min-[1400px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <SlotMonthCalendar
            monthStart={monthStart}
            today={today}
            range={range}
            selectedDate={null}
            statuses={statuses}
            notice={SLOT_UNAVAILABLE}
            onSelectDate={() => undefined}
            onChangeMonth={setViewMonth}
            scopeLabel={scopeLabel}
          />
          <DaySlotList
            date={null}
            state={
              equipments.length === 0
                ? { kind: "NO_EQUIPMENT" }
                : visible.length === 0
                  ? { kind: "NO_MATCH" }
                  : { kind: "MESSAGE", message: "슬롯 목록 조회 기능이 서버에 아직 없어 선택 날짜의 슬롯(시간·장비·상태)을 표시할 수 없습니다." }
            }
            slots={[]}
            scopeLabel={scopeLabel}
            singleEquipmentName={selected?.name ?? null}
            otherEquipmentSlotCount={0}
            slotMinutes={new Map()}
            nowDateTime={now?.dateTime ?? ""}
            onSelectSlot={() => undefined}
          />
        </div>
      )}

      {dialog?.kind === "create" && <CreateEquipmentDialog onClose={() => setDialog(null)} onDone={finish} />}
      {dialog?.kind === "detail" && dialogEquipment && (
        <EquipmentDetailDialog
          equipment={dialogEquipment}
          onClose={() => setDialog(null)}
          onEditInfo={() => setDialog({ kind: "edit", id: dialogEquipment.id })}
          onChanged={reloadPreview}
        />
      )}
      {dialog?.kind === "edit" && dialogEquipment && (
        <EquipmentFormDialog equipment={dialogEquipment} onClose={() => setDialog({ kind: "detail", id: dialogEquipment.id })} onDone={finishAction} />
      )}
      {dialog?.kind === "hours" && dialogEquipment && (
        <EquipmentHoursDialog equipment={dialogEquipment} onClose={() => setDialog(null)} onSaved={reloadPreview} />
      )}
      {dialog?.kind === "slots" &&
        (isApiFeature("slots") ? (
          <ApiSlotGenerationDialog
            equipments={equipments}
            initialId={selected?.id ?? null}
            onClose={() => {
              setDialog(null);
              slotStore.invalidate();
            }}
          />
        ) : (
          <SlotGenerationUnavailableDialog
            equipments={equipments}
            initialId={selected?.id ?? null}
            onClose={() => setDialog(null)}
          />
        ))}</div>
  );
}

function Pending({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="text-base font-semibold text-gray-400" title={title}>
      {children}
    </span>
  );
}

function ApiNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

const EXAM_TYPE_SELECT_OPTIONS = [{ value: "", label: "선택해 주세요" }, ...EQUIPMENT_MODALITIES.map((value) => ({ value, label: value }))];

/** 선택한 지원 검사 유형 한 개 (이 장비에서의 소요 시간 입력값 포함) */
interface SelectedExamType {
  examTypeId: string;
  minutes: string;
}

/** 요일 입력 → 저장 요청 값 (운영하는 요일의 요일·시작·종료만. 휴게 시간은 백엔드에 없어 보내지 않는다) */
const toOperatingDaysPayload = (days: readonly OperatingDayInput[]) =>
  days.filter(({ isOpen }) => isOpen).map(({ weekday, open, close }) => ({ weekday, open, close }));

/** 휴게 시간이 저장되는 것처럼 보이지 않도록 하는 공통 안내 */
const BREAK_NOT_SUPPORTED = "휴게 시간은 서버에 저장하는 기능이 없어 입력받지 않습니다. 요일별 운영 시작·종료 시각만 저장됩니다.";

/**
 * 장비 등록 2단계 (배포 와이어프레임 EquipmentForm과 같은 단계·배치).
 * - 1단계: 장비명·검사 유형(CT/MRI) + 지원 검사 유형과 유형별 소요 시간(분, 1 이상 정수 필수)
 *   '기본 소요 시간'은 새로 고른 검사 유형 칸에 먼저 채워 넣는 값일 뿐 따로 저장하지 않는다
 * - 2단계: 요일별 운영 시간 (하루 이상 필수, 휴게 시간 없음)
 * 등록: 장비 POST → 유형별 연결 POST(소요 시간 포함) → 운영시간 PUT (Server Function 1회).
 * 운영시간 저장만 실패하면 창을 닫지 않고 '장비는 등록됨'을 알린 뒤 그 장비에 운영시간만 다시 저장할 수 있게 한다.
 */
function CreateEquipmentDialog({ onClose, onDone }: { onClose: () => void; onDone: (notice: WorkspaceNotice) => void }) {
  /** 렌더링 시점 로그인 세션 (요청에 함께 보낸다) · 다른 탭 계정 변경 잠금 (이 화면의 장비 변경 요청 공통) */
  const renderedLoginSession = useRenderedLoginSession();
  const sessionChanged = useEquipmentSessionChanged();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [modality, setModality] = useState<EquipmentModalityDto | "">("");
  const [defaultMinutes, setDefaultMinutes] = useState("");
  const [selected, setSelected] = useState<SelectedExamType[]>([]);
  const [touched, setTouched] = useState(false);
  const [days, setDays] = useState<OperatingDayInput[]>(() => toOperatingDayInputs([]));
  const [showHoursErrors, setShowHoursErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** 장비는 등록됐지만 운영시간 저장이 실패한 상태 (다시 제출하면 운영시간만 저장한다) */
  const [created, setCreated] = useState<{ equipmentId: string; linkFailed: number } | null>(null);
  /** 장비 등록 결과를 알 수 없는 상태의 안내 (서버에 이미 등록됐을 수 있어 이 창에서는 다시 등록하지 않는다) */
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const { value: options } = useDetailResult<ExamTypeOptionsResult>(modality || null, () => loadExamTypeOptionsAction(modality), NETWORK_FAILURE);

  const nameError = touched ? validateEquipmentName(name) : null;
  const modalityError = touched && !modality ? "검사 유형(CT·MRI)을 선택해 주세요." : null;
  const defaultMinutesError = touched && defaultMinutes.trim() !== "" ? readDuration(defaultMinutes).error : null;
  const minuteErrors = new Map(selected.map((item) => [item.examTypeId, touched ? readDuration(item.minutes).error : null]));
  const noOpenDay = showHoursErrors && !hasOpenDay(days);
  const linkNote = (linkFailed: number) => (linkFailed > 0 ? ` 지원 검사 유형 ${linkFailed}개는 연결하지 못했습니다. 장비 상세에서 다시 추가해 주세요.` : "");

  const close = () => {
    if (pending) return;
    // 등록 결과를 알 수 없으면 닫을 때도 목록 위에 남겨 먼저 확인하게 한다
    if (uncertain) {
      onDone({ tone: "warning", message: uncertain });
      return;
    }
    // 장비는 이미 등록됐으므로 닫을 때 무엇이 남았는지 목록 위에 알린다
    if (created) {
      onDone({
        tone: "warning",
        message: `장비는 등록되었지만 운영 시간은 저장되지 않았습니다. 장비 목록의 [운영시간 설정 필요]에서 설정해 주세요.${linkNote(created.linkFailed)}`,
      });
      return;
    }
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 1) {
      setTouched(true);
      const minutesValid = selected.every((item) => !readDuration(item.minutes).error);
      if (!validateEquipmentName(name) && modality && minutesValid) setStep(2);
      return;
    }
    setShowHoursErrors(true);
    if (pendingRef.current || sessionChanged || uncertain || !hasOpenDay(days) || !isOperatingDaysValid(days)) return;
    pendingRef.current = true;
    setPending(true);
    setSubmitError(null);
    const operatingHours = toOperatingDaysPayload(days);
    try {
      if (created) {
        const result = await saveEquipmentOperatingHoursAction(created.equipmentId, operatingHours, renderedLoginSession);
        if (result.ok) {
          onDone({ tone: created.linkFailed > 0 ? "warning" : "success", message: `장비를 등록하고 운영 시간을 저장했습니다.${linkNote(created.linkFailed)}` });
          return;
        }
        if (result.reason === "SESSION_CHANGED") markEquipmentSessionChanged();
        setSubmitError(result.message);
        return;
      }
      const result = await createEquipmentWithExamTypesAction(
        {
          name,
          modality,
          examTypes: selected.map((item) => ({ examTypeId: item.examTypeId, durationMinutes: readDuration(item.minutes).value })),
          operatingHours,
        },
        renderedLoginSession,
      );
      if (!result.ok) {
        if (result.reason === "SESSION_CHANGED") markEquipmentSessionChanged();
        // 결과 불명: 등록 버튼을 잠근다 (자동·수동 재전송 없음. 장비 목록에서 먼저 확인하게 안내)
        if (result.reason === "UNCERTAIN") setUncertain(result.message);
        setSubmitError(result.message);
        const fields = result.fieldErrors ?? {};
        if (fields.name || fields.modality || fields.examTypeId || fields.durationMinutes) setStep(1);
        return;
      }
      if (result.hoursError) {
        setCreated({ equipmentId: result.equipmentId, linkFailed: result.linkFailed });
        setSubmitError(result.hoursError);
        return;
      }
      onDone({ tone: result.linkFailed > 0 ? "warning" : "success", message: result.message });
    } catch {
      // 응답을 받지 못하면 서버에서 등록됐는지 알 수 없다: 같은 장비를 두 번 만들지 않도록 등록 버튼을 잠그고 목록 확인을 먼저 안내한다
      // (운영시간 다시 저장은 PUT 전체 설정이라 다시 보내도 같은 결과여서 잠그지 않는다)
      if (created) {
        setSubmitError(NETWORK_ERROR_MESSAGE);
      } else {
        const message = "서버 응답을 받지 못했습니다. 장비가 이미 등록되었을 수 있으니 창을 닫고 장비 목록을 확인한 뒤 다시 시도해 주세요.";
        setUncertain(message);
        setSubmitError(message);
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const formId = "api-equipment-create-form";

  return (
    <Modal
      open
      size="form2"
      title="장비 등록"
      description="기본 정보와 운영 시간을 입력하면 장비를 등록합니다."
      onClose={close}
      closeOnBackdrop={false}
      // 하단 버튼은 본문 스크롤 밖에 고정한다 (form 속성으로 아래 폼에 연결: Enter 제출·검증 흐름은 그대로)
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {step === 2 && !created && (
            <button type="button" onClick={() => setStep(1)} disabled={pending} className={`${secondaryButtonClass} sm:mr-auto`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              이전
            </button>
          )}
          <button type="button" onClick={close} disabled={pending} className={secondaryButtonClass}>
            {created ? "닫기" : "취소"}
          </button>
          {step === 1 ? (
            <button type="submit" form={formId} disabled={pending} className={primaryButtonClass}>
              다음
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" form={formId} disabled={pending || sessionChanged || uncertain !== null} className={primaryButtonClass}>
              {pending ? (created ? "저장 중" : "등록 중") : created ? "운영 시간 다시 저장" : "장비 등록"}
            </button>
          )}
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate aria-busy={pending}>
        <ol aria-label="등록 단계" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {(
            [
              [1, "기본 정보"],
              [2, "운영 시간"],
            ] as const
          ).map(([value, label], index) => (
            <li key={value} aria-current={step === value ? "step" : undefined} className="flex items-center gap-2">
              {index > 0 && <span className="h-px w-6 bg-line" aria-hidden="true" />}
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === value ? "bg-primary text-white" : step > value ? "bg-primary-soft text-primary" : "bg-gray-100 text-gray-500"
                }`}
              >
                {value}
              </span>
              <span className={step === value ? "font-bold text-gray-900" : "text-gray-500"}>{label}</span>
            </li>
          ))}
          {step === 2 && (
            <li className="ml-1 min-w-0 truncate text-sm text-gray-500" aria-label="등록할 장비">
              {name.trim()} · {modality}
            </li>
          )}
        </ol>

        {submitError && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>
              {created
                ? `${name.trim()} 장비는 등록되었지만 운영 시간은 저장되지 않았습니다. (${submitError}) 운영 시간을 다시 저장하거나, 창을 닫은 뒤 장비 목록의 [운영시간 설정 필요]에서 설정해 주세요.${linkNote(created.linkFailed)}`
                : submitError}
            </p>
          </div>
        )}

        {step === 1 ? (
          <fieldset disabled={pending} className="min-w-0">
            <legend className="sr-only">1단계 · 장비 기본 정보</legend>
            {/* 데스크톱: 왼쪽 기본 정보 · 오른쪽 지원 검사 유형 / 좁은 화면: 1단 */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 min-[860px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <TextInput
                  id="api-equipment-name"
                  label="장비명"
                  data-autofocus
                  required
                  autoComplete="off"
                  maxLength={EQUIPMENT_NAME_MAX_LENGTH}
                  placeholder="예: CT 1호기"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched(true)}
                  error={nameError ?? undefined}
                />
                <div>
                  <SelectInput
                    id="api-equipment-type"
                    label="검사 유형"
                    options={EXAM_TYPE_SELECT_OPTIONS}
                    value={modality}
                    aria-invalid={modalityError ? true : undefined}
                    aria-describedby={modalityError ? "api-equipment-type-error" : undefined}
                    onChange={(e) => {
                      setModality(e.target.value as EquipmentModalityDto | "");
                      setSelected([]);
                    }}
                  />
                  {modalityError && (
                    <p id="api-equipment-type-error" className="mt-1.5 text-sm text-red-600">
                      {modalityError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="api-equipment-minutes" className={fieldLabelClass}>
                    기본 소요 시간(분) <span className="font-normal text-gray-500">(선택)</span>
                  </label>
                  <input
                    id="api-equipment-minutes"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={defaultMinutes}
                    onChange={(e) => setDefaultMinutes(e.target.value)}
                    aria-invalid={defaultMinutesError ? true : undefined}
                    aria-describedby={`api-equipment-minutes-hint${defaultMinutesError ? " api-equipment-minutes-error" : ""}`}
                    className={`${controlClass} pr-4 ${defaultMinutesError ? "border-red-500" : ""}`}
                  />
                  <p id="api-equipment-minutes-hint" className="mt-1 text-xs text-gray-500">
                    새로 고르는 지원 검사 유형에 먼저 채워 넣습니다.
                  </p>
                  {defaultMinutesError && (
                    <p id="api-equipment-minutes-error" className="mt-1 text-sm text-red-600">
                      {defaultMinutesError}
                    </p>
                  )}
                </div>
                <p className="text-xs text-gray-500">등록 직후 고른 검사 유형을 입력한 소요 시간으로 연결합니다. 장비 상태는 정상으로 시작합니다.</p>
              </div>
              <SupportedExamTypesPicker
                modality={modality}
                options={options}
                selected={selected}
                errors={minuteErrors}
                defaultMinutes={readDuration(defaultMinutes).error ? "" : defaultMinutes.trim()}
                onChange={setSelected}
              />
            </div>
          </fieldset>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="sr-only">2단계 · 운영 시간 설정</h3>
            {noOpenDay && (
              <p role="alert" className="text-sm text-red-600">
                운영하는 요일을 하루 이상 설정해야 등록할 수 있습니다.
              </p>
            )}
            {showHoursErrors && hasOpenDay(days) && !isOperatingDaysValid(days) && (
              <p role="alert" className="text-sm text-red-600">
                표시된 요일의 운영 시간을 확인해 주세요.
              </p>
            )}
            <OperatingHoursFields days={days} onChange={setDays} showErrors={showHoursErrors} disabled={pending} allowBreak={false} />
            <ApiNotice>{BREAK_NOT_SUPPORTED}</ApiNotice>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** 지원 검사 유형 다중 선택 + 고른 유형마다 소요 시간 (같은 종류의 실제 검사 유형만. 0개면 안내, Mock 값을 쓰지 않는다) */
function SupportedExamTypesPicker({
  modality,
  options,
  selected,
  errors,
  defaultMinutes,
  onChange,
}: {
  modality: EquipmentModalityDto | "";
  options: ExamTypeOptionsResult | null;
  selected: SelectedExamType[];
  errors: Map<string, string | null>;
  /** 새로 고른 유형에 먼저 채울 값 (올바르지 않으면 빈 문자열) */
  defaultMinutes: string;
  onChange: (selected: SelectedExamType[]) => void;
}) {
  const list: ExamTypeDto[] = options?.ok ? options.examTypes : [];
  const nameOf = new Map(list.map((item) => [item.id, item.name]));
  return (
    <fieldset aria-describedby="api-equipment-supported-hint">
      <legend className={fieldLabelClass}>
        지원 검사 유형 <span className="font-normal text-gray-500">(선택)</span>
      </legend>
      {!modality ? (
        <p className="text-sm text-gray-500">검사 유형(CT·MRI)을 먼저 선택하면 고를 수 있습니다.</p>
      ) : options === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          검사 유형 목록을 불러오고 있습니다.
        </p>
      ) : !options.ok ? (
        <p role="alert" className="text-sm text-red-600">{options.message}</p>
      ) : list.length === 0 ? (
        <p role="status" className="text-sm text-gray-600">등록된 {modality} 검사 유형이 없습니다. 검사 유형이 등록되면 장비 상세에서 연결할 수 있습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {list.map((option) => {
              const checked = selected.some((item) => item.examTypeId === option.id);
              return (
                <label
                  key={option.id}
                  className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[15px] ${checked ? "border-primary bg-primary-soft text-primary" : "border-line bg-white text-gray-700"
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, { examTypeId: option.id, minutes: defaultMinutes }]
                          : selected.filter((item) => item.examTypeId !== option.id),
                      )
                    }
                    className="size-4 accent-primary"
                  />
                  {option.name}
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <ul aria-label="검사 유형별 소요 시간" className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {selected.map((item) => {
                const inputId = `api-equipment-duration-${item.examTypeId}`;
                const label = nameOf.get(item.examTypeId) ?? "검사 유형";
                const error = errors.get(item.examTypeId) ?? null;
                return (
                  <li key={item.examTypeId} className="flex flex-col gap-1 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor={inputId} className="text-[15px] font-medium text-gray-900">
                        {label} <span className="text-sm font-normal text-gray-500">소요 시간</span> <span className="text-red-600" aria-hidden="true">*</span>
                      </label>
                      <DurationInput
                        id={inputId}
                        label={`${label} 소요 시간(분)`}
                        value={item.minutes}
                        error={error}
                        onChange={(minutes) => onChange(selected.map((entry) => (entry.examTypeId === item.examTypeId ? { ...entry, minutes } : entry)))}
                      />
                    </div>
                    {error && (
                      <p id={`${inputId}-error`} className="text-right text-sm text-red-600">
                        {error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <p id="api-equipment-supported-hint" className="mt-1.5 text-sm text-gray-500">
        {modality || "장비"} 장비에서 할 수 있는 검사를 고르고, 검사마다 이 장비에서 걸리는 시간(분, 1 이상 정수)을 입력합니다. 고르지 않으면 &lsquo;미설정&rsquo;으로 표시됩니다.
      </p>
    </fieldset>
  );
}

/**
 * 운영시간 조회·설정 (요청: 열 때 장비 확인 1 + 운영시간 1, 저장 PUT 1 + 다시 조회 2).
 * PUT은 보낸 요일만 남기므로 서버 값을 불러오기 전·불러오기 실패 시에는 저장 폼을 보이지 않는다 (기본값으로 덮어쓰지 않는다).
 * 저장에 성공하면 서버 값을 다시 불러와 폼을 그 값으로 바꾼다.
 */
function EquipmentHoursDialog({ equipment, onClose, onSaved }: { equipment: EquipmentDto; onClose: () => void; onSaved: () => void }) {
  const { value: loaded, retry: reload } = useDetailResult<EquipmentOperatingHoursResult>(
    equipment.id,
    () => loadEquipmentOperatingHoursAction(equipment.id),
    NETWORK_FAILURE,
  );
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formKey = loaded?.ok ? JSON.stringify(loaded.hours) : null;

  return (
    <Modal
      open
      size="lg"
      title={`${equipment.name} 운영 시간 수정`}
      description={`${equipment.modality} · ${loaded?.ok ? (loaded.hours.length > 0 ? formatOperatingHoursSummary(loaded.hours) : "운영시간 미설정") : "운영 시간 확인 중"}`}
      onClose={() => !busy && onClose()}
      closeOnBackdrop={false}
    >
      <div className="flex flex-col gap-4">
        {savedMessage && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-[15px] text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {savedMessage}
          </p>
        )}
        {loaded === null ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            운영 시간을 불러오고 있습니다.
          </p>
        ) : !loaded.ok ? (
          <>
            <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loaded.message}
              {loaded.reason !== "FORBIDDEN" && (
                <button type="button" onClick={reload} className={secondaryButtonClass}>
                  다시 시도
                </button>
              )}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={secondaryButtonClass}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <HoursEditForm
            key={formKey}
            equipmentId={equipment.id}
            initial={loaded.hours}
            onBusyChange={setBusy}
            onCancel={onClose}
            onSaved={(message) => {
              setSavedMessage(`${message} 서버에 저장된 운영 시간을 다시 불러왔습니다.`);
              reload();
              onSaved();
            }}
            onStale={reload}
          />
        )}
      </div>
    </Modal>
  );
}

function HoursEditForm({
  equipmentId,
  initial,
  onBusyChange,
  onCancel,
  onSaved,
  onStale,
}: {
  equipmentId: string;
  initial: DailyOperatingHours[];
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (message: string) => void;
  /** 404·409: 서버 값이 바뀌었을 수 있어 다시 불러온다 */
  onStale: () => void;
}) {
  const [days, setDays] = useState<OperatingDayInput[]>(() => toOperatingDayInputs(initial));
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const noOpenDay = showErrors && !hasOpenDay(days);
  /** 렌더링 시점 로그인 세션 (요청에 함께 보낸다) · 다른 탭 계정 변경 잠금 (이 화면의 장비 변경 요청 공통) */
  const renderedLoginSession = useRenderedLoginSession();
  const sessionChanged = useEquipmentSessionChanged();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowErrors(true);
    if (pendingRef.current || sessionChanged || !hasOpenDay(days) || !isOperatingDaysValid(days)) return;
    pendingRef.current = true;
    setPending(true);
    onBusyChange(true);
    setSubmitError(null);
    let done = false;
    try {
      const result = await saveEquipmentOperatingHoursAction(equipmentId, toOperatingDaysPayload(days), renderedLoginSession);
      if (result.ok) {
        done = true;
        onSaved(result.message);
        return;
      }
      if (result.reason === "SESSION_CHANGED") markEquipmentSessionChanged();
      setSubmitError(result.message);
      if (result.reason === "NOT_FOUND" || result.reason === "CONFLICT") onStale();
    } catch {
      setSubmitError(NETWORK_ERROR_MESSAGE);
    } finally {
      onBusyChange(false);
      if (!done) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-3">
      {submitError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{submitError}</p>
        </div>
      )}
      {noOpenDay && (
        <p role="alert" className="text-sm text-red-600">
          운영하는 요일을 하루 이상 설정해야 저장할 수 있습니다.
        </p>
      )}
      {showErrors && hasOpenDay(days) && !isOperatingDaysValid(days) && (
        <p role="alert" className="text-sm text-red-600">
          표시된 요일의 운영 시간을 확인해 주세요.
        </p>
      )}
      <OperatingHoursFields days={days} onChange={setDays} showErrors={showErrors} disabled={pending} allowBreak={false} />
      <ApiNotice>
        {BREAK_NOT_SUPPORTED} 체크하지 않은 요일은 휴무로 저장됩니다. 이미 만든 슬롯·예약은 이 저장으로 바뀌지 않습니다.
      </ApiNotice>
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={pending} className={secondaryButtonClass}>
          닫기
        </button>
        <button type="submit" disabled={pending || sessionChanged} className={primaryButtonClass}>
          {pending ? "저장 중" : "운영 시간 저장"}
        </button>
      </div>
    </form>
  );
}

/**
 * 슬롯 생성 (배포 와이어프레임 SlotGenerationForm과 같은 배치).
 * 백엔드에는 슬롯 1건 생성(POST /api/v1/slots)만 있고 기간·운영시간 기준 일괄 생성과 중복 확인용 슬롯 목록 조회가 없다.
 * 프론트에서 일괄 생성을 흉내 내지 않고 미리보기·생성 버튼을 비활성으로 둔다.
 */
function SlotGenerationUnavailableDialog({ equipments, initialId, onClose }: { equipments: EquipmentDto[]; initialId: string | null; onClose: () => void }) {
  const [equipmentId, setEquipmentId] = useState(initialId ?? equipments[0]?.id ?? "");
  const equipment = equipments.find((item) => item.id === equipmentId) ?? null;
  return (
    <Modal open size="lg" title="슬롯 생성" description="장비 운영 시간과 슬롯 소요 시간으로 검사 가능 슬롯을 만듭니다." closeOnBackdrop={false} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <SelectInput
            id="api-slot-generation-equipment"
            label="대상 장비"
            data-autofocus
            options={equipments.map((item) => ({ value: item.id, label: `${item.name} (${item.modality})` }))}
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
          />
          {equipment && <p className="mt-1.5 text-sm text-gray-500">슬롯 단위는 장비별 검사 소요 시간을 따릅니다</p>}
        </div>
        <fieldset disabled className="flex flex-col gap-5">
          <legend className="sr-only">생성 기간과 시간 (서버 기능 준비 중이라 입력할 수 없음)</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DatePicker id="api-slot-generation-start" label="생성 시작일" value="" onChange={() => undefined} placeholder="시작일 선택" />
            <DatePicker id="api-slot-generation-end" label="생성 종료일" value="" onChange={() => undefined} placeholder="종료일 선택" />
          </div>
          <label className="inline-flex cursor-not-allowed items-center gap-2 text-[15px] font-medium text-gray-400">
            <input type="checkbox" defaultChecked className="size-[18px] accent-primary" />
            장비 운영 시간 전체에 생성
          </label>
        </fieldset>

        <section aria-labelledby="api-slot-generation-preview-title" className="rounded-lg bg-surface-muted px-4 py-4">
          <h3 id="api-slot-generation-preview-title" className="text-sm font-bold text-gray-700">
            생성 미리보기
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[15px] sm:grid-cols-4">
            <PreviewItem label="대상 장비">{equipment?.name ?? "-"}</PreviewItem>
            <PreviewItem label="적용 기간">-</PreviewItem>
            <PreviewItem label="생성 예정">계산 불가</PreviewItem>
            <PreviewItem label="겹쳐서 제외">계산 불가</PreviewItem>
          </dl>
          <p className="mt-2 text-sm text-gray-500">기존 슬롯을 조회할 수 없어 생성 예정·중복 제외 건수를 계산하지 않습니다.</p>
        </section>

        <ApiNotice>
          <strong className="mr-1 font-semibold">[서버 기능 준비 중]</strong>
          기간·운영 시간 기준 슬롯 일괄 생성 API가 아직 없어 슬롯을 만들 수 없습니다. 서버에는 슬롯 1건 생성 API만 있습니다.
        </ApiNotice>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="h-12 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50">
            닫기
          </button>
          <button type="button" disabled className="h-12 cursor-not-allowed rounded-lg bg-gray-200 px-6 text-[15px] font-bold text-gray-400">
            슬롯 생성 (준비 중)
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewItem({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="truncate font-semibold tabular-nums text-gray-900" title={children}>
        {children}
      </dd>
    </div>
  );
}

