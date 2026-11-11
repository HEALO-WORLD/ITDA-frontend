"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ROUTES } from "@/constants/navigation";
import {
  LOGIN_ID_LENGTH,
  PASSWORD_LENGTH,
  SIGNUP_FIELD_ORDER,
  validateSignupForm,
  type SignupField,
  type SignupFieldErrors,
  type SignupFormValues,
} from "@/features/auth/signupRules";
import type { PublicInstitution, SignupFailureReason, SignupInstitutionType, SignupResult } from "@/features/auth/types";

interface SignupFormProps {
  /** 가입 가능 기관 (서버에서 실제 API로 조회한 값) */
  institutions: PublicInstitution[];
}

const INSTITUTION_GROUPS: { type: SignupInstitutionType; label: string }[] = [
  { type: "REQUESTER", label: "의료기관 (검사 의뢰)" },
  { type: "EXAM", label: "검사기관" },
];

const EMPTY_VALUES: SignupFormValues = { institutionId: "", loginId: "", password: "", passwordConfirm: "" };

/** Route Handler 응답이 약속한 형식인지 확인한다 (다른 응답이면 서버 오류로 본다) */
function isSignupResult(value: unknown): value is SignupResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  const result = value as Record<string, unknown>;
  return (
    (result.ok === true && typeof result.loginId === "string") ||
    (result.ok === false && typeof result.reason === "string" && typeof result.message === "string")
  );
}

const SERVER_ERROR_MESSAGE = "회원가입 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.";
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";

/** 서버 실패 중 특정 입력 칸의 문제인 경우 (그 칸에 오류를 표시하고 포커스를 옮긴다) */
const FIELD_BY_REASON: Partial<Record<SignupFailureReason, SignupField>> = {
  DUPLICATE_LOGIN_ID: "loginId",
  INSTITUTION_NOT_FOUND: "institutionId",
  INSTITUTION_NOT_ALLOWED: "institutionId",
};

const labelClass = "mb-2 text-[15px] font-bold text-gray-900";
const inputClass =
  "h-12 w-full rounded-lg border bg-white px-4 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * 회원가입 폼 (API 모드 전용).
 * Next 서버의 `POST /auth/signup`을 거쳐 백엔드에 가입한다. 비밀번호 확인 값은 서버로 보내지 않는다.
 * - 역할은 백엔드가 기관 유형으로 정하므로 고르지 않는다
 * - 입력값은 바꾸지(trim) 않고 그대로 보낸다
 * - 처리 중에는 다시 제출하지 않는다 (상태 갱신 전 연속 제출까지 ref로 막는다)
 * - 실패하면 기관·아이디는 남기고 비밀번호 두 칸은 비운다
 * - 성공하면 승인 대기 안내만 보여 준다 (자동 로그인·자동 이동 없음)
 */
