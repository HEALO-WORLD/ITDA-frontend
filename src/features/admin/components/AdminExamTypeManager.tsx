"use client";

import { Plus } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { useRenderedLoginSession } from "@/features/auth/loginSessionContext";

import { createExamTypeAction, updateExamTypeAction } from "../actions";
import { EXAM_TYPE_MODALITIES, EXAM_TYPE_NAME_MAX_LENGTH, validateExamTypeName, type AdminExamTypeDto, type AdminExamTypeModality } from "../remote";
import { markAdminSessionChanged, useAdminSessionChanged } from "../sessionChangeLock";
import type { AdminActionResult } from "../types";

import { IdText } from "./AdminDataParts";

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

// 기관 관리(AdminInstitutionManager)와 같은 표·입력·버튼 모양
const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";
const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";
const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

type Dialog = { kind: "create" } | { kind: "edit"; examType: AdminExamTypeDto } | null;
type FieldErrors = NonNullable<Extract<AdminActionResult, { ok: false }>["fieldErrors"]>;

interface AdminExamTypeManagerProps {
  items: AdminExamTypeDto[];
  /** 현재 종류 탭 (등록 창의 기본 선택값) */
  modality: AdminExamTypeModality | null;
  emptyMessage: string;
  summary: ReactNode;
}

/**
 * 공통 검사 유형 목록 + 등록·이름 수정 (API 모드).
 * 결과는 Server Function의 refresh()로 다시 그린 서버 목록으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 * 종류 변경·삭제 API는 없어 두지 않는다. 소요 시간은 공통 검사 유형에 없다 (장비별 지원 검사 유형에서 정한다).
 */
export default function AdminExamTypeManager({ items, modality, emptyMessage, summary }: AdminExamTypeManagerProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);

  const finish = (result: AdminActionResult) => {
    setNotice(result);
    setDialog(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {summary}
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setDialog({ kind: "create" });
          }}
          className={primaryButton}
        >
          <Plus className="size-4" aria-hidden="true" />
          검사 유형 등록
        </button>
      </div>
      <p className="text-sm text-gray-500">검사 소요 시간은 검사기관이 장비마다 정합니다. 여기서는 검사명과 종류만 관리합니다.</p>

      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {notice.message}
        </p>
      )}

      {items.length === 0 ? (
        <div role="status" className="rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] text-gray-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>검사명</th>
                <th scope="col" className={thClass}>종류</th>
                <th scope="col" className={thClass}>검사 유형 ID</th>
                <th scope="col" className={`${thClass} text-center!`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
                  <td className={`${tdClass} font-medium text-gray-900`}>{item.name}</td>
                  <td className={tdClass}>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">{item.modality}</span>
                  </td>
                  <td className={tdClass}>
                    <IdText id={item.id} />
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setDialog({ kind: "edit", examType: item });
                      }}
                      aria-label={`${item.name} 이름 수정`}
                      aria-haspopup="dialog"
                      className={`${secondaryButton} h-9!`}
                    >
                      이름 수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && <ExamTypeFormDialog key={dialog.kind === "edit" ? dialog.examType.id : "create"} dialog={dialog} defaultModality={modality} onClose={() => setDialog(null)} onDone={finish} />}
    </div>
  );
}

