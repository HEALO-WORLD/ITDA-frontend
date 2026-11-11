"use client";

import { AlertTriangle, ChevronDown, Info, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { SelectInput } from "@/components/ui/FormControls";
import Modal from "@/components/ui/Modal";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { useDetailResult } from "@/features/admin/components/AdminDetailParts";
import { useRenderedLoginSession } from "@/features/auth/loginSessionContext";
import { generateSlotRangeAction, loadGeneratedSlotsAction, loadSlotGenerationContextAction } from "@/features/slots/generateActions";
import type {
  GenerationDayResult,
  GeneratedSlotsLookupResult,
  SlotGenerationContextResult,
  SlotRangeGenerationResult,
} from "@/features/slots/generateServer";
import {
  listRangeDates,
  MAX_GENERATION_DAYS,
  splitOperatingDates,
  validateGenerationRange,
  type GenerationDayStatus,
} from "@/features/slots/generationRange";
import { API_SEARCH_MAX_LOOKAHEAD_DAYS } from "@/features/slots/apiSearchClient";
import { createSubmitLock } from "@/features/slots/submitLock";
import { addDays, getSeoulNow, getWeekday, type DateKey } from "@/lib/date/seoulDate";
import { WEEKDAYS } from "@/lib/format/date";

import { formatOperatingHoursSummary } from "../operatingHours";
import type { EquipmentDto, EquipmentStatusDto } from "../remote";

/**
 * 슬롯 생성 (API 모드). 장비 등록 모달과 같은 너비(form2)·2단 배치·하단 고정 버튼.
 * 왼쪽: 장비·검사 정보 (장비, 연결된 검사 유형, 소요 시간, 장비 상태, 운영시간) / 오른쪽: 생성 기간 (시작·종료, 최대 14일)
 *
 * 백엔드 `POST /api/v1/slots/generate`는 하루만 만든다. 서버(generateSlotRangeAction)가 기간의 운영일마다 차례로 1회씩 요청한다.
 * - 운영하지 않는 요일은 자동으로 빼고, 이미 슬롯이 있는 날은 요청하지 않는다 (기존 슬롯을 지우거나 덮어쓰지 않는다)
 * - 생성 개수는 서버가 운영시간·소요 시간으로 정한다: 생성 예정 슬롯 수를 미리 계산해 보여 주지 않는다
 * - 결과는 날짜별로 구분한다 (성공·중복·실패·확인 필요·미처리·휴무). 확인 필요 날짜는 [서버에서 확인]으로 슬롯 검색 API를 다시 조회한다
 * - 연속 클릭: 요청 중에는 막고(submitLock), 전부 성공한 같은 조건은 다시 보내지 않는다. 다시 보내더라도 서버가 기존 슬롯이 있는 날짜를 거른다
 * Mock 화면(SlotGenerationForm)은 그대로 둔다.
 */

const CONTEXT_NETWORK_FAILURE: SlotGenerationContextResult = { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요." };
const NETWORK_FAILURE_MESSAGE = "서버 응답을 받지 못했습니다. 일부 날짜의 슬롯이 만들어졌을 수 있으니 다시 요청하기 전에 장비 슬롯 현황을 확인해 주세요.";

const STATUS_LABEL: Record<EquipmentStatusDto, string> = { OPERATIONAL: "정상", MAINTENANCE: "점검 중", FAILED: "장애" };

const DAY_STATUS_META: Record<GenerationDayStatus, { label: string; className: string }> = {
  SUCCESS: { label: "성공", className: "bg-emerald-50 text-emerald-700" },
  CONFLICT: { label: "중복", className: "bg-amber-50 text-amber-800" },
  FAILED: { label: "실패", className: "bg-red-50 text-red-700" },
  UNKNOWN: { label: "확인 필요", className: "bg-orange-50 text-orange-800" },
  NOT_PROCESSED: { label: "미처리", className: "bg-gray-100 text-gray-600" },
  SKIPPED: { label: "휴무 제외", className: "bg-gray-50 text-gray-500" },
};

const timeOf = (minute: string) => minute.slice(11, 16);
const dayLabel = (date: DateKey) => `${date.slice(5).replace("-", ".")}(${WEEKDAYS[getWeekday(date)]})`;

interface ApiSlotGenerationDialogProps {
  equipments: EquipmentDto[];
  initialId: string | null;
  onClose: () => void;
}

export default function ApiSlotGenerationDialog({ equipments, initialId, onClose }: ApiSlotGenerationDialogProps) {
  const [equipmentId, setEquipmentId] = useState(initialId ?? "");
  const [examTypeId, setExamTypeId] = useState("");
  const [startDate, setStartDate] = useState<DateKey | "">("");
  const [endDate, setEndDate] = useState<DateKey | "">("");
  const [pending, setPending] = useState(false);
  const [lock] = useState(createSubmitLock);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<SlotRangeGenerationResult, { ok: true }> | null>(null);
  /** 모든 운영일이 성공한 요청 조건 (같은 조건은 다시 보내지 않는다) */
  const [doneKeys, setDoneKeys] = useState<ReadonlySet<string>>(() => new Set());
  /** 이 화면이 렌더링된 로그인 세션 (SessionGuard 제공). 슬롯 생성 요청에 함께 보낸다 */
  const renderedLoginSession = useRenderedLoginSession();
  /**
   * 다른 탭에서 계정이 바뀌어 서버가 만들지 않았을 때의 안내. 있으면 이 창에서는 다시 보내지 않는다
   * (입력·선택값은 그대로 두고, 장비·검사 유형을 바꿔도 안내와 잠금은 남는다)
   */
  const [sessionChangedMessage, setSessionChangedMessage] = useState<string | null>(null);

  const equipment = equipments.find((item) => item.id === equipmentId) ?? null;
  const { value: context, retry: reloadContext } = useDetailResult<SlotGenerationContextResult>(
    equipmentId || null,
    () => loadSlotGenerationContextAction(equipmentId),
    CONTEXT_NETWORK_FAILURE,
  );
  // 다른 장비의 결과가 남아 있으면 쓰지 않는다
  const loaded = context?.ok && context.equipment.id.toLowerCase() === equipmentId.toLowerCase() ? context : null;
  const contextError = context && !context.ok ? context : null;
  const links = loaded?.examTypes ?? [];
  const link = links.find((item) => item.examTypeId === examTypeId) ?? null;
  const hours = loaded?.hours ?? [];

  // 기간 계산 (화면 미리보기. 서버가 같은 함수로 다시 확인한다)
  const today = getSeoulNow().dateKey;
  const rangeError = startDate && endDate ? validateGenerationRange(startDate, endDate, today, API_SEARCH_MAX_LOOKAHEAD_DAYS) : null;
  const dates = startDate && endDate && !rangeError ? listRangeDates(startDate, endDate) : [];
  const { targets, skipped } = splitOperatingDates(dates, new Set(hours.map((day) => day.weekday)));

  const blockers: string[] = [];
  if (loaded) {
    if (loaded.equipment.status !== "OPERATIONAL") blockers.push("정상 상태인 장비에만 슬롯을 만들 수 있습니다.");
    if (links.length === 0) blockers.push("연결된 검사 유형이 없습니다. 장비 상세에서 지원 검사 유형을 먼저 추가해 주세요.");
    if (hours.length === 0) blockers.push("운영시간이 설정되지 않았습니다. [운영시간 수정]에서 먼저 설정해 주세요.");
    if (link && (link.durationMinutes === null || link.durationMinutes < 1)) blockers.push("이 검사 유형의 소요 시간이 설정되지 않았습니다.");
  }
  if (loaded && hours.length > 0 && dates.length > 0 && targets.length === 0) blockers.push("선택한 기간에 운영하는 날이 없습니다.");

  const requestKey = `${equipmentId}|${examTypeId}|${startDate}|${endDate}`.toLowerCase();
  const alreadyDone = doneKeys.has(requestKey);
  const canSubmit = Boolean(loaded && link && targets.length > 0) && blockers.length === 0 && !rangeError && !pending && !alreadyDone && !sessionChangedMessage;

  const changeEquipment = (next: string) => {
    setEquipmentId(next);
    setExamTypeId("");
    setError(null);
    setResult(null);
  };

  const submit = () => {
    if (lock.running || !canSubmit || sessionChangedMessage) return;
    const key = requestKey;
    void lock.run(async () => {
      setPending(true);
      setError(null);
      try {
        // 렌더링 시점 로그인 세션을 함께 보낸다 (다른 탭에서 계정이 바뀌었으면 서버가 만들지 않는다)
        const next = await generateSlotRangeAction({ equipmentId, examTypeId, startDate, endDate }, renderedLoginSession);
        if (!next.ok) {
          // 계정 변경: 목록·장비 정보를 다시 불러오지 않고 안내만 남긴다 (자동 재시도 없음)
          if (next.reason === "SESSION_CHANGED") {
            setSessionChangedMessage(next.message);
            return;
          }
          setError(next.message);
          if (next.reason === "NOT_FOUND") reloadContext();
          return;
        }
        setResult(next);
        const { summary } = next;
        if (summary.failed + summary.unknown + summary.notProcessed + summary.conflict === 0) setDoneKeys((prev) => new Set(prev).add(key));
      } catch {
        setError(NETWORK_FAILURE_MESSAGE);
      } finally {
        setPending(false);
      }
    });
  };

  const examTypeOptions = [
    { value: "", label: !equipmentId ? "장비를 먼저 선택해 주세요" : !loaded ? "불러오는 중" : links.length === 0 ? "연결된 검사 유형 없음" : "선택해 주세요" },
    ...links.map((item) => ({ value: item.examTypeId, label: item.examTypeName })),
  ];

  return (
    <Modal
      open
      size="form2"
      title="슬롯 생성"
      description="장비 운영 시간과 검사 소요 시간으로 기간 안의 운영일마다 슬롯을 만듭니다."
      closeOnBackdrop={false}
      onClose={() => !pending && onClose()}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {pending && (
            <p role="status" className="flex items-center gap-2 text-sm text-gray-500 sm:mr-auto">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              날짜별로 차례대로 만들고 있습니다.
            </p>
          )}
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
            {result ? "닫기" : "취소"}
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit} aria-busy={pending} className={primaryButtonClass}>
            {pending ? "슬롯 생성 중" : alreadyDone ? "생성 완료" : result ? "다시 생성" : "슬롯 생성"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 min-[860px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* 왼쪽: 장비·검사 정보 */}
          <section aria-labelledby="api-slot-generation-equipment-title" className="flex min-w-0 flex-col gap-4">
            <h3 id="api-slot-generation-equipment-title" className="text-sm font-bold text-gray-700">
              장비·검사 정보
            </h3>
            <SelectInput
              id="api-slot-generation-equipment"
              label="대상 장비"
              data-autofocus
              options={[{ value: "", label: "선택해 주세요" }, ...equipments.map((item) => ({ value: item.id, label: `${item.name} (${item.modality})` }))]}
              value={equipmentId}
              disabled={pending}
              onChange={(e) => changeEquipment(e.target.value)}
            />
            <SelectInput
              id="api-slot-generation-exam-type"
              label="검사 유형"
              options={examTypeOptions}
              value={examTypeId}
              disabled={pending || !loaded || links.length === 0}
              onChange={(e) => {
                setExamTypeId(e.target.value);
                setError(null);
              }}
            />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-surface-muted px-4 py-3 text-sm">
              <dt className="text-gray-500">장비 상태</dt>
              <dd className="font-semibold text-gray-900">{loaded ? STATUS_LABEL[loaded.equipment.status] : "-"}</dd>
              <dt className="text-gray-500">소요 시간</dt>
              <dd className="font-semibold text-gray-900">{link ? (link.durationMinutes ? `${link.durationMinutes}분` : "미설정") : "-"}</dd>
              <dt className="text-gray-500">운영시간</dt>
              <dd className="break-words font-semibold text-gray-900">{loaded ? (hours.length > 0 ? formatOperatingHoursSummary(hours) : "미설정") : "-"}</dd>
            </dl>
            {equipmentId && context === null && (
              <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                검사 유형과 운영시간을 불러오고 있습니다.
              </p>
            )}
            {contextError && (
              <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {contextError.message}
                {contextError.reason !== "FORBIDDEN" && (
                  <button type="button" onClick={reloadContext} className={secondaryButtonClass}>
                    다시 시도
                  </button>
                )}
              </div>
            )}
          </section>

          {/* 오른쪽: 생성 기간 */}
          <section aria-labelledby="api-slot-generation-range-title" className="flex min-w-0 flex-col gap-4">
            <h3 id="api-slot-generation-range-title" className="text-sm font-bold text-gray-700">
              생성 기간 <span className="font-normal text-gray-500">(시작·종료일 포함 최대 {MAX_GENERATION_DAYS}일)</span>
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DatePicker
                id="api-slot-generation-start"
                label="생성 시작일"
                value={startDate}
                floating
                disablePast
                placeholder="시작일 선택"
                onChange={(value) => {
                  setStartDate(value);
                  // 종료일이 없거나 시작일보다 앞이면 같은 날로 맞춘다 (하루 생성)
                  if (value && (!endDate || endDate < value)) setEndDate(value);
                  setError(null);
                }}
              />
              <DatePicker
                id="api-slot-generation-end"
                label="생성 종료일"
                value={endDate}
                floating
                disablePast
                placeholder="종료일 선택"
                getDisabledReason={(key) =>
                  startDate && key < startDate ? "시작일 이전" : startDate && key > addDays(startDate, MAX_GENERATION_DAYS - 1) ? `최대 ${MAX_GENERATION_DAYS}일 초과` : null
                }
                disabledNote={startDate ? `시작일부터 ${MAX_GENERATION_DAYS}일 안에서 고를 수 있습니다.` : undefined}
                onChange={(value) => {
                  setEndDate(value);
                  setError(null);
                }}
              />
            </div>
            {rangeError && (
              <p role="alert" className="text-sm text-red-600">
                {rangeError.message}
              </p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat label="선택 기간">{dates.length > 0 ? `${dates.length}일` : "-"}</Stat>
              <Stat label="생성 대상 운영일">{dates.length > 0 && loaded ? `${targets.length}일` : "-"}</Stat>
              <Stat label="휴무 제외">{dates.length > 0 && loaded ? `${skipped.length}일` : "-"}</Stat>
            </dl>
            <section aria-labelledby="api-slot-generation-summary-title" className="rounded-lg border border-line px-4 py-3">
              <h4 id="api-slot-generation-summary-title" className="text-sm font-bold text-gray-700">
                생성 전 확인
              </h4>
              <p className="mt-1 break-words text-[15px] text-gray-900">
                <strong className="font-semibold">{equipment?.name ?? "장비 미선택"}</strong>
                {" · "}
                {link?.examTypeName ?? "검사 유형 미선택"}
                {" · "}
                {startDate && endDate ? (startDate === endDate ? startDate : `${startDate} ~ ${endDate}`) : "기간 미선택"}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                운영일 {loaded && dates.length > 0 ? targets.length : "-"}일에 하루씩 요청 · 휴무 {loaded && dates.length > 0 ? skipped.length : "-"}일 제외
              </p>
              <p className="mt-1 text-xs text-gray-500">슬롯 개수는 서버가 그날 운영시간을 소요 시간 단위로 나눠 정합니다. 이미 슬롯이 있는 날은 만들지 않습니다.</p>
            </section>
          </section>
        </div>

        {blockers.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {blockers.map((message) => (
              <li key={message} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {message}
              </li>
            ))}
          </ul>
        )}

        {(sessionChangedMessage ?? error) && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>{sessionChangedMessage ?? error}</p>
          </div>
        )}

        {result && <GenerationResult result={result} />}

        {!result && (
          <p className="flex items-start gap-2 text-xs text-gray-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            사용자 지정 시간·휴게 시간 제외는 서버에서 지원하지 않습니다. 날짜마다 따로 만들어 일부 날짜만 성공할 수 있습니다.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 생성 결과: 집계 + 날짜별 상세(접기) */
function GenerationResult({ result }: { result: Extract<SlotRangeGenerationResult, { ok: true }> }) {
  const { summary } = result;
  const hasProblem = summary.failed + summary.unknown + summary.notProcessed > 0;
  return (
    <section
      aria-labelledby="api-slot-generation-result-title"
      className={`rounded-lg border px-4 py-3 ${hasProblem ? "border-amber-300 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60"}`}
    >
      <h3 id="api-slot-generation-result-title" role="status" className="text-[15px] font-bold text-gray-900">
        생성 결과: 성공 {summary.success}일 · 슬롯 {summary.createdSlots}개
      </h3>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
        <ResultCount label="중복">{summary.conflict}일</ResultCount>
        <ResultCount label="실패">{summary.failed}일</ResultCount>
        {summary.unknown > 0 && <ResultCount label="확인 필요">{summary.unknown}일</ResultCount>}
        {summary.notProcessed > 0 && <ResultCount label="미처리">{summary.notProcessed}일</ResultCount>}
        <ResultCount label="휴무 제외">{summary.skipped}일</ResultCount>
      </dl>
      {result.stoppedReason && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          오류로 남은 날짜는 요청하지 않았습니다: {result.stoppedReason}
        </p>
      )}
      {(summary.conflict > 0 || hasProblem) && (
        <p className="mt-1 text-xs text-gray-600">
          같은 조건으로 다시 생성하면 이미 슬롯이 있는 날짜는 서버가 확인해 건너뜁니다. 확인 필요 날짜는 먼저 [서버에서 확인]을 눌러 주세요.
        </p>
      )}
      <details className="group mt-2" open={hasProblem}>
        <summary className="inline-flex cursor-pointer items-center gap-1 rounded text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          날짜별 결과 ({result.days.length}일)
        </summary>
        <ul className="mt-2 flex max-h-56 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white">
          {result.days.map((day) => (
            <DayRow key={day.date} day={day} equipmentId={result.equipmentId} examTypeId={result.examTypeId} />
          ))}
        </ul>
      </details>
    </section>
  );
}

function DayRow({ day, equipmentId, examTypeId }: { day: GenerationDayResult; equipmentId: string; examTypeId: string }) {
  const meta = DAY_STATUS_META[day.status];
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const { value: lookup } = useDetailResult<GeneratedSlotsLookupResult>(
    lookupKey,
    () => loadGeneratedSlotsAction(equipmentId, examTypeId, day.date),
    { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다." },
  );
  const first = day.slots[0];
  const last = day.slots[day.slots.length - 1];
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-20 shrink-0 font-semibold tabular-nums text-gray-900">{dayLabel(day.date)}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
        <span className="min-w-0 flex-1 break-words text-gray-600">
          {day.status === "SUCCESS" && first && last ? `${timeOf(first.startAt)}~${timeOf(last.endAt)} · 슬롯 ${day.slots.length}개` : day.message}
        </span>
        {(day.status === "UNKNOWN" || day.status === "SUCCESS") && (
          <button
            type="button"
            onClick={() => setLookupKey(String(Date.now()))}
            className="shrink-0 rounded text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            서버에서 확인
          </button>
        )}
      </div>
      {lookupKey && (
        <p role="status" className="pl-[5.75rem] text-xs text-gray-600">
          {lookup === null
            ? "확인 중"
            : !lookup.ok
              ? lookup.message
              : lookup.slots.length > 0
                ? `서버 조회: 예약 가능 슬롯 ${lookup.slots.length}개 (${timeOf(lookup.slots[0].startAt)}~${timeOf(lookup.slots[lookup.slots.length - 1].endAt)})`
                : "서버 조회: 이 날짜·검사 유형의 예약 가능 슬롯이 없습니다."}
        </p>
      )}
    </li>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-muted px-2 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-base font-bold tabular-nums text-gray-900">{children}</dd>
    </div>
  );
}

function ResultCount({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
