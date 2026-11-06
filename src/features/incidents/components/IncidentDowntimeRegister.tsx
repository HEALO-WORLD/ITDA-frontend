"use client";

import { AlertTriangle, CheckCircle2, Clock, Info, Plus, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { controlClass, fieldLabelClass, iconClass, SelectInput } from "@/components/ui/FormControls";
import Modal from "@/components/ui/Modal";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { getSeoulNow, type DateKey } from "@/lib/date/seoulDate";

import { checkRegisteredIncidentAction, registerEquipmentDowntimeAction } from "../downtimeActions";
import type { DowntimeActionResult } from "../downtimeServer";
import {
  DOWNTIME_REASON_MAX_LENGTH,
  downtimeReasonLength,
  hasDowntimeErrors,
  validateDowntimeForm,
  type DowntimeField,
  type DowntimeFormErrors,
  type DowntimeFormInput,
} from "../downtimeRules";
import { INCIDENT_POLL_INTERVAL_MS, INCIDENT_POLL_TIMEOUT_MS, startIncidentPoller, type IncidentCheckOutcome } from "../downtimeTracking";

export interface DowntimeEquipmentOption {
  id: string;
  name: string;
  modality: "CT" | "MRI";
}

type Failure = Extract<DowntimeActionResult, { ok: false }>;
type Success = Extract<DowntimeActionResult, { ok: true }>;
/** 장애 목록 반영 자동 확인 상태: 확인 중 · 반영됨 · 30초 안에 확인 못 함 · 확인 중단(권한·로그인) · 확인할 수 없음(응답 값 부족) */
type Tracking = "CHECKING" | "FOUND" | "TIMEOUT" | "STOPPED" | "MANUAL";
type Notice = { kind: "success"; result: Success; tracking: Tracking } | { kind: "warning"; message: string };

const NETWORK_FAILURE: Failure = {
  ok: false,
  reason: "NETWORK",
  message: "서버 응답을 받지 못했습니다. 이미 등록되었을 수 있으니 다시 등록하기 전에 장애 목록을 새로고침해 확인해 주세요.",
  uncertain: true,
};

/**
 * 장비 장애 등록 버튼 + 등록 대화상자 + 결과 안내 (API 모드, 기능 스위치가 켜졌을 때만 쓴다).
 * - 장비는 서버가 조회한 우리 기관 장비만 고를 수 있다 (목록 조회 실패면 버튼을 비활성으로 둔다)
 * - 요청은 Server Function 1회. 결과를 알 수 없으면 다시 보내지 않고 장애 목록 확인을 안내한다 (멱등 키가 없다)
 * - 등록 중 닫기: 대화상자는 닫을 수 있고 요청은 계속된다. 결과는 목록 위 안내로 보여 주고, 끝날 때까지 등록 버튼을 막는다
 * - 성공(201)은 '중단 등록'까지다. 장애 목록·예약·의뢰 후속 처리는 비동기라 바로 보이지 않을 수 있다
 */
export default function IncidentDowntimeRegister({ equipments }: { equipments: readonly DowntimeEquipmentOption[] | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const runningRef = useRef(false);
  const openRef = useRef(false);

  const setDialogOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
  };

  const submit = async (input: DowntimeFormInput) => {
    if (runningRef.current) return; // 연속 클릭·Enter 중복 제출 방지
    runningRef.current = true;
    setPending(true);
    setFailure(null);
    let result: DowntimeActionResult;
    try {
      result = await registerEquipmentDowntimeAction(input);
    } catch {
      result = NETWORK_FAILURE;
    } finally {
      runningRef.current = false;
      setPending(false);
    }
    if (result.ok) {
      setDialogOpen(false);
      setNotice({ kind: "success", result, tracking: result.match ? "CHECKING" : "MANUAL" });
      return;
    }
    if (!openRef.current) {
      // 등록 중 대화상자를 닫았다면 결과를 목록 위에 남긴다
      setNotice({ kind: "warning", message: result.uncertain ? result.message : `장애를 등록하지 못했습니다. ${result.message}` });
      return;
    }
    setFailure(result);
  };

  const close = () => {
    if (failure?.uncertain) setNotice({ kind: "warning", message: failure.message });
    setFailure(null);
    setDialogOpen(false);
  };

  // 등록 성공 뒤 장애 목록 반영 자동 확인: 2초마다 최대 30초. 한 번에 한 요청만, 안내를 닫거나 화면을 벗어나면 멈춘다.
  // 반영을 확인하면 보고 있던 목록(주소의 필터·페이지 그대로)을 한 번 다시 받는다. 등록 POST는 다시 보내지 않는다
  const successResult = notice?.kind === "success" ? notice.result : null;
  useEffect(() => {
    const match = successResult?.match;
    if (!successResult || !match) return;
    const update = (tracking: Tracking) =>
      setNotice((prev) => (prev?.kind === "success" && prev.result === successResult ? { ...prev, tracking } : prev));
    const poller = startIncidentPoller({
      check: async (): Promise<IncidentCheckOutcome> => {
        const result = await checkRegisteredIncidentAction(match);
        if (result.ok) return result.found ? "FOUND" : "NOT_YET";
        return result.reason === "ERROR" ? "RETRY" : "STOP";
      },
      onFound: () => {
        update("FOUND");
        router.refresh();
      },
      onTimeout: () => update("TIMEOUT"),
      onStop: () => update("STOPPED"),
    });
    return () => poller.cancel();
  }, [successResult, router]);

  const unavailable = equipments === null ? "장비 목록을 불러오지 못해 장애를 등록할 수 없습니다. 화면을 새로고침해 주세요." : equipments.length === 0 ? "등록된 장비가 없습니다." : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNotice(null);
          setFailure(null);
          setDialogOpen(true);
        }}
        disabled={pending || unavailable !== null}
        title={unavailable ?? (pending ? "장애 등록을 처리하고 있습니다." : undefined)}
        aria-haspopup="dialog"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
      >
        <Plus className="size-4" aria-hidden="true" />
        {pending && !open ? "등록 처리 중" : "장비 장애 등록"}
      </button>

      {notice && <DowntimeNotice notice={notice} onRefresh={() => router.refresh()} onDismiss={() => setNotice(null)} />}

      <Modal
        open={open}
        title="장비 장애 등록"
        description="장애 기간과 겹치는 예약 가능 슬롯은 사용 불가로 바뀌고, 영향받은 예약·의뢰는 순차적으로 후속 처리됩니다."
        size="form2"
        closeOnBackdrop={false}
        onClose={close}
        // 하단 버튼은 본문 스크롤 밖에 고정한다 (form 속성으로 아래 폼에 연결: Enter 제출·검증·중복 제출 방지 흐름은 그대로)
        footer={equipments && equipments.length > 0 ? <DowntimeRegisterActions pending={pending} failure={failure} onCancel={close} /> : undefined}
      >
        {equipments && equipments.length > 0 && <DowntimeRegisterForm equipments={equipments} pending={pending} failure={failure} onSubmit={submit} />}
      </Modal>
    </>
  );
}

