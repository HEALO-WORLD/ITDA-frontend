"use client";

import { ChevronDown, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { controlClass as fieldControlClass, iconClass } from "@/components/ui/FormControls";
import Modal from "@/components/ui/Modal";
import { searchButtonClass } from "@/components/ui/styles";
import { useRenderedLoginSession } from "@/features/auth/loginSessionContext";
import { formatDateTime } from "@/lib/format/date";

import { createInstitutionAction, deleteInstitutionAction, updateInstitutionAction } from "../actions";
import {
  INSTITUTION_ADDRESS_MAX_LENGTH,
  INSTITUTION_NAME_MAX_LENGTH,
  validateCareInstitutionCode,
  validateInstitutionAddress,
  validateInstitutionName,
  type InstitutionDto,
  type InstitutionTypeDto,
} from "../remote";
import { markAdminSessionChanged, useAdminSessionChanged } from "../sessionChangeLock";
import type { AdminActionResult } from "../types";

interface AdminInstitutionManagerProps {
  institutions: InstitutionDto[];
}

export const INSTITUTION_TYPE_LABELS: Record<InstitutionTypeDto, string> = { REQUESTER: "의뢰기관", EXAM: "검사기관", PLATFORM: "운영사" };
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

// 의뢰·예약 목록(Mock 와이어프레임)과 같은 표·입력 모양
const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";
const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";
const secondaryButton = "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

type Dialog = { kind: "create" } | { kind: "edit"; institution: InstitutionDto } | { kind: "delete"; institution: InstitutionDto } | null;

/**
 * 기관 관리 (API 모드). 목록·등록·수정(이름·주소)·삭제. 유형 필터·이름 검색은 받은 목록 안에서만 한다 (백엔드에 검색 조건이 없다).
 * 처리 결과는 Server Function의 refresh()로 다시 그린 서버 목록으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 * 백엔드에 없는 활성·비활성 전환과 기관 승인 기능은 두지 않는다.
 */
export default function AdminInstitutionManager({ institutions }: AdminInstitutionManagerProps) {
  const [typeFilter, setTypeFilter] = useState<InstitutionTypeDto | "">("");
  const [keyword, setKeyword] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);

  const filtered = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    return institutions.filter((item) => (!typeFilter || item.type === typeFilter) && (!value || item.name.toLowerCase().includes(value)));
  }, [institutions, typeFilter, keyword]);

  const finish = (result: AdminActionResult) => {
    setNotice(result);
    setDialog(null);
  };

  return (
    // 관리자 의뢰 관리(/admin/referrals)와 같은 흰 카드 하나에 검색·등록 버튼·건수·표를 담는다 (그림자 없음)
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-white px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="search" aria-label="기관 검색" className="flex flex-col gap-2 sm:flex-row sm:items-center md:flex-1">
          <div className="relative w-full sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="기관명 검색"
              aria-label="기관명 검색 (받은 목록 안에서 찾습니다)"
              className={`${fieldControlClass} pl-11 pr-4 placeholder:text-gray-400`}
            />
          </div>
          <div className="relative w-full sm:w-[180px]">
            <select
              aria-label="기관 유형"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as InstitutionTypeDto | "")}
              className={fieldControlClass}
            >
              <option value="">전체 유형</option>
              {(Object.keys(INSTITUTION_TYPE_LABELS) as InstitutionTypeDto[]).map((type) => (
                <option key={type} value={type}>
                  {INSTITUTION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <ChevronDown className={iconClass} aria-hidden="true" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setDialog({ kind: "create" });
          }}
          className={`${searchButtonClass} w-full sm:w-auto`}
        >
          <Plus className="size-5" aria-hidden="true" />
          기관 등록
        </button>
      </div>

      <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
        총 <span className="font-bold text-primary">{filtered.length}</span>개 기관
        {filtered.length !== institutions.length && <span className="text-gray-500"> (전체 {institutions.length}개 중)</span>}
      </p>

      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {notice.message}
        </p>
      )}

      {filtered.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-line-strong px-6 py-14 text-center text-[15px] text-gray-500">
          {institutions.length === 0 ? "등록된 기관이 없습니다." : "검색 조건에 맞는 기관이 없습니다."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[960px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>기관명</th>
                <th scope="col" className={thClass}>기관 유형</th>
                <th scope="col" className={thClass}>요양기관기호</th>
                <th scope="col" className={thClass}>주소</th>
                <th scope="col" className={`${thClass} text-center!`}>활성 상태</th>
                <th scope="col" className={`${thClass} text-center!`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
                  <td className={tdClass}>
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    <p className="mt-0.5 text-xs text-gray-400">등록 {item.createdAt ? formatDateTime(item.createdAt) : "—"}</p>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>{INSTITUTION_TYPE_LABELS[item.type]}</td>
                  <td className={`${tdClass} whitespace-nowrap font-mono text-[13px]`}>{item.careInstitutionCode ?? "—"}</td>
                  <td className={tdClass}>{item.address || "—"}</td>
                  <td className={`${tdClass} text-center`}>
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ring-1 ring-inset ring-black/5 ${
                        item.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {item.active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <div className="flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          setDialog({ kind: "edit", institution: item });
                        }}
                        aria-label={`${item.name} 수정`}
                        className="inline-flex h-9 items-center rounded-lg border border-primary/40 bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          setDialog({ kind: "delete", institution: item });
                        }}
                        aria-label={`${item.name} 삭제`}
                        className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "create" && <InstitutionFormDialog mode="create" onClose={() => setDialog(null)} onDone={finish} />}
      {dialog?.kind === "edit" && <InstitutionFormDialog mode="edit" institution={dialog.institution} onClose={() => setDialog(null)} onDone={finish} />}
      {dialog?.kind === "delete" && <InstitutionDeleteDialog institution={dialog.institution} onClose={() => setDialog(null)} onDone={finish} />}
    </div>
  );
}

