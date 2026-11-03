import { AlertTriangle, ArrowLeft, ArrowRight, Info, Lock } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { controlClass, fieldLabelClass, SelectInput, TextInput } from "@/components/ui/FormControls";
import type { ExamType } from "@/features/slots/types";

import { canEditSupportedExamTypes, getCompatibleExamTypeOptions, getExamTypeOptions, splitByModality } from "../supportedExamTypes";
import {
  registerMockEquipmentWithOperatingHours,
  updateMockEquipment,
  updateMockOperatingHours,
  type EffectiveEquipment,
  type EquipmentEditLocks,
} from "../mockEquipmentStore";
import {
  EQUIPMENT_NAME_MAX_LENGTH,
  hasErrors,
  hasOpenDay,
  SLOT_MINUTES_MAX,
  SLOT_MINUTES_MIN,
  validateEquipmentInput,
  type EquipmentInput,
  type EquipmentInputErrors,
  type OperatingDayInput,
} from "../rules";

import { isOperatingDaysValid, OperatingHoursFields, toOperatingDayInputs } from "./OperatingHoursForm";

interface EquipmentFormProps {
  organizationId: string;
  /** 수정할 장비. 없으면 등록(2단계: 기본 정보 → 운영 시간) */
  equipment?: { id: string; name: string; examType: ExamType; slotMinutes: number; supportedExamTypeIds?: readonly string[] | null };
  /** 바꿀 수 없는 항목과 이유 (수정 시) */
  locks?: EquipmentEditLocks;
  /** 같은 기관의 다른 장비 이름 (중복 확인용) */
  otherNames: readonly string[];
  onCancel: () => void;
  /** 수정 저장 성공 시 안내 문구 */
  onSaved?: (message: string) => void;
  /** 등록: 장비와 운영 시간이 모두 저장됨 */
  onRegistered?: (equipment: EffectiveEquipment) => void;
  /** 등록: 장비만 저장되고 운영 시간은 저장하지 못함 (모달은 열린 채 다시 시도할 수 있다) */
  onPartiallyRegistered?: (equipment: EffectiveEquipment) => void;
}

const EXAM_TYPE_OPTIONS = [
  { value: "", label: "선택해 주세요" },
  { value: "CT", label: "CT" },
  { value: "MRI", label: "MRI" },
];

type Field = keyof EquipmentInput;
type Step = 1 | 2;

const primaryButtonClass =
  "inline-flex h-12 items-center justify-center gap-1.5 rounded-lg bg-primary px-6 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400";
const secondaryButtonClass =
  "inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 장비 등록·수정 폼 (⚠️ Mock: 이 브라우저에만 저장된다).
 * - 등록: 1단계 기본 정보 → 2단계 운영 시간(하루 이상 필수). 최종 등록 전까지 아무것도 저장하지 않으며,
 *   단계를 오가도 입력값은 유지된다. 모달을 닫으면 입력값은 버려진다.
 * - 수정: 기본 정보만 (운영 시간은 [운영 시간 수정]에서)
 * 장비 상태는 입력받지 않는다 (진행 중 장애 이력으로만 판단).
 */
