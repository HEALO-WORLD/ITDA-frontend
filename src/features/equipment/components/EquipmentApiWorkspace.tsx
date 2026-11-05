"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { controlClass, fieldLabelClass, SelectInput, TextInput } from "@/components/ui/FormControls";
import Modal from "@/components/ui/Modal";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { NETWORK_FAILURE, useDetailResult } from "@/features/admin/components/AdminDetailParts";
import type { ExamTypeDto } from "@/features/referrals/remote";
import { addDays, getDaysInMonth, parseDateKey, toDateKey, type DateKey } from "@/lib/date/seoulDate";
import { useSeoulNow } from "@/lib/date/useSeoulNow";

import { createEquipmentWithExamTypesAction, loadExamTypeOptionsAction, loadSupportedExamTypesAction, type EquipmentActionResult } from "../actions";
import type { DayStatus } from "../dayStatus";
import { EQUIPMENT_MODALITIES, EQUIPMENT_NAME_MAX_LENGTH, validateEquipmentName, type EquipmentDto, type EquipmentModalityDto, type EquipmentStatusDto } from "../remote";
import type { ExamTypeOptionsResult, SupportedExamTypesResult } from "../server";

import DaySlotList from "./DaySlotList";
import { EquipmentDetailDialog, EquipmentFormDialog } from "./EquipmentApiDialogs";
import EquipmentPicker, { type EquipmentPickerRow, type EquipmentSelection, type ExamTypeFilter } from "./EquipmentPicker";
import { EquipmentSummaryBar } from "./EquipmentSummary";
import { OperatingHoursFields, toOperatingDayInputs } from "./OperatingHoursForm";
import SlotMonthCalendar from "./SlotMonthCalendar";

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
 * - 장비 목록·등록·정보 수정·지원 검사 유형은 실제 API (Server Function, 등록·수정 후 refresh로 서버 값에 맞춘다)
 * - 운영시간·슬롯 목록·슬롯 일괄 생성은 백엔드 API가 없다: 모양은 두고 '조회 준비 중'·비활성으로 안내한다 (Mock 값·0으로 채우지 않는다)
 */