export default function SignupForm({ institutions }: SignupFormProps) {
  const [values, setValues] = useState<SignupFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<SignupFieldErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedUpLoginId, setSignedUpLoginId] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const fieldRefs = useRef<Partial<Record<SignupField, HTMLInputElement | HTMLSelectElement | null>>>({});
  const doneRef = useRef<HTMLHeadingElement>(null);

  /** 서버 실패 후 포커스를 옮길 칸. 처리 중에는 fieldset이 비활성이라 다시 그려진 뒤에 옮긴다 */
  const pendingFocusRef = useRef<SignupField | null>(null);

  useEffect(() => {
    if (signedUpLoginId) doneRef.current?.focus();
  }, [signedUpLoginId]);

  useEffect(() => {
    if (isSubmitting || !pendingFocusRef.current) return;
    fieldRefs.current[pendingFocusRef.current]?.focus();
    pendingFocusRef.current = null;
  }, [isSubmitting, errors]);

  const resetSignupView = () => {
  setSignedUpLoginId(null);
  setValues(EMPTY_VALUES);
  setErrors({});
  setFormMessage(null);
  pendingFocusRef.current = null;
};

  const update = (field: SignupField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const focusFirstError = (nextErrors: SignupFieldErrors) => {
    const first = SIGNUP_FIELD_ORDER.find((field) => nextErrors[field]);
    if (first) fieldRefs.current[first]?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setFormMessage(null);

    const nextErrors = validateSignupForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(nextErrors);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    let result: SignupResult;
    try {
      const response = await fetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        // 비밀번호 확인 값은 보내지 않는다
        body: JSON.stringify({ loginId: values.loginId, password: values.password, institutionId: values.institutionId }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      result = isSignupResult(body) ? body : { ok: false, reason: "SERVER_ERROR", message: SERVER_ERROR_MESSAGE };
    } catch {
      // 브라우저에서 Next 서버로 요청하지 못한 경우 (오프라인 등)
      result = { ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE };
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }

    if (result.ok) {
      setSignedUpLoginId(result.loginId);
      setValues(EMPTY_VALUES);
      return;
    }
    setValues((prev) => ({ ...prev, password: "", passwordConfirm: "" }));
    const field = FIELD_BY_REASON[result.reason];
    if (field) {
      pendingFocusRef.current = field;
      setErrors({ [field]: result.message });
    } else {
      setFormMessage(result.message);
    }
  };

  if (signedUpLoginId) {
    return (
      <div role="status" className="flex flex-col gap-5">
        <div className="rounded-lg border border-line bg-surface-muted px-5 py-5 text-[15px] text-gray-800">
          <h2 ref={doneRef} tabIndex={-1} className="text-lg font-bold text-gray-900 outline-none">
            회원가입 요청이 완료되었습니다.
          </h2>
          <dl className="mt-3 flex gap-2">
            <dt className="text-gray-600">가입 아이디</dt>
            <dd className="break-all font-semibold">{signedUpLoginId}</dd>
          </dl>
          <p className="mt-3 text-gray-700">관리자 승인 후 로그인할 수 있습니다. 승인 전에는 로그인되지 않습니다.</p>
        </div>
        <Link
          href={ROUTES.login}
          onClick={resetSignupView}
          className="flex h-12 items-center justify-center rounded-lg bg-primary text-base font-bold text-white transition-colors hover:bg-primary-hover"
        >
          로그인 화면으로 이동
        </Link>
      </div>
    );
  }

  const describedBy = (field: SignupField, hintId?: string) =>
    [hintId, errors[field] ? `signup-${field}-error` : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} className="flex flex-col">
      <fieldset disabled={isSubmitting} className="flex flex-col">
        <label htmlFor="signup-institutionId" className={labelClass}>
          소속 기관
        </label>
        <div className="relative">
          <select
            id="signup-institutionId"
            ref={(el) => {
              fieldRefs.current.institutionId = el;
            }}
            value={values.institutionId}
            onChange={(e) => update("institutionId", e.target.value)}
            aria-invalid={Boolean(errors.institutionId)}
            aria-describedby={describedBy("institutionId", "signup-institutionId-hint")}
            className={`${inputClass} cursor-pointer appearance-none pr-11 ${errors.institutionId ? "border-red-500" : "border-line"}`}
          >
            <option value="">소속 기관을 선택하세요.</option>
            {INSTITUTION_GROUPS.map(({ type, label }) => {
              const items = institutions.filter((item) => item.type === type);
              if (items.length === 0) return null;
              return (
                <optgroup key={type} label={label}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-gray-500"
            aria-hidden="true"
          />
        </div>
        <p id="signup-institutionId-hint" className="mt-1.5 text-sm text-gray-500">
          선택한 기관의 유형(의료기관·검사기관)에 따라 사용자 역할이 정해집니다.
        </p>
        {errors.institutionId && (
          <p id="signup-institutionId-error" className="mt-1 text-sm text-red-600">
            {errors.institutionId}
          </p>
        )}

        <label htmlFor="signup-loginId" className={`${labelClass} mt-6`}>
          아이디
        </label>
        <input
          id="signup-loginId"
          ref={(el) => {
            fieldRefs.current.loginId = el;
          }}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="아이디를 입력하세요."
          value={values.loginId}
          onChange={(e) => update("loginId", e.target.value)}
          aria-invalid={Boolean(errors.loginId)}
          aria-describedby={describedBy("loginId", "signup-loginId-hint")}
          className={`${inputClass} ${errors.loginId ? "border-red-500" : "border-line"}`}
        />
        <p id="signup-loginId-hint" className="mt-1.5 text-sm text-gray-500">
          {LOGIN_ID_LENGTH.min}~{LOGIN_ID_LENGTH.max}자
        </p>
        {errors.loginId && (
          <p id="signup-loginId-error" className="mt-1 text-sm text-red-600">
            {errors.loginId}
          </p>
        )}

        <label htmlFor="signup-password" className={`${labelClass} mt-6`}>
          비밀번호
        </label>
        <input
          id="signup-password"
          ref={(el) => {
            fieldRefs.current.password = el;
          }}
          type="password"
          autoComplete="new-password"
          placeholder="비밀번호를 입력하세요."
          value={values.password}
          onChange={(e) => update("password", e.target.value)}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={describedBy("password", "signup-password-hint")}
          className={`${inputClass} ${errors.password ? "border-red-500" : "border-line"}`}
        />
        <p id="signup-password-hint" className="mt-1.5 text-sm text-gray-500">
          {PASSWORD_LENGTH.min}~{PASSWORD_LENGTH.max}자
        </p>
        {errors.password && (
          <p id="signup-password-error" className="mt-1 text-sm text-red-600">
            {errors.password}
          </p>
        )}

        <label htmlFor="signup-passwordConfirm" className={`${labelClass} mt-6`}>
          비밀번호 확인
        </label>
        <input
          id="signup-passwordConfirm"
          ref={(el) => {
            fieldRefs.current.passwordConfirm = el;
          }}
          type="password"
          autoComplete="new-password"
          placeholder="비밀번호를 한 번 더 입력하세요."
          value={values.passwordConfirm}
          onChange={(e) => update("passwordConfirm", e.target.value)}
          aria-invalid={Boolean(errors.passwordConfirm)}
          aria-describedby={describedBy("passwordConfirm")}
          className={`${inputClass} ${errors.passwordConfirm ? "border-red-500" : "border-line"}`}
        />
        {errors.passwordConfirm && (
          <p id="signup-passwordConfirm-error" className="mt-1.5 text-sm text-red-600">
            {errors.passwordConfirm}
          </p>
        )}
      </fieldset>

      {formMessage && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {formMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="mt-6 h-12 rounded-lg bg-primary text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "가입 요청 중" : "회원가입"}
      </button>
    </form>
  );
}