export default function EquipmentForm({
  organizationId,
  equipment,
  locks,
  otherNames,
  onCancel,
  onSaved,
  onRegistered,
  onPartiallyRegistered,
}: EquipmentFormProps) {
  const isEdit = Boolean(equipment);
  const [step, setStep] = useState<Step>(1);
  const [input, setInput] = useState<EquipmentInput>({
    name: equipment?.name ?? "",
    examType: equipment?.examType ?? "",
    slotMinutes: equipment ? String(equipment.slotMinutes) : "30",
  });
  const [supportedIds, setSupportedIds] = useState<string[]>(() => [...(equipment?.supportedExamTypeIds ?? [])]);
  /** 장비 종류를 바꿔 해제한 지원 검사 유형 안내 */
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  const supportedEditable = canEditSupportedExamTypes();
  const [days, setDays] = useState<OperatingDayInput[]>(() => toOperatingDayInputs([]));
  const [touched, setTouched] = useState<ReadonlySet<Field>>(() => new Set());
  const [showHoursErrors, setShowHoursErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** 장비만 저장되고 운영 시간 저장에 실패한 경우의 장비 (운영 시간만 다시 저장한다) */
  const [partialEquipment, setPartialEquipment] = useState<EffectiveEquipment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const didMountRef = useRef(false);

  const errors: EquipmentInputErrors = validateEquipmentInput(input, otherNames);
  const isInfoValid = !hasErrors(errors);
  const isHoursValid = hasOpenDay(days) && isOperatingDaysValid(days);
  const visible = (field: Field) => (touched.has(field) ? errors[field] : undefined);
  const change = (patch: Partial<EquipmentInput>, field: Field) => {
    setInput((prev) => ({ ...prev, ...patch }));
    setTouched((prev) => new Set(prev).add(field));
  };
  /** 장비 종류 변경: 새 종류와 맞지 않는 지원 검사 유형은 해제하고 알린다 */
  const changeExamType = (examType: ExamType | "") => {
    change({ examType }, "examType");
    const { kept, removed } = splitByModality(supportedIds, examType);
    if (removed.length === 0) return;
    const names = new Map(getExamTypeOptions().map(({ id, name }) => [id, name]));
    setSupportedIds(kept);
    setRemovedNotice(`장비 종류가 바뀌어 지원 검사 유형 ${removed.map((id) => names.get(id) ?? id).join(", ")} 선택을 해제했습니다.`);
  };
  const toggleSupported = (id: string, checked: boolean) => {
    setRemovedNotice(null);
    setSupportedIds((prev) => (checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((value) => value !== id)));
  };
  /** 저장할 지원 검사 유형 (API 모드처럼 편집할 수 없으면 보내지 않는다) */
  const supportedToSave = supportedEditable ? supportedIds : undefined;

  // 단계를 옮기면 단계 제목으로 포커스를 옮겨 화면 읽기 프로그램이 바뀐 단계를 읽게 한다
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  const goNext = () => {
    setTouched(new Set<Field>(["name", "examType", "slotMinutes"]));
    if (!isInfoValid) return;
    setSubmitError(null);
    setStep(2);
  };

  const runSubmit = async (action: () => Promise<void>) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await action();
    } catch {
      setSubmitError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    submittingRef.current = false;
    setIsSubmitting(false);
  };

  /** 등록 최종 저장: 장비 등록 → 운영 시간 설정. 실패하면 어느 단계까지 저장됐는지 구분해 안내한다 */
  const register = () =>
    runSubmit(async () => {
      const result = await registerMockEquipmentWithOperatingHours(organizationId, input, days, supportedToSave);
      if (result.ok) {
        onRegistered?.(result.equipment);
        return;
      }
      if (result.savedStage === "EQUIPMENT_ONLY") {
        setPartialEquipment(result.equipment);
        onPartiallyRegistered?.(result.equipment);
      }
      setSubmitError(result.message);
    });

  /** 장비만 저장된 경우: 같은 장비에 운영 시간만 다시 저장한다 (장비를 다시 등록하지 않는다) */
  const retryHours = (target: EffectiveEquipment) =>
    runSubmit(async () => {
      const result = await updateMockOperatingHours(organizationId, target.id, days);
      if (result.ok) {
        onRegistered?.(target);
        return;
      }
      setSubmitError(result.message);
    });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!equipment) {
      if (step === 1) return goNext();
      setShowHoursErrors(true);
      if (!isHoursValid) return;
      return void (partialEquipment ? retryHours(partialEquipment) : register());
    }
    setTouched(new Set<Field>(["name", "examType", "slotMinutes"]));
    if (!isInfoValid) return;
    void runSubmit(async () => {
      const result = await updateMockEquipment(organizationId, equipment.id, input, supportedToSave);
      if (result.ok) {
        onSaved?.(`${input.name.trim()} 장비 정보를 수정했습니다.`);
        return;
      }
      setSubmitError(result.message);
    });
  };

  const nameError = visible("name");
  const typeError = visible("examType");
  const minutesError = visible("slotMinutes");
  const noOpenDay = showHoursErrors && !hasOpenDay(days);

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      {!isEdit && (
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
      )}

      {submitError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            {partialEquipment
              ? `${partialEquipment.name} 장비는 등록되었지만 운영 시간은 저장되지 않았습니다. (${submitError}) 운영 시간을 다시 저장하거나, 창을 닫은 뒤 장비 목록의 [운영시간 설정 필요]에서 설정해 주세요.`
              : submitError}
          </p>
        </div>
      )}

      {step === 1 ? (
        <fieldset disabled={isSubmitting} className="flex flex-col gap-5">
          {!isEdit && (
            <h3 ref={stepHeadingRef} tabIndex={-1} className="text-base font-bold text-gray-900 outline-none">
              1단계 · 장비 기본 정보
            </h3>
          )}
          <div>
            <TextInput
              id="equipment-form-name"
              label="장비명"
              data-autofocus
              required
              autoComplete="off"
              maxLength={EQUIPMENT_NAME_MAX_LENGTH}
              placeholder="예: CT 1호기"
              value={input.name}
              readOnly={Boolean(locks?.name)}
              onChange={(e) => change({ name: e.target.value }, "name")}
              onBlur={() => setTouched((prev) => new Set(prev).add("name"))}
              error={nameError}
            />
            {locks?.name && <LockNote>{locks.name}</LockNote>}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <SelectInput
                id="equipment-form-type"
                label="검사 유형"
                options={EXAM_TYPE_OPTIONS}
                value={input.examType}
                disabled={Boolean(locks?.examType)}
                aria-invalid={typeError ? true : undefined}
                aria-describedby={typeError ? "equipment-form-type-error" : undefined}
                onChange={(e) => changeExamType(e.target.value as ExamType | "")}
              />
              {typeError && (
                <p id="equipment-form-type-error" className="mt-1.5 text-sm text-red-600">
                  {typeError}
                </p>
              )}
              {locks?.examType && <LockNote>{locks.examType}</LockNote>}
            </div>

            <div>
              <label htmlFor="equipment-form-minutes" className={fieldLabelClass}>
                슬롯 소요 시간(분)
              </label>
              <input
                id="equipment-form-minutes"
                type="number"
                inputMode="numeric"
                min={SLOT_MINUTES_MIN}
                max={SLOT_MINUTES_MAX}
                step={1}
                value={input.slotMinutes}
                readOnly={Boolean(locks?.slotMinutes)}
                aria-invalid={minutesError ? true : undefined}
                aria-describedby={`equipment-form-minutes-hint${minutesError ? " equipment-form-minutes-error" : ""}`}
                onChange={(e) => change({ slotMinutes: e.target.value }, "slotMinutes")}
                className={`${controlClass} pr-4 read-only:bg-gray-50 read-only:text-gray-500 ${minutesError ? "border-red-500" : ""}`}
              />
              <p id="equipment-form-minutes-hint" className="mt-1.5 text-sm text-gray-500">
                {SLOT_MINUTES_MIN}~{SLOT_MINUTES_MAX}분 사이의 정수
              </p>
              {minutesError && (
                <p id="equipment-form-minutes-error" className="mt-1 text-sm text-red-600">
                  {minutesError}
                </p>
              )}
              {locks?.slotMinutes && <LockNote>{locks.slotMinutes}</LockNote>}
            </div>
          </div>

          <SupportedExamTypesField
            examType={input.examType}
            selected={supportedIds}
            editable={supportedEditable}
            removedNotice={removedNotice}
            onToggle={toggleSupported}
          />
        </fieldset>
      ) : (
        <div className="flex flex-col gap-3">
          <h3 ref={stepHeadingRef} tabIndex={-1} className="text-base font-bold text-gray-900 outline-none">
            2단계 · 운영 시간 설정
            <span className="ml-2 text-sm font-normal text-gray-500">
              {input.name.trim()} · {input.examType} · 슬롯 {input.slotMinutes}분
            </span>
          </h3>
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
          <OperatingHoursFields days={days} onChange={setDays} showErrors={showHoursErrors} disabled={isSubmitting} />
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <strong className="mr-1 font-semibold">[API 미연동]</strong>
          개발용 예시 동작입니다. 이 브라우저에만 저장되며 서버에는 저장되지 않습니다.
          {!isEdit &&
            " 마지막 [장비 등록]을 누르기 전에는 저장하지 않습니다. 장비 상태는 정상으로 시작하며, 장애 여부는 장애 이력으로만 판단합니다."}
        </p>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!isEdit && step === 2 && !partialEquipment ? (
          <button type="button" onClick={() => setStep(1)} disabled={isSubmitting} className={`${secondaryButtonClass} sm:mr-auto`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            이전
          </button>
        ) : null}
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={secondaryButtonClass}>
          {partialEquipment ? "닫기" : "취소"}
        </button>
        {isEdit ? (
          <button type="submit" disabled={isSubmitting || !isInfoValid} className={primaryButtonClass}>
            {isSubmitting ? "저장 중" : "수정 저장"}
          </button>
        ) : step === 1 ? (
          <button type="submit" disabled={isSubmitting || !isInfoValid} className={primaryButtonClass}>
            다음
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
            {isSubmitting ? "저장 중" : partialEquipment ? "운영 시간 다시 저장" : "장비 등록"}
          </button>
        )}
      </div>
    </form>
  );
}