/** 등록(검사명·종류)·이름 수정 폼. 수정 창에서 종류는 읽기 전용으로 보인다 (변경 API 없음) */
function ExamTypeFormDialog({
  dialog,
  defaultModality,
  onClose,
  onDone,
}: {
  dialog: Exclude<Dialog, null>;
  defaultModality: AdminExamTypeModality | null;
  onClose: () => void;
  onDone: (result: AdminActionResult) => void;
}) {
  const editing = dialog.kind === "edit" ? dialog.examType : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [modality, setModality] = useState<AdminExamTypeModality | "">(defaultModality ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  /** 렌더링 시점 로그인 세션 (요청에 함께 보낸다) · 다른 탭 계정 변경 잠금 (이 화면의 관리자 변경 요청 공통) */
  const renderedLoginSession = useRenderedLoginSession();
  const sessionChanged = useAdminSessionChanged();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || sessionChanged) return;
    const nextErrors: FieldErrors = {
      name: validateExamTypeName(name) ?? (editing && name.trim() === editing.name ? "바뀐 내용이 없습니다. 새 검사명을 입력해 주세요." : null),
      ...(editing ? {} : { modality: modality ? null : "검사 종류(CT·MRI)를 선택해 주세요." }),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (Object.values(nextErrors).some(Boolean)) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const result = editing
        ? await updateExamTypeAction(editing.id, { name }, renderedLoginSession)
        : await createExamTypeAction({ name, modality }, renderedLoginSession);
      // 성공·없음(404)·충돌(409)은 서버가 목록을 다시 그렸으므로 창을 닫고 목록 위에 알린다
      if (result.ok || result.reason === "NOT_FOUND" || result.reason === "CONFLICT") return onDone(result);
      if (result.reason === "SESSION_CHANGED") markAdminSessionChanged();
      if (result.fieldErrors) setErrors(result.fieldErrors);
      setFormError(result.message);
    } catch {
      setFormError(NETWORK_ERROR_MESSAGE);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const length = name.trim().length;

  return (
    <Modal open title={editing ? "검사 유형 이름 수정" : "검사 유형 등록"} onClose={() => !pending && onClose()} closeOnBackdrop={false}>
      <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="exam-type-name" className="text-sm font-medium text-gray-700">
            검사명 <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="exam-type-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((prev) => ({ ...prev, name: null }));
            }}
            maxLength={EXAM_TYPE_NAME_MAX_LENGTH + 10}
            autoComplete="off"
            data-autofocus
            required
            disabled={pending}
            placeholder="예: 흉부 CT"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={`exam-type-name-hint${errors.name ? " exam-type-name-error" : ""}`}
            className={controlClass}
          />
          <p id="exam-type-name-hint" className={`text-xs ${length > EXAM_TYPE_NAME_MAX_LENGTH ? "text-red-600" : "text-gray-500"}`}>
            공백이 아닌 {EXAM_TYPE_NAME_MAX_LENGTH}자 이하 · 현재 {length}자 (앞뒤 공백은 빼고 저장합니다)
          </p>
          {errors.name && (
            <p id="exam-type-name-error" className="text-sm text-red-600">
              {errors.name}
            </p>
          )}
        </div>

        {editing ? (
          <dl className="rounded-lg bg-gray-50 p-4 text-sm">
            <dt className="text-gray-500">검사 종류 (변경 불가)</dt>
            <dd className="mt-1 font-medium text-gray-900">{editing.modality}</dd>
          </dl>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="exam-type-modality" className="text-sm font-medium text-gray-700">
              검사 종류 <span className="text-red-600" aria-hidden="true">*</span>
            </label>
            <select
              id="exam-type-modality"
              value={modality}
              onChange={(event) => {
                setModality(event.target.value as AdminExamTypeModality | "");
                setErrors((prev) => ({ ...prev, modality: null }));
              }}
              disabled={pending}
              aria-invalid={errors.modality ? true : undefined}
              aria-describedby={errors.modality ? "exam-type-modality-error" : "exam-type-modality-hint"}
              className={controlClass}
            >
              <option value="">선택해 주세요</option>
              {EXAM_TYPE_MODALITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {errors.modality ? (
              <p id="exam-type-modality-error" className="text-sm text-red-600">
                {errors.modality}
              </p>
            ) : (
              <p id="exam-type-modality-hint" className="text-xs text-gray-500">
                등록한 뒤에는 종류를 바꿀 수 없습니다.
              </p>
            )}
          </div>
        )}

        {formError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>
            취소
          </button>
          <button type="submit" disabled={pending || sessionChanged} className={primaryButton}>
            {pending ? "처리 중…" : editing ? "저장" : "등록"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
