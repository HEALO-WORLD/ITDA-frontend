import Link from "next/link";
import type { ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";
import { getAuthState, toAuthorizationHeaders } from "@/lib/auth/session";

import { loadExaminationPage, parsePageParam } from "../server";
import ExaminationApiBoard from "./ExaminationApiBoard";

interface ExaminationApiSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 검사 목록 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 *
 * 접근 보호: 서버에서 확인한 EXAMINER만 Gateway를 호출한다.
 * 쿠키가 있다는 것만으로는 호출하지 않는다 (사용자 정보 API가 없어 지금은 항상 '권한 확인 불가'로 막힌다).
 * 기관 ID는 보내지 않는다: Gateway가 토큰에서 X-Institution-Id를 만든다.
 * 실패해도 Mock 데이터로 대체하지 않는다.
 */
export default async function ExaminationApiSection({ searchParams }: ExaminationApiSectionProps) {
  const auth = await getAuthState();

  if (auth.status === "signed-out") {
    return (
      <Notice title="로그인이 필요합니다." action={<LoginLink />}>
        검사 목록은 검사기관 계정으로 로그인한 뒤 확인할 수 있습니다.
      </Notice>
    );
  }
  if (auth.status === "unverified") {
    return (
      <Notice title="사용자 권한을 확인할 수 없어 검사 목록을 표시하지 않습니다." action={<LogoutButton />}>
        {auth.reason}
      </Notice>
    );
  }
  if (auth.role !== "EXAMINER") {
    return <Notice title="검사기관 담당자만 볼 수 있는 화면입니다.">현재 계정으로는 검사 목록을 조회할 수 없습니다.</Notice>;
  }

  const page = parsePageParam((await searchParams).page);
  const result = await loadExaminationPage(page, toAuthorizationHeaders(auth));

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
        {result.reason === "FORBIDDEN" && result.code === "ACCESS_DENIED" && (
          <span className="mt-1 block text-sm">
            Gateway 권한 정책에 검사 목록 조회(GET /api/v1/examinations) 규칙이 아직 반영되지 않았을 수 있습니다.
          </span>
        )}
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