/** 지원 검사 유형 다중 선택 (장비 종류와 같은 modality만, 선택하지 않으면 미설정) */
function SupportedExamTypesField({
  examType,
  selected,
  editable,
  removedNotice,
  onToggle,
}: {
  examType: ExamType | "";
  selected: readonly string[];
  editable: boolean;
  removedNotice: string | null;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const options = getCompatibleExamTypeOptions(examType);
  return (
    <fieldset aria-describedby="equipment-form-supported-hint">
      <legend className={fieldLabelClass}>
        지원 검사 유형 <span className="font-normal text-gray-500">(선택)</span>
      </legend>
      {!examType ? (
        <p className="text-sm text-gray-500">검사 유형(CT·MRI)을 먼저 선택하면 고를 수 있습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[15px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
                  checked ? "border-primary bg-primary-soft text-primary" : "border-line bg-white text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  name="supportedExamTypeIds"
                  value={option.id}
                  checked={checked}
                  disabled={!editable}
                  onChange={(e) => onToggle(option.id, e.target.checked)}
                  className="size-4 accent-primary"
                />
                {option.name}
              </label>
            );
          })}
        </div>
      )}
      <p id="equipment-form-supported-hint" className="mt-1.5 text-sm text-gray-500">
        {editable
          ? `${examType || "장비"} 장비에서 할 수 있는 검사를 고릅니다. 고르지 않으면 '미설정'으로 표시됩니다.`
          : "지원 검사 유형은 서버 저장 기능이 준비되지 않아 지금은 바꿀 수 없습니다 (저장되지 않습니다)."}
      </p>
      {removedNotice && (
        <p role="status" className="mt-1.5 text-sm text-amber-800">
          {removedNotice}
        </p>
      )}
    </fieldset>
  );
}

function LockNote({ children }: { children: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1 text-sm text-gray-500">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}