type FieldErrors = NonNullable<Extract<AdminActionResult, { ok: false }>["fieldErrors"]>;

/** 등록·수정 폼. 수정은 이름·주소만 바꿀 수 있다 (유형·요양기관기호는 읽기 전용으로 보인다) */
function InstitutionFormDialog({
  mode,
  institution,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  institution?: InstitutionDto;
  onClose: () => void;
  onDone: (result: AdminActionResult) => void;
}) {
  const [values, setValues] = useState({
    name: institution?.name ?? "",
    type: "" as "" | "REQUESTER" | "EXAM",
    address: institution?.address ?? "",
    careInstitutionCode: "",
  });
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
      name: validateInstitutionName(values.name),
      address: validateInstitutionAddress(values.address),
      ...(mode === "create"
        ? { type: values.type ? null : "기관 유형을 선택해 주세요.", careInstitutionCode: validateCareInstitutionCode(values.careInstitutionCode) }
        : {}),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (Object.values(nextErrors).some(Boolean)) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const result =
        mode === "create"
          ? await createInstitutionAction(values, renderedLoginSession)
          : await updateInstitutionAction(institution!.id, { name: values.name, address: values.address }, renderedLoginSession);
      if (result.ok || result.reason === "NOT_FOUND") return onDone(result);
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

  const field = (key: "name" | "address" | "careInstitutionCode", label: string, props: Record<string, unknown>) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`institution-${key}`} className="text-sm font-medium text-gray-700">
        {label} <span className="text-red-600" aria-hidden="true">*</span>
      </label>
      <input
        id={`institution-${key}`}
        value={values[key]}
        onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `institution-${key}-error` : undefined}
        required
        className={controlClass}
        {...props}
      />
      {errors[key] && (
        <p id={`institution-${key}-error`} className="text-sm text-red-600">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <Modal open title={mode === "create" ? "기관 등록" : "기관 정보 수정"} onClose={() => !pending && onClose()} closeOnBackdrop={false}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {field("name", "기관명", { maxLength: INSTITUTION_NAME_MAX_LENGTH, "data-autofocus": true, autoComplete: "off" })}
        {mode === "create" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="institution-type" className="text-sm font-medium text-gray-700">
              기관 유형 <span className="text-red-600" aria-hidden="true">*</span>
            </label>
            <select
              id="institution-type"
              value={values.type}
              onChange={(event) => setValues((prev) => ({ ...prev, type: event.target.value as "" | "REQUESTER" | "EXAM" }))}
              aria-invalid={errors.type ? true : undefined}
              className={controlClass}
            >
              <option value="">선택해 주세요</option>
              <option value="REQUESTER">의뢰기관</option>
              <option value="EXAM">검사기관</option>
            </select>
            {errors.type && <p className="text-sm text-red-600">{errors.type}</p>}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm">
            <div>
              <dt className="text-gray-500">기관 유형 (변경 불가)</dt>
              <dd className="mt-1 font-medium text-gray-900">{INSTITUTION_TYPE_LABELS[institution!.type]}</dd>
            </div>
            <div>
              <dt className="text-gray-500">요양기관기호 (변경 불가)</dt>
              <dd className="mt-1 font-mono text-gray-900">{institution!.careInstitutionCode ?? "—"}</dd>
            </div>
          </dl>
        )}
        {field("address", "주소", { maxLength: INSTITUTION_ADDRESS_MAX_LENGTH, autoComplete: "off" })}
        {mode === "create" &&
          field("careInstitutionCode", "요양기관기호 (숫자 8자리)", { inputMode: "numeric", maxLength: 8, autoComplete: "off", pattern: "\\d{8}" })}
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
            {pending ? "처리 중…" : mode === "create" ? "등록" : "저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 삭제 확인. 진행 중 협약·소속 사용자 등으로 삭제할 수 없으면 서버가 알려 준 이유(정해 둔 문구)를 보여 준다 */
function InstitutionDeleteDialog({
  institution,
  onClose,
  onDone,
}: {
  institution: InstitutionDto;
  onClose: () => void;
  onDone: (result: AdminActionResult) => void;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  /** 렌더링 시점 로그인 세션 (요청에 함께 보낸다) · 다른 탭 계정 변경 잠금 (이 화면의 관리자 변경 요청 공통) */
  const renderedLoginSession = useRenderedLoginSession();
  const sessionChanged = useAdminSessionChanged();

  const remove = async () => {
    if (pendingRef.current || sessionChanged) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await deleteInstitutionAction(institution.id, renderedLoginSession);
      if (result.ok || result.reason === "NOT_FOUND") return onDone(result);
      if (result.reason === "SESSION_CHANGED") markAdminSessionChanged();
      setError(result.message);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Modal open title="기관 삭제" onClose={() => !pending && onClose()} closeOnBackdrop={!pending}>
      <div className="flex flex-col gap-5">
        <p className="text-[15px] text-gray-700">
          <strong className="font-semibold text-gray-900">{institution.name}</strong>({INSTITUTION_TYPE_LABELS[institution.type]})을(를) 삭제할까요?
          진행 중인 협약이나 소속 사용자가 있으면 삭제할 수 없습니다.
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>
            취소
          </button>
          <button
            type="button"
            data-autofocus
            onClick={remove}
            disabled={pending || sessionChanged}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
