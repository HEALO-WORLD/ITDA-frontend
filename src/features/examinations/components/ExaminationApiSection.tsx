import Link from "next/link";
import type { ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";
import { getExaminationAuthorizationHeaders } from "@/lib/auth/session";

import { loadExaminationPage, parsePageParam } from "../server";
import ExaminationApiBoard from "./ExaminationApiBoard";

interface ExaminationApiSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 검사 목록 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 *
 * 접근 보호: 사용자 정보 API(users/me)가 없어 화면에서 역할을 확인하지 않는다 (getAuthState를 verified로 바꾸지 않는다).
 * 대신 검사 API 전용 인증 헤더로 토큰을 Gateway에 넘기고, Gateway가 EXAMINER만 허용·백엔드가 소속 기관 검사만 돌려준다.
 * 토큰 쿠키가 없으면 호출하지 않는다. 쿠키가 있다는 것만으로 권한이 있다고 보지 않는다 (401·403은 안내로 표시).
 * 기관 ID는 보내지 않는다: Gateway가 토큰에서 X-Institution-Id를 만든다.
 * 실패해도 Mock 데이터로 대체하지 않는다.
 */
export default async function ExaminationApiSection({ searchParams }: ExaminationApiSectionProps) {
  const authorization = await getExaminationAuthorizationHeaders();

  if (!authorization) {
    return (
      <Notice title="로그인이 필요합니다." action={<LoginLink />}>
        검사 목록은 검사기관 계정으로 로그인한 뒤 확인할 수 있습니다.
      </Notice>
    );
  }

  const page = parsePageParam((await searchParams).page);
  const result = await loadExaminationPage(page, authorization);

  if (!result.ok) {
    if (result.reason === "UNAUTHORIZED") {
      return (
        <Notice title="로그인 정보가 만료되었거나 올바르지 않습니다." action={<LogoutButton label="다시 로그인" />} tone="error">
          다시 로그인해 주세요.
        </Notice>
      );
    }
    return (
      <Notice title="검사 목록을 불러오지 못했습니다." tone="error">
        {result.message}
      </Notice>
    );
  }

  return (
    <ExaminationApiBoard
      examinations={result.examinations}
      totalElements={result.totalElements}
      page={result.page}
      totalPages={result.totalPages}
    />
  );
}

function Notice({
  title,
  children,
  action,
  tone = "info",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center ${
        tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-dashed border-line bg-white text-gray-600"
      }`}
    >
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="text-sm">{children}</p>
      {action}
    </div>
  );
}

const actionClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50";

function LoginLink() {
  return (
    <Link href={ROUTES.login} className={actionClass}>
      로그인
    </Link>
  );
}

/** 쿠키 삭제는 Route Handler에서만 가능하므로 폼 POST로 로그아웃한 뒤 로그인 화면으로 이동한다 */
function LogoutButton({ label = "로그아웃" }: { label?: string }) {
  return (
    <form action="/auth/logout" method="post">
      <button type="submit" className={actionClass}>
        {label}
      </button>
    </form>
  );
}
