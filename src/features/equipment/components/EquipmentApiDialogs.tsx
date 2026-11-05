"use client";

import { Loader2, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import Modal from "@/components/ui/Modal";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import {
  controlClass,
  emptyStateClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableClass,
  tdClass,
  theadClass,
  thClass,
  rowClass,
} from "@/components/ui/styles";
import { NETWORK_FAILURE, useDetailResult } from "@/features/admin/components/AdminDetailParts";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import type { ExamTypeDto } from "@/features/referrals/remote";

import {
  addEquipmentExamTypeAction,
  createEquipmentAction,
  loadEquipmentDetailAction,
  loadExamTypeOptionsAction,
  updateEquipmentAction,
  updateEquipmentExamTypeDurationAction,
  type EquipmentActionResult,
} from "../actions";
import {
  EQUIPMENT_MODALITIES,
  EQUIPMENT_NAME_MAX_LENGTH,
  parseDurationInput,
  validateDurationMinutes,
  validateEquipmentName,
  type EquipmentDto,
  type EquipmentModalityDto,
  type EquipmentStatusDto,
} from "../remote";
import type { EquipmentDetailResult, ExamTypeOptionsResult } from "../server";

/** 장비 상태 (EquipmentStatus. 상태 변경 API는 없다) */
export const STATUS: Record<EquipmentStatusDto, { label: string; tone: StatusTone }> = {
  OPERATIONAL: { label: "정상 운영", tone: "success" },
  MAINTENANCE: { label: "점검 중", tone: "warning" },
  FAILED: { label: "장애", tone: "danger" },
};
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

type FieldErrors = NonNullable<Extract<EquipmentActionResult, { ok: false }>["fieldErrors"]>;

/** 등록(장비명·종류)·수정(장비명만) 폼. 종류·상태는 수정 API가 없어 읽기 전용으로 보인다 */
export function EquipmentFormDialog({ equipment, onClose, onDone }: { equipment?: EquipmentDto; onClose: () => void; onDone: (result: EquipmentActionResult) => void }) {
  const mode = equipment ? "edit" : "create";
  const [name, setName] = useState(equipment?.name ?? "");
  const [modality, setModality] = useState<EquipmentModalityDto | "">("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const nextErrors: FieldErrors = {
      name: validateEquipmentName(name),
      ...(mode === "create" ? { modality: modality ? null : "장비 종류를 선택해 주세요." } : {}),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (Object.values(nextErrors).some(Boolean)) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const result = equipment ? await updateEquipmentAction(equipment.id, { name }) : await createEquipmentAction({ name, modality });
      if (result.ok || result.reason === "NOT_FOUND") return onDone(result);
      if (result.fieldErrors) setErrors(result.fieldErrors);
      setFormError(result.message);
    } catch {
      setFormError(NETWORK_ERROR_MESSAGE);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Modal open title={mode === "create" ? "장비 등록" : "장비 정보 수정"} onClose={() => !pending && onClose()} closeOnBackdrop={false}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="equipment-name" className="text-sm font-medium text-gray-700">
            장비명 <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="equipment-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={EQUIPMENT_NAME_MAX_LENGTH}
            autoComplete="off"
            data-autofocus
            required
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "equipment-name-error" : undefined}
            className={controlClass}
          />
          {errors.name && (
            <p id="equipment-name-error" className="text-sm text-red-600">
              {errors.name}
            </p>
          )}
        </div>
        {mode === "create" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="equipment-modality-input" className="text-sm font-medium text-gray-700">
              장비 종류 <span className="text-red-600" aria-hidden="true">*</span>
            </label>
            <select
              id="equipment-modality-input"
              value={modality}
              onChange={(event) => setModality(event.target.value as EquipmentModalityDto | "")}
              aria-invalid={errors.modality ? true : undefined}
              aria-describedby={errors.modality ? "equipment-modality-error" : undefined}
              className={controlClass}
            >
              <option value="">선택해 주세요</option>
              {EQUIPMENT_MODALITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {errors.modality && (
              <p id="equipment-modality-error" className="text-sm text-red-600">
                {errors.modality}
              </p>
            )}
            <p className="text-xs text-gray-500">등록한 뒤에는 장비 종류를 바꿀 수 없습니다. 새 장비는 정상 운영 상태로 등록됩니다.</p>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm">
            <div>
              <dt className="text-gray-500">장비 종류 (변경 불가)</dt>
              <dd className="mt-1 font-medium text-gray-900">{equipment!.modality}</dd>
            </div>
            <div>
              <dt className="text-gray-500">상태 (변경 불가)</dt>
              <dd className="mt-1">
                <StatusBadge tone={STATUS[equipment!.status].tone}>{STATUS[equipment!.status].label}</StatusBadge>
              </dd>
            </div>
          </dl>
        )}
        {formError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
            취소
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "처리 중…" : mode === "create" ? "등록" : "저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 소요 시간(분) 입력 칸. 값은 문자열로 두고 저장할 때 parseDurationInput + validateDurationMinutes로 검사한다 */
export function DurationInput({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${controlClass} h-10! w-24! text-right tabular-nums ${error ? "border-red-500!" : ""}`}
      />
      <span className="text-sm text-gray-600" aria-hidden="true">
        분
      </span>
    </span>
  );
}

/** 입력 문자열 → 검사 결과 (값 또는 오류 문구) */
export function readDuration(value: string): { value: number; error: null } | { value: null; error: string } {
  const parsed = parseDurationInput(value);
  const error = validateDurationMinutes(parsed);
  return error ? { value: null, error } : { value: parsed as number, error: null };
}

/**
 * 장비 상세 + 지원 검사 유형. 열 때 상세 Server Function을 한 번 부른다 (장비 확인 1 + 검사 유형 1).
 * 검사 유형 선택지는 '검사 유형 추가'를 누를 때만 불러온다 (검사 유형 목록 1). 같은 장비 종류만, 이미 연결된 유형은 뺀다.
 * - 추가: 검사 유형 + 이 장비에서의 소요 시간(분, 1 이상 정수) 모두 필수
 * - 소요 시간 수정: 행마다 [수정] → 입력 → [저장] (PATCH 1회). 성공·404·409 뒤에는 서버 목록을 다시 받는다
 * 검사 유형 자체를 새로 만들거나 연결을 끊는 기능은 두지 않는다 (API 없음).
 */
export function EquipmentDetailDialog({
  equipment,
  onClose,
  onEditInfo,
  onChanged,
}: {
  equipment: EquipmentDto;
  onClose: () => void;
  onEditInfo?: () => void;
  /** 지원 검사 유형이 바뀌었을 때 (목록 미리보기 다시 조회용) */
  onChanged?: () => void;
}) {
  const [options, setOptions] = useState<ExamTypeOptionsResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [examTypeId, setExamTypeId] = useState("");
  const [minutes, setMinutes] = useState("");
  const [addErrors, setAddErrors] = useState<{ examTypeId?: string | null; durationMinutes?: string | null }>({});
  const [addResult, setAddResult] = useState<EquipmentActionResult | null>(null);
  const [editing, setEditing] = useState<{ examTypeId: string; value: string; error: string | null } | null>(null);
  const [editResult, setEditResult] = useState<EquipmentActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  // 열 때 한 번 조회하고, 추가·수정 결과를 반영할 때 reload()로 다시 조회한다 (늦게 온 이전 응답은 버린다)
  const { value: detail, retry: reload } = useDetailResult<EquipmentDetailResult>(equipment.id, () => loadEquipmentDetailAction(equipment.id), NETWORK_FAILURE);

  const startAdding = async () => {
    setAdding(true);
    setAddResult(null);
    setEditing(null);
    if (options?.ok) return;
    setOptions(null);
    try {
      setOptions(await loadExamTypeOptionsAction(equipment.modality));
    } catch {
      setOptions({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE, code: null });
    }
  };

  /** 처리 중 표시 + 중복 요청 막기 */
  const guarded = async (task: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await task();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  /** 성공·중복(409)·없음(404)이면 서버 목록을 다시 받아 맞춘다 */
  const needsReload = (result: EquipmentActionResult) => result.ok || result.reason === "CONFLICT" || result.reason === "NOT_FOUND";

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const duration = readDuration(minutes);
    const errors = { examTypeId: examTypeId ? null : "검사 유형을 선택해 주세요.", durationMinutes: duration.error };
    setAddErrors(errors);
    setAddResult(null);
    if (errors.examTypeId || errors.durationMinutes) return;
    void guarded(async () => {
      try {
        const result = await addEquipmentExamTypeAction(equipment.id, { examTypeId, durationMinutes: duration.value });
        setAddResult(result);
        if (!result.ok && result.fieldErrors) setAddErrors(result.fieldErrors);
        if (needsReload(result)) {
          setExamTypeId("");
          setMinutes("");
          reload();
          onChanged?.();
        }
      } catch {
        setAddResult({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE });
      }
    });
  };

  const saveDuration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || pendingRef.current) return;
    const duration = readDuration(editing.value);
    if (duration.error) {
      setEditing({ ...editing, error: duration.error });
      return;
    }
    const target = editing;
    setEditResult(null);
    void guarded(async () => {
      try {
        const result = await updateEquipmentExamTypeDurationAction(equipment.id, target.examTypeId, duration.value);
        setEditResult(result);
        if (needsReload(result)) {
          setEditing(null);
          reload();
        } else if (!result.ok && result.reason === "INVALID") {
          setEditing({ ...target, error: result.message });
        }
      } catch {
        setEditResult({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE });
      }
    });
  };

  const current = detail?.ok ? detail.equipment : equipment;
  const linked = new Set(detail?.ok ? detail.examTypes.map((item) => item.examTypeId.toLowerCase()) : []);
  const available: ExamTypeDto[] = options?.ok ? options.examTypes.filter((item) => !linked.has(item.id.toLowerCase())) : [];

  return (
    <Modal open size="xl" title="장비 상세" description={`${current.name} · ${current.modality}`} onClose={() => !pending && onClose()} closeOnBackdrop={!pending}>
      <div className="flex flex-col gap-6">
        <dl className="relative grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-2">
          {onEditInfo && (
            <button type="button" onClick={onEditInfo} disabled={pending} className={`${secondaryButtonClass} h-9! sm:absolute sm:right-4 sm:top-4`}>
              정보 수정
            </button>
          )}
          <div>
            <dt className="text-gray-500">장비명</dt>
            <dd className="mt-1 font-semibold text-gray-900">{current.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500">장비 종류</dt>
            <dd className="mt-1 font-medium text-gray-900">{current.modality}</dd>
          </div>
          <div>
            <dt className="text-gray-500">상태</dt>
            <dd className="mt-1">
              <StatusBadge tone={STATUS[current.status].tone}>{STATUS[current.status].label}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">장비 ID</dt>
            <dd className="mt-1">
              <ReferralIdCopyButton referralId={current.id} label="장비 ID" />
            </dd>
          </div>
        </dl>

        <section aria-labelledby="equipment-exam-types-title" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="equipment-exam-types-title" className="text-base font-bold text-gray-900">
              지원 검사 유형
            </h3>
            {detail?.ok && !adding && (
              <button type="button" onClick={startAdding} className={secondaryButtonClass}>
                <Plus className="size-4" aria-hidden="true" />
                검사 유형 추가
              </button>
            )}
          </div>

          {detail === null ? (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-gray-500">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              지원 검사 유형을 불러오고 있습니다.
            </p>
          ) : !detail.ok ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {detail.message}
              {detail.reason !== "FORBIDDEN" && (
                <button type="button" onClick={reload} className={secondaryButtonClass}>
                  다시 시도
                </button>
              )}
            </div>
          ) : detail.examTypes.length === 0 ? (
            <div role="status" className={`${emptyStateClass} py-8!`}>
              연결된 검사 유형이 없습니다. 검사 유형을 추가해야 이 장비로 검사 슬롯을 운영할 수 있습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className={`${tableClass} min-w-[480px]`}>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>검사명</th>
                    <th scope="col" className={thClass}>종류</th>
                    <th scope="col" className={`${thClass} text-right!`}>소요 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.examTypes.map((item) => {
                    const isEditing = editing?.examTypeId === item.examTypeId;
                    const inputId = `equipment-duration-${item.examTypeId}`;
                    return (
                      <tr key={item.id} className={rowClass}>
                        <td className={`${tdClass} font-medium text-gray-900`}>{item.examTypeName}</td>
                        <td className={tdClass}>{item.modality}</td>
                        <td className={`${tdClass} text-right`}>
                          {isEditing ? (
                            <form onSubmit={saveDuration} noValidate className="flex flex-col items-end gap-1.5">
                              <div className="flex items-center justify-end gap-2">
                                <DurationInput
                                  id={inputId}
                                  label={`${item.examTypeName} 소요 시간(분)`}
                                  value={editing.value}
                                  onChange={(value) => setEditing({ ...editing, value, error: null })}
                                  error={editing.error}
                                  disabled={pending}
                                />
                                <button type="submit" disabled={pending} className={`${primaryButtonClass} h-9!`}>
                                  {pending ? "저장 중…" : "저장"}
                                </button>
                                <button type="button" onClick={() => setEditing(null)} disabled={pending} className={`${secondaryButtonClass} h-9!`}>
                                  취소
                                </button>
                              </div>
                              {editing.error && (
                                <p id={`${inputId}-error`} className="text-xs text-red-600">
                                  {editing.error}
                                </p>
                              )}
                            </form>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-3">
                              <span className={`tabular-nums ${item.durationMinutes === null ? "text-gray-400" : ""}`}>
                                {item.durationMinutes === null ? "미설정" : `${item.durationMinutes}분`}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAdding(false);
                                  setEditResult(null);
                                  setEditing({ examTypeId: item.examTypeId, value: item.durationMinutes === null ? "" : String(item.durationMinutes), error: null });
                                }}
                                disabled={pending}
                                aria-label={`${item.examTypeName} 소요 시간 수정`}
                                className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                              >
                                수정
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {editResult && (
            <p role={editResult.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${editResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              {editResult.message}
            </p>
          )}
          {detail?.ok && detail.examTypesTruncated && <p className="text-xs text-gray-500">연결된 검사 유형이 많아 처음 100개만 보여 줍니다.</p>}

          {adding && detail?.ok && (
            <form onSubmit={add} noValidate className="flex flex-col gap-3 rounded-lg border border-line p-4">
              {options === null ? (
                <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  검사 유형 목록을 불러오고 있습니다.
                </p>
              ) : !options.ok ? (
                <p role="alert" className="text-sm text-red-700">{options.message}</p>
              ) : options.examTypes.length === 0 ? (
                <p role="status" className="text-sm text-gray-600">
                  등록된 {equipment.modality} 검사 유형이 없습니다. 검사 유형은 운영사에서 등록한 뒤 연결할 수 있습니다.
                </p>
              ) : available.length === 0 ? (
                <p role="status" className="text-sm text-gray-600">{equipment.modality} 검사 유형이 모두 이 장비에 연결되어 있습니다.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor="equipment-exam-type" className="text-sm font-medium text-gray-700">
                      추가할 검사 유형 ({equipment.modality}) <span className="text-red-600" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="equipment-exam-type"
                      value={examTypeId}
                      onChange={(event) => {
                        setExamTypeId(event.target.value);
                        setAddErrors((prev) => ({ ...prev, examTypeId: null }));
                      }}
                      disabled={pending}
                      aria-invalid={addErrors.examTypeId ? true : undefined}
                      aria-describedby={addErrors.examTypeId ? "equipment-exam-type-error" : undefined}
                      className={controlClass}
                    >
                      <option value="">선택해 주세요</option>
                      {available.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    {addErrors.examTypeId && (
                      <p id="equipment-exam-type-error" className="text-sm text-red-600">
                        {addErrors.examTypeId}
                      </p>
                    )}
                    {options.truncated && <p className="text-xs text-gray-500">검사 유형이 많아 처음 100개 안에서만 고를 수 있습니다.</p>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="equipment-exam-type-minutes" className="text-sm font-medium text-gray-700">
                      소요 시간(분) <span className="text-red-600" aria-hidden="true">*</span>
                    </label>
                    <DurationInput
                      id="equipment-exam-type-minutes"
                      label="추가할 검사 유형의 소요 시간(분)"
                      value={minutes}
                      onChange={(value) => {
                        setMinutes(value);
                        setAddErrors((prev) => ({ ...prev, durationMinutes: null }));
                      }}
                      error={addErrors.durationMinutes}
                      disabled={pending}
                    />
                    {addErrors.durationMinutes && (
                      <p id="equipment-exam-type-minutes-error" className="text-sm text-red-600">
                        {addErrors.durationMinutes}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {addResult && (
                <p role={addResult.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${addResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
                  {addResult.message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} disabled={pending} className={secondaryButtonClass}>
                  닫기
                </button>
                {options?.ok && available.length > 0 && (
                  <button type="submit" disabled={pending} className={primaryButtonClass}>
                    {pending ? "추가 중…" : "추가"}
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </Modal>
  );
}
