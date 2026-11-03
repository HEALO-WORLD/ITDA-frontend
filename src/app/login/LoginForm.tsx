"use client";

import { useRef, useState, type FormEvent } from "react";

import type { LoginResult } from "@/features/auth/types";
import { getApiMode } from "@/lib/api/config";
import { isDemoModeEnabled } from "@/lib/dev/demoMode";

interface LoginFormValues {
  loginId: string;
  password: string;
}

type LoginFormErrors = Partial<Record<keyof LoginFormValues, string>>;

/** 백엔드 회원가입 규칙(SignupRequest.loginId: 4~50자)에 맞춘 최대 길이. 로그인 API는 빈 값만 거부한다 */
const LOGIN_ID_MAX_LENGTH = 50;

function validate({ loginId, password }: LoginFormValues): LoginFormErrors {
  const errors: LoginFormErrors = {};
  const id = loginId.trim();
  if (!id) errors.loginId = "로그인 ID를 입력하세요.";
  else if (/\s/.test(id)) errors.loginId = "로그인 ID에는 공백을 넣을 수 없습니다.";
  else if (id.length > LOGIN_ID_MAX_LENGTH) errors.loginId = `로그인 ID는 ${LOGIN_ID_MAX_LENGTH}자 이하로 입력하세요.`;
  if (!password) errors.password = "비밀번호를 입력하세요.";
  return errors;
}

/** Route Handler 응답이 약속한 형식인지 확인한다 (다른 응답이면 서버 오류로 본다) */
function isLoginResult(value: unknown): value is LoginResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  const result = value as Record<string, unknown>;
  return result.ok === true || (result.ok === false && typeof result.message === "string");
}

const SERVER_ERROR_MESSAGE = "로그인 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.";

const inputClass =
  "h-12 w-full rounded-lg border bg-white px-4 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * 로그인 폼.
 * API 모드: Next 서버의 `POST /auth/login`을 거쳐 백엔드에 로그인하고, 토큰은 서버가 HttpOnly 쿠키에 저장한다
 * (이 컴포넌트는 토큰을 받지도 저장하지도 않는다).
 * Mock 모드: 요청을 보내지 않고 데모 체험 바로가기를 안내한다.
 */
export default function LoginForm() {
  const [values, setValues] = useState<LoginFormValues>({ loginId: "", password: "" });
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  /** 상태 갱신 전 연속 제출까지 막는다 (버튼 비활성화는 다음 렌더부터 적용된다) */
  const submittingRef = useRef(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setFormMessage(null);

    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    let isApiMode: boolean;
    try {
      isApiMode = getApiMode() === "api";
    } catch {
      setFormMessage("로그인 기능을 사용할 수 없는 환경입니다. (API 모드 설정 확인)");
      return;
    }
    if (!isApiMode) {
      setFormMessage(
        isDemoModeEnabled()
          ? "Mock 모드에서는 실제 로그인을 하지 않습니다. 아래 데모 체험 바로가기를 이용해 주세요."
          : "Mock 모드에서는 실제 로그인을 하지 않습니다. (데모 체험이 꺼져 있습니다)",
      );
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    let result: LoginResult;
    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ loginId: values.loginId.trim(), password: values.password }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      result = isLoginResult(body) ? body : { ok: false, reason: "SERVER_ERROR", message: SERVER_ERROR_MESSAGE };
    } catch {
      result = { ok: false, reason: "SERVER_ERROR", message: SERVER_ERROR_MESSAGE };
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }

    if (result.ok) {
      setIsLoggedIn(true);
      setValues({ loginId: "", password: "" });
      return;
    }
    setFormMessage(result.message);
    // 비밀번호가 틀렸으면 다시 입력하게 비운다
    if (result.reason === "INVALID_CREDENTIALS") setValues((prev) => ({ ...prev, password: "" }));
  };

  if (isLoggedIn) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-lg border border-line bg-surface-muted px-4 py-4 text-[15px] text-gray-800">
          <p className="font-semibold">로그인되었습니다.</p>
          {/* TODO(auth): users/me로 역할을 확인한 뒤 HOME_ROUTE_BY_ROLE로 이동한다 */}
          <p className="mt-1 text-sm text-gray-600">
            사용자 권한 확인 API가 아직 준비되지 않아 역할별 화면으로 이동하지 않습니다.
          </p>
        </div>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="h-12 w-full rounded-lg border border-line bg-white text-base font-bold text-gray-800 transition-colors hover:bg-gray-50"
          >
            로그아웃
          </button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col">
      <label htmlFor="loginId" className="mb-2 text-[15px] font-bold text-gray-900">
        로그인 ID
      </label>
      <input
        id="loginId"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="로그인 ID를 입력하세요."
        value={values.loginId}
        onChange={(e) => setValues((prev) => ({ ...prev, loginId: e.target.value }))}
        aria-invalid={Boolean(errors.loginId)}
        aria-describedby={errors.loginId ? "loginId-error" : undefined}
        className={`${inputClass} ${errors.loginId ? "border-red-500" : "border-line"}`}
      />
      {errors.loginId && (
        <p id="loginId-error" className="mt-1.5 text-sm text-red-600">
          {errors.loginId}
        </p>
      )}

      <label htmlFor="password" className="mb-2 mt-6 text-[15px] font-bold text-gray-900">
        비밀번호
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        placeholder="비밀번호를 입력하세요."
        value={values.password}
        onChange={(e) => setValues((prev) => ({ ...prev, password: e.target.value }))}
        aria-invalid={Boolean(errors.password)}
        aria-describedby={errors.password ? "password-error" : undefined}
        className={`${inputClass} ${errors.password ? "border-red-500" : "border-line"}`}
      />
      {errors.password && (
        <p id="password-error" className="mt-1.5 text-sm text-red-600">
          {errors.password}
        </p>
      )}

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
        {isSubmitting ? "로그인 중" : "로그인"}
      </button>
    </form>
  );
}
