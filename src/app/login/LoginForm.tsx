"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { notifySessionChanged } from "@/features/auth/authChannel";
import type { LoginResult } from "@/features/auth/types";

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
  const isRouteOrNull = (v: unknown) => v === null || (typeof v === "string" && v.startsWith("/") && !v.startsWith("//"));
  return (
    (result.ok === true && isRouteOrNull(result.redirectTo) && (result.message === null || typeof result.message === "string")) ||
    (result.ok === false && typeof result.message === "string")
  );
}

const SERVER_ERROR_MESSAGE = "로그인 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.";

const inputClass =
  "h-12 w-full rounded-lg border bg-white px-4 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * 로그인 폼.
 * API 모드: Next 서버의 `POST /auth/login`을 거쳐 백엔드에 로그인하고, 토큰은 서버가 HttpOnly 쿠키에 저장한다
 * (이 컴포넌트는 토큰을 받지도 저장하지도 않는다). 서버가 사용자 정보로 확인한 역할별 화면(redirectTo)으로 이동하고,
 * 화면이 없는 역할(ADMIN)은 안내만 한다.
 */
export default function LoginForm() {
  const [values, setValues] = useState<LoginFormValues>({ loginId: "", password: "" });
  const [errors, setErrors] = useState<LoginFormErrors>({});
  /** 로그인 API 요청 중 */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * 로그인 성공 후 화면 이동 중. 이동이 끝나면 React가 풀어 준다.
   * cacheComponents에서는 이 화면이 언마운트되지 않고 숨겨져 상태가 남으므로, 이동 중 표시를 useState로 고정하지 않는다
   */
  const [isNavigating, startNavigation] = useTransition();
  const isPending = isSubmitting || isNavigating;
  const [formMessage, setFormMessage] = useState<string | null>(null);
  /** 로그인됐지만 이동할 화면이 없는 경우(ADMIN)의 안내 */
  const [loggedInNotice, setLoggedInNotice] = useState<string | null>(null);
  const router = useRouter();
  /** 상태 갱신 전 연속 제출까지 막는다 (버튼 비활성화는 다음 렌더부터 적용된다) */
  const submittingRef = useRef(false);

  // 로그인 화면에 들어오면(로그아웃 뒤 포함) 다른 탭의 보호 화면이 로그인 상태를 다시 확인하게 알린다 (신호만, 계정 정보 없음)
  useEffect(() => {
    notifySessionChanged();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isNavigating) return;
    setFormMessage(null);

    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

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
      setValues({ loginId: "", password: "" });
      if (result.redirectTo) {
        const redirectTo = result.redirectTo;
        // 다른 탭에 계정이 바뀌었을 수 있음을 알린다 (그 탭들이 /auth/session으로 직접 확인한다)
        notifySessionChanged();
        // 이동 중에는 isNavigating으로 다시 제출하지 못하게 막는다
        startNavigation(() => {
          router.replace(redirectTo);
        });
        return;
      }
      setLoggedInNotice(result.message ?? "로그인했습니다. 이동할 화면이 없습니다.");
      return;
    }
    setFormMessage(result.message);
    // 비밀번호가 틀렸으면 다시 입력하게 비운다
    if (result.reason === "INVALID_CREDENTIALS") setValues((prev) => ({ ...prev, password: "" }));
  };

  if (loggedInNotice) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-lg border border-line bg-surface-muted px-4 py-4 text-[15px] text-gray-800">
          <p className="font-semibold">로그인되었습니다.</p>
          <p className="mt-1 text-sm text-gray-600">{loggedInNotice}</p>
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
        disabled={isPending}
        aria-busy={isPending}
        className="mt-6 h-12 rounded-lg bg-primary text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "로그인 중" : "로그인"}
      </button>
    </form>
  );
}