export default function EquipmentApiWorkspace({ equipments, totalElements, truncated, counts }: EquipmentApiWorkspaceProps) {
  const now = useSeoulNow();
  const today = now?.dateKey ?? null;
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ExamTypeFilter>("ALL");
  const [selection, setSelection] = useState<EquipmentSelection>("ALL");
  const [viewMonth, setViewMonth] = useState<DateKey | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "warning" } | null>(null);

  const visible = useMemo(() => {
    const keyword = normalize(query);
    return equipments.filter((item) => (typeFilter === "ALL" || item.modality === typeFilter) && (!keyword || normalize(item.name).includes(keyword)));
  }, [equipments, query, typeFilter]);
  const selected = selection === "ALL" ? null : (visible.find((item) => item.id === selection) ?? null);
  const isFiltered = query.trim() !== "" || typeFilter !== "ALL";
  const scopeLabel = selected ? `${selected.name} · ${selected.modality}` : `${isFiltered ? "검색 결과 전체" : "전체 장비"} ${visible.length}대`;

  // 지원 검사 유형: 목록 앞쪽 장비만 미리 조회한다 (장비당 1회, 최대 10대). 나머지는 상세에서 확인
  const previewIds = useMemo(() => equipments.slice(0, SUPPORTED_PREVIEW_COUNT).map((item) => item.id), [equipments]);
  const previewKey = previewIds.length > 0 ? previewIds.join(",") : null;
  const { value: supported } = useDetailResult<SupportedExamTypesResult>(previewKey, () => loadSupportedExamTypesAction(previewIds), NETWORK_FAILURE);

  const supportedOf = (id: string): EquipmentPickerRow["supported"] => {
    if (!previewIds.includes(id)) return { placeholder: "상세에서 확인" };
    if (supported === null) return { placeholder: "불러오는 중" };
    if (!supported.ok) return { placeholder: "확인 불가" };
    const entry = supported.byEquipment[id.toLowerCase()];
    return !entry || "failed" in entry ? { placeholder: "확인 불가" } : entry.names;
  };

  const rows: EquipmentPickerRow[] = visible.map((item) => ({
    id: item.id,
    name: item.name,
    examType: item.modality,
    statusBadge: <ApiStatusDot status={item.status} />,
    hours: { kind: "unavailable" },
    supported: supportedOf(item.id),
  }));

  const byId = (id: string) => equipments.find((item) => item.id === id) ?? null;
  const dialogEquipment = dialog && "id" in dialog ? byId(dialog.id) : null;
  const finish = (result: EquipmentActionResult & { linkFailed?: number }) => {
    setDialog(null);
    setNotice({ message: result.message, tone: result.ok && !result.linkFailed ? "success" : "warning" });
  };

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
        todaySlots={<Pending title={SLOT_UNAVAILABLE}>조회 준비 중</Pending>}
      />

      {notice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-[15px] ${
            notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"
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

      {!today || !range || !monthStart ? (
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
        <EquipmentDetailDialog equipment={dialogEquipment} onClose={() => setDialog(null)} onEditInfo={() => setDialog({ kind: "edit", id: dialogEquipment.id })} />
      )}
      {dialog?.kind === "edit" && dialogEquipment && (
        <EquipmentFormDialog equipment={dialogEquipment} onClose={() => setDialog({ kind: "detail", id: dialogEquipment.id })} onDone={finish} />
      )}
      {dialog?.kind === "hours" && dialogEquipment && <HoursUnavailableDialog equipment={dialogEquipment} onClose={() => setDialog(null)} />}
      {dialog?.kind === "slots" && <SlotGenerationUnavailableDialog equipments={equipments} initialId={selected?.id ?? null} onClose={() => setDialog(null)} />}
    </div>
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

/**
 * 장비 등록 2단계 (배포 와이어프레임 EquipmentForm과 같은 단계·배치).
 * - 1단계: 장비명·검사 유형(CT/MRI)은 등록 API로 보낸다. 지원 검사 유형은 등록 뒤 연결 API로 하나씩 연결한다.
 *   슬롯 소요 시간은 장비 등록 DTO에 없어 입력하지 않는다 (검사 유형마다 소요 시간이 있다)
 * - 2단계: 운영 시간은 백엔드 API가 없어 입력 칸을 비활성으로 보여 주기만 한다 (보내지 않는다)
 */
function CreateEquipmentDialog({ onClose, onDone }: { onClose: () => void; onDone: (result: EquipmentActionResult & { linkFailed?: number }) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [modality, setModality] = useState<EquipmentModalityDto | "">("");
  const [examTypeIds, setExamTypeIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const { value: options } = useDetailResult<ExamTypeOptionsResult>(modality || null, () => loadExamTypeOptionsAction(modality), NETWORK_FAILURE);
  const days = useMemo(() => toOperatingDayInputs([]), []);

  const nameError = touched ? validateEquipmentName(name) : null;
  const modalityError = touched && !modality ? "검사 유형(CT·MRI)을 선택해 주세요." : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 1) {
      setTouched(true);
      if (!validateEquipmentName(name) && modality) setStep(2);
      return;
    }
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setSubmitError(null);
    try {
      const result = await createEquipmentWithExamTypesAction({ name, modality, examTypeIds });
      if (result.ok) return onDone(result);
      setSubmitError(result.message);
      if (result.reason === "INVALID") setStep(1);
    } catch {
      setSubmitError("서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Modal open size="lg" title="장비 등록" description="기본 정보와 운영 시간을 입력하면 장비를 등록합니다." onClose={() => !pending && onClose()} closeOnBackdrop={false}>
      <form onSubmit={submit} noValidate aria-busy={pending}>
        <ol aria-label="등록 단계" className="mb-5 flex items-center gap-2 text-sm">
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
        </ol>

        {submitError && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>{submitError}</p>
          </div>
        )}

        {step === 1 ? (
          <fieldset disabled={pending} className="flex flex-col gap-5">
            <h3 className="text-base font-bold text-gray-900">1단계 · 장비 기본 정보</h3>
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
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                    setExamTypeIds([]);
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
                  슬롯 소요 시간(분)
                </label>
                <input id="api-equipment-minutes" type="number" disabled placeholder="후속 설정" aria-describedby="api-equipment-minutes-hint" className={`${controlClass} pr-4`} />
                <p id="api-equipment-minutes-hint" className="mt-1.5 text-sm text-gray-500">
                  장비 등록 API가 받지 않는 항목입니다. 검사 유형마다 정해진 소요 시간을 씁니다.
                </p>
              </div>
            </div>
            <SupportedExamTypesPicker modality={modality} options={options} selected={examTypeIds} onChange={setExamTypeIds} />
          </fieldset>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-bold text-gray-900">
              2단계 · 운영 시간 설정
              <span className="ml-2 text-sm font-normal text-gray-500">
                {name.trim()} · {modality}
              </span>
            </h3>
            <ApiNotice>
              <strong className="mr-1 font-semibold">[후속 설정]</strong>
              운영 시간 저장 기능이 서버에 아직 없어 지금은 입력할 수 없습니다. 아래 값은 보내지 않으며, 장비만 등록됩니다.
            </ApiNotice>
            <OperatingHoursFields days={days} onChange={() => undefined} showErrors={false} disabled />
          </div>
        )}

        {step === 1 && (
          <div className="mt-5">
            <ApiNotice>
              장비명과 검사 유형은 서버에 등록되고, 고른 지원 검사 유형은 등록 직후 연결합니다. 장비 상태는 정상으로 시작합니다.
            </ApiNotice>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {step === 2 && (
            <button type="button" onClick={() => setStep(1)} disabled={pending} className={`${secondaryButtonClass} sm:mr-auto`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              이전
            </button>
          )}
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
            취소
          </button>
          {step === 1 ? (
            <button type="submit" disabled={pending} className={primaryButtonClass}>
              다음
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" disabled={pending} className={primaryButtonClass}>
              {pending ? "등록 중" : "장비 등록"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** 지원 검사 유형 다중 선택 (같은 종류의 실제 검사 유형만. 0개면 안내, Mock 값을 쓰지 않는다) */
function SupportedExamTypesPicker({
  modality,
  options,
  selected,
  onChange,
}: {
  modality: EquipmentModalityDto | "";
  options: ExamTypeOptionsResult | null;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const list: ExamTypeDto[] = options?.ok ? options.examTypes : [];
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
        <div className="flex flex-wrap gap-2">
          {list.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[15px] ${
                  checked ? "border-primary bg-primary-soft text-primary" : "border-line bg-white text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChange(e.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))}
                  className="size-4 accent-primary"
                />
                {option.name}
              </label>
            );
          })}
        </div>
      )}
      <p id="api-equipment-supported-hint" className="mt-1.5 text-sm text-gray-500">
        {modality || "장비"} 장비에서 할 수 있는 검사를 고릅니다. 고르지 않으면 &lsquo;미설정&rsquo;으로 표시됩니다.
      </p>
    </fieldset>
  );
}

/** 운영시간 수정 (배포 와이어프레임의 버튼 자리). 운영시간 API가 없어 입력 칸을 비활성으로 보여 주고 안내한다 */
function HoursUnavailableDialog({ equipment, onClose }: { equipment: EquipmentDto; onClose: () => void }) {
  const days = useMemo(() => toOperatingDayInputs([]), []);
  return (
    <Modal open size="lg" title={`${equipment.name} 운영 시간 수정`} description={`${equipment.modality} · 운영 시간 조회 준비 중`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ApiNotice>
          <strong className="mr-1 font-semibold">[서버 기능 준비 중]</strong>
          운영 시간 조회·저장 API가 아직 없어 이 장비의 운영 시간을 확인하거나 바꿀 수 없습니다. 아래 칸은 입력할 수 없으며 보내지 않습니다.
        </ApiNotice>
        <OperatingHoursFields days={days} onChange={() => undefined} showErrors={false} disabled />
        <div className="flex justify-end">
          <button type="button" data-autofocus onClick={onClose} className={secondaryButtonClass}>
            닫기
          </button>
        </div>
      </div>
    </Modal>
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
          {equipment && <p className="mt-1.5 text-sm text-gray-500">운영 시간 조회 준비 중 · 슬롯 단위는 검사 유형 소요 시간을 따릅니다</p>}
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
          <p className="mt-2 text-sm text-gray-500">운영 시간과 기존 슬롯을 조회할 수 없어 생성 예정·중복 제외 건수를 계산하지 않습니다.</p>
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