function DowntimeNotice({ notice, onRefresh, onDismiss }: { notice: Notice; onRefresh: () => void; onDismiss: () => void }) {
  const success = notice.kind === "success";
  return (
    <div
      role={success ? "status" : "alert"}
      className={`flex w-full items-start justify-between gap-3 rounded-lg border px-4 py-3 text-[15px] ${
        success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-start gap-2">
        {success ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
        <div className="flex flex-col gap-1">
          <p>{success ? notice.result.message : notice.message}</p>
          {success && notice.result.affectedSlotCount > 0 && (
            <p className="text-sm">장애 기간과 겹치는 예약 가능 슬롯 {notice.result.affectedSlotCount}개를 사용 불가로 바꿨습니다.</p>
          )}
          {success && notice.result.conflictedSlotCount > 0 && (
            <p className="text-sm">
              예약이 잡혀 있는 슬롯 {notice.result.conflictedSlotCount}개는 그대로 두고, 관련 예약·의뢰는 후속 처리 대상으로 넘겼습니다.
            </p>
          )}
          {success ? (
            <TrackingMessage tracking={notice.tracking} />
          ) : (
            <p className="text-sm">장애 목록에 아직 보이지 않으면 잠시 후 [목록 새로고침]을 눌러 확인해 주세요.</p>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="mt-1 inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-current/20 bg-white px-3 text-sm font-semibold hover:bg-white/70"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            목록 새로고침
          </button>
        </div>
      </div>
      <button type="button" onClick={onDismiss} aria-label="안내 닫기" className="shrink-0 rounded p-1 hover:bg-black/5">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const TRACKING_MESSAGES: Record<Tracking, string> = {
  CHECKING: `장애 목록 반영을 확인하고 있습니다. (${INCIDENT_POLL_INTERVAL_MS / 1000}초마다, 최대 ${INCIDENT_POLL_TIMEOUT_MS / 1000}초)`,
  FOUND: "장애 목록에 반영되었습니다. 영향받은 의뢰의 후속 처리 현황은 [상세]에서 확인할 수 있습니다.",
  TIMEOUT: "아직 장애 목록에 반영되지 않았습니다. 후속 처리가 늦어지고 있을 수 있으니 잠시 후 [목록 새로고침]을 눌러 확인해 주세요.",
  STOPPED: "로그인 정보나 권한을 확인할 수 없어 반영 확인을 멈췄습니다. [목록 새로고침]으로 직접 확인해 주세요.",
  MANUAL: "장애 목록과 영향 의뢰는 후속 처리 뒤에 표시됩니다. 목록에 아직 보이지 않으면 잠시 후 [목록 새로고침]을 눌러 주세요.",
};

function TrackingMessage({ tracking }: { tracking: Tracking }) {
  return (
    <p className="flex items-center gap-1.5 text-sm" aria-live="polite">
      {tracking === "CHECKING" && <RefreshCw className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />}
      {TRACKING_MESSAGES[tracking]}
    </p>
  );
}

const FIELDS: readonly DowntimeField[] = ["equipmentId", "startedAt", "endedAt", "reason"];

/** 등록 폼 id (Modal footer의 제출 버튼이 form 속성으로 이 폼을 제출한다) */
export const DOWNTIME_FORM_ID = "downtime-register-form";

/**
 * 등록 대화상자 하단 버튼 줄 (Modal footer). 폼 밖에 있어 form 속성으로 제출한다.
 * 잠금 조건(요청 중·결과 불확실)은 폼과 같다
 */
export function DowntimeRegisterActions({ pending, failure, onCancel }: { pending: boolean; failure: Failure | null; onCancel: () => void }) {
  const locked = pending || Boolean(failure?.uncertain);
  return (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      {pending && <p className="text-center text-sm text-gray-500 sm:mr-auto sm:text-left">창을 닫아도 등록 요청은 계속 처리되며, 결과는 목록 위에 표시됩니다.</p>}
      <button type="button" onClick={onCancel} className={secondaryButtonClass}>
        {failure?.uncertain ? "닫기" : "취소"}
      </button>
      <button type="submit" form={DOWNTIME_FORM_ID} disabled={locked} className={primaryButtonClass}>
        {pending ? "등록 중" : failure?.uncertain ? "목록에서 확인 필요" : "장애 등록"}
      </button>
    </div>
  );
}

export function DowntimeRegisterForm({
  equipments,
  pending,
  failure,
  onSubmit,
}: {
  equipments: readonly DowntimeEquipmentOption[];
  pending: boolean;
  failure: Failure | null;
  onSubmit: (input: DowntimeFormInput) => void;
}) {
  // 시작 기본값은 대화상자를 연 시점의 한국 시각. 종료 예정은 직접 입력한다 (필수)
  const [initialNow] = useState(() => getSeoulNow());
  const [equipmentId, setEquipmentId] = useState("");
  const [startDate, setStartDate] = useState<DateKey | "">(initialNow.dateKey);
  const [startTime, setStartTime] = useState(initialNow.dateTime.slice(11, 16));
  const [endDate, setEndDate] = useState<DateKey | "">("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState<ReadonlySet<DowntimeField>>(() => new Set());

  // 시각은 입력 중인 값을 그대로 두고, 요청·검증에는 HH:mm으로 맞춘 값을 쓴다 (예: 930 → 09:30)
  const start = normalizeTimeInput(startTime);
  const end = normalizeTimeInput(endTime);
  const input: DowntimeFormInput = {
    equipmentId,
    startedAt: startDate && start ? `${startDate}T${start}` : "",
    endedAt: endDate && end ? `${endDate}T${end}` : "",
    reason,
  };
  // 현재 시각 조건(종료 > 현재)은 입력할 때마다 다시 확인한다
  const errors: DowntimeFormErrors = validateDowntimeForm(input, {
    equipmentIds: new Set(equipments.map(({ id }) => id.toLowerCase())),
    nowDateTime: getSeoulNow().dateTime,
  });
  // 시각 형식이 틀리면 날짜·구간 안내 대신 형식 안내를 보여 준다
  if (startTime.trim() && !start) errors.startedAt = TIME_FORMAT_ERROR;
  if (endTime.trim() && !end) errors.endedAt = TIME_FORMAT_ERROR;
  const locked = pending || Boolean(failure?.uncertain);
  const touch = (field: DowntimeField) => setTouched((prev) => new Set(prev).add(field));
  const errorOf = (field: DowntimeField) => (touched.has(field) ? errors[field] : undefined) ?? failure?.fieldErrors?.[field];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(new Set(FIELDS));
    if (locked || hasDowntimeErrors(errors)) return;
    onSubmit(input);
  };

  const options = [
    { value: "", label: "장비를 선택해 주세요" },
    ...[...equipments]
      .sort((a, b) => a.modality.localeCompare(b.modality) || a.name.localeCompare(b.name, "ko", { numeric: true }))
      .map(({ id, name, modality }) => ({ value: id, label: `${name} (${modality})` })),
  ];
  const equipmentError = errorOf("equipmentId");
  const startError = errorOf("startedAt");
  const endError = errorOf("endedAt");
  const reasonError = errorOf("reason");
  const reasonLength = downtimeReasonLength(reason);
  const showBanner = failure && !(failure.reason === "INVALID_INPUT" && failure.fieldErrors);

  return (
    <form id={DOWNTIME_FORM_ID} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      {showBanner && (
        <div role="alert" className={`mb-4 flex items-start gap-2 rounded-lg px-4 py-3 text-[15px] ${failure.uncertain ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700"}`}>
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{failure.message}</p>
        </div>
      )}

      <fieldset disabled={locked} className="min-w-0">
        <legend className="sr-only">장애 정보</legend>
        {/* 860px 이상: 왼쪽 장애 장비·사유(5) · 오른쪽 장애 시작·종료 예정 일시(7) / 좁은 화면: 1단 (장비 등록 모달과 같은 비율·간격) */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 min-[860px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <SelectInput
                id="downtime-equipment"
                label="장애 장비"
                data-autofocus
                options={options}
                value={equipmentId}
                aria-invalid={equipmentError ? true : undefined}
                aria-describedby={equipmentError ? "downtime-equipment-error" : undefined}
                onChange={(e) => {
                  setEquipmentId(e.target.value);
                  touch("equipmentId");
                }}
                onBlur={() => touch("equipmentId")}
              />
              {equipmentError && (
                <p id="downtime-equipment-error" className="mt-1.5 text-sm text-red-600">
                  {equipmentError}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="downtime-reason" className={fieldLabelClass}>
                장애 사유 <span className="text-red-600">*</span>
              </label>
              <textarea
                id="downtime-reason"
                rows={4}
                value={reason}
                placeholder="예: MRI 장비 냉각 시스템 오류"
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={`downtime-reason-count${reasonError ? " downtime-reason-error" : ""}`}
                onChange={(e) => {
                  setReason(e.target.value);
                  touch("reason");
                }}
                onBlur={() => touch("reason")}
                className={`w-full resize-y rounded-lg border bg-white px-4 py-3 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                  reasonError ? "border-red-500" : "border-line"
                }`}
              />
              <div className="mt-1.5 flex justify-between gap-3 text-sm">
                <p id="downtime-reason-error" className="text-red-600">
                  {reasonError}
                </p>
                <p id="downtime-reason-count" className={`shrink-0 tabular-nums ${reasonLength > DOWNTIME_REASON_MAX_LENGTH ? "text-red-600" : "text-gray-500"}`}>
                  {reasonLength} / {DOWNTIME_REASON_MAX_LENGTH}자
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <DateTimeField
              idPrefix="downtime-start"
              dateLabel="장애 시작 날짜"
              timeLabel="시작 시각"
              date={startDate}
              time={startTime}
              error={startError}
              hint="한국 시간 기준이며, 이미 발생한 장애는 지난 시각으로 입력할 수 있습니다."
              onDate={(value) => {
                setStartDate(value);
                // 날짜를 고른 것만으로는 시각 미입력 오류를 띄우지 않는다
                if (startTime.trim()) touch("startedAt");
              }}
              onTime={setStartTime}
              onTimeCommit={() => touch("startedAt")}
            />

            <DateTimeField
              idPrefix="downtime-end"
              dateLabel="장애 종료 예정 날짜"
              timeLabel="종료 예정 시각"
              date={endDate}
              time={endTime}
              error={endError}
              hint="장애 시작 이후이면서 현재 시각 이후여야 합니다."
              onDate={(value) => {
                setEndDate(value);
                if (endTime.trim()) touch("endedAt");
              }}
              onTime={setEndTime}
              onTimeCommit={() => touch("endedAt")}
            />
          </div>
        </div>
      </fieldset>

      <p className="mt-5 flex items-start gap-2 rounded-lg bg-surface-muted px-4 py-3 text-sm text-gray-600">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        등록하면 장비 상태를 직접 바꾸지 않고 중단 기간만 저장합니다. 예약 차단·의뢰 재조정·의뢰기관 알림은 서버가 순차적으로 처리하므로 바로 완료되지 않습니다.
      </p>
    </form>
  );
}

const TIME_FORMAT_ERROR = "시각은 00:00~23:59 사이의 24시간제(HH:mm)로 입력해 주세요.";

/**
 * 시각 입력값 → `HH:mm` (24시간제). 받을 수 있는 형태: `9:30`·`09:30`·`930`·`0930` (앞뒤 공백 무시).
 * 범위(00:00~23:59)를 벗어나거나 형태가 다르면 null (입력 중인 값은 화면에 그대로 둔다)
 */
export function normalizeTimeInput(raw: string): string | null {
  const value = raw.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(value) ?? /^(\d{1,2})(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** `HH:mm`을 분 단위로 옮긴다 (하루 안에서 순환: 23:59 + 1분 = 00:00) */
export function stepTime(value: string, minutes: number): string {
  const [hour, minute] = value.split(":").map(Number);
  const total = (((hour * 60 + minute + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 입력할 수 있는 글자만 남긴다 (숫자·콜론, 최대 5자) */
export const sanitizeTimeInput = (raw: string) => raw.replace(/[^\d:]/g, "").slice(0, 5);

/**
 * 24시간제 시각 입력 (브라우저 기본 시간 선택 팝업을 쓰지 않는다).
 * - 키보드로 직접 입력한다. 입력 중 값은 그대로 두고, 칸을 벗어날 때 `HH:mm`으로 맞춘다 (맞출 수 없으면 그대로 두고 오류를 보여 준다)
 * - ↑/↓: 1분, Shift+↑/↓: 10분 (값이 비었거나 형식이 틀리면 움직이지 않는다)
 * - 모양은 공통 입력칸(controlClass)과 같다 (높이·테두리·포커스)
 */
function TimeInput({
  id,
  value,
  invalid,
  describedBy,
  onChange,
  onCommit,
}: {
  id: string;
  value: string;
  invalid: boolean;
  describedBy: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="HH:mm"
        maxLength={5}
        value={value}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(sanitizeTimeInput(e.target.value))}
        onBlur={() => {
          const normalized = normalizeTimeInput(value);
          if (normalized && normalized !== value) onChange(normalized);
          onCommit();
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          const normalized = normalizeTimeInput(value);
          if (!normalized) return;
          e.preventDefault();
          onChange(stepTime(normalized, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)));
        }}
        className={`${controlClass} tabular-nums ${invalid ? "border-red-500" : ""}`}
      />
      <Clock className={iconClass} aria-hidden="true" />
    </div>
  );
}

function DateTimeField({
  idPrefix,
  dateLabel,
  timeLabel,
  date,
  time,
  error,
  hint,
  onDate,
  onTime,
  onTimeCommit,
}: {
  idPrefix: string;
  dateLabel: string;
  timeLabel: string;
  date: DateKey | "";
  time: string;
  error: string | undefined;
  hint: string;
  onDate: (value: DateKey | "") => void;
  onTime: (value: string) => void;
  onTimeCommit: () => void;
}) {
  const errorId = `${idPrefix}-error`;
  const hintId = `${idPrefix}-hint`;
  return (
    <div>
      {/* 넓은 화면은 날짜·시각을 나란히, 좁은 화면은 세로로. 두 칸 모두 controlClass 높이(h-12) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_168px]">
        <DatePicker id={`${idPrefix}-date`} label={dateLabel} value={date} onChange={onDate} placeholder="날짜 선택" />
        <div>
          <label htmlFor={`${idPrefix}-time`} className={fieldLabelClass}>
            {timeLabel}
          </label>
          <TimeInput
            id={`${idPrefix}-time`}
            value={time}
            invalid={Boolean(error)}
            describedBy={error ? `${hintId} ${errorId}` : hintId}
            onChange={onTime}
            onCommit={onTimeCommit}
          />
        </div>
      </div>
      <p id={hintId} className="mt-1.5 text-sm text-gray-500">
        {hint} 시각은 24시간제(예: 09:30, 14:00)로 입력하며, ↑·↓ 키로 1분씩 바꿀 수 있습니다.
      </p>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
