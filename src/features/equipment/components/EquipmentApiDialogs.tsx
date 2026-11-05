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
  type EquipmentActionResult,
} from "../actions";
import { EQUIPMENT_MODALITIES, EQUIPMENT_NAME_MAX_LENGTH, validateEquipmentName, type EquipmentDto, type EquipmentModalityDto, type EquipmentStatusDto } from "../remote";
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

/**
 * 장비 상세 + 지원 검사 유형. 열 때 상세 Server Function을 한 번 부른다 (장비 확인 1 + 검사 유형 1).
 * 검사 유형 선택지는 '검사 유형 추가'를 누를 때만 불러온다 (검사 유형 목록 1). 같은 장비 종류만, 이미 연결된 유형은 뺀다.
 * 검사 유형 자체를 새로 만드는 기능은 두지 않는다 (정책 미확정).
 */
export function EquipmentDetailDialog({ equipment, onClose, onEditInfo }: { equipment: EquipmentDto; onClose: () => void; onEditInfo?: () => void }) {
  const [options, setOptions] = useState<ExamTypeOptionsResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [examTypeId, setExamTypeId] = useState("");
  const [addResult, setAddResult] = useState<EquipmentActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  // 열 때 한 번 조회하고, 추가 결과를 반영할 때 reload()로 다시 조회한다 (늦게 온 이전 응답은 버린다)
  const { value: detail, retry: reload } = useDetailResult<EquipmentDetailResult>(equipment.id, () => loadEquipmentDetailAction(equipment.id), NETWORK_FAILURE);

  const startAdding = async () => {
    setAdding(true);
    setAddResult(null);
    if (options?.ok) return;
    setOptions(null);
    try {
      setOptions(await loadExamTypeOptionsAction(equipment.modality));
    } catch {
      setOptions({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE, code: null });
    }
  };

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    if (!examTypeId) {
      setAddResult({ ok: false, reason: "INVALID", message: "검사 유형을 선택해 주세요." });
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setAddResult(null);
    try {
      const result = await addEquipmentExamTypeAction(equipment.id, examTypeId);
      setAddResult(result);
      // 성공·중복(409)·없음(404)이면 서버 목록을 다시 받아 맞춘다
      if (result.ok || result.reason === "CONFLICT" || result.reason === "NOT_FOUND") {
        setExamTypeId("");
        reload();
      }
    } catch {
      setAddResult({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
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
                  {detail.examTypes.map((item) => (
                    <tr key={item.id} className={rowClass}>
                      <td className={`${tdClass} font-medium text-gray-900`}>{item.examTypeName}</td>
                      <td className={tdClass}>{item.modality}</td>
                      <td className={`${tdClass} text-right tabular-nums`}>{item.durationMinutes}분</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="equipment-exam-type" className="text-sm font-medium text-gray-700">
                    추가할 검사 유형 ({equipment.modality})
                  </label>
                  <select id="equipment-exam-type" value={examTypeId} onChange={(event) => setExamTypeId(event.target.value)} disabled={pending} className={controlClass}>
                    <option value="">선택해 주세요</option>
                    {available.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.durationMinutes}분)
                      </option>
                    ))}
                  </select>
                  {options.truncated && <p className="text-xs text-gray-500">검사 유형이 많아 처음 100개 안에서만 고를 수 있습니다.</p>}
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
