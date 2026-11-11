import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import AppHeader from "@/components/layout/AppHeader";
import { ROUTES } from "@/constants/navigation";
import { loadPublicInstitutions } from "@/features/auth/signup";

import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "회원가입 | IT:DA",
};

/**
 * 회원가입 (로그인 화면과 같은 구성).
 * 가입 가능 기관을 요청 시점에 실제 API로 조회해(Suspense) 폼에 넘긴다.
 */
export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader subtitle="의료기관 검사 의뢰·예약 플랫폼" />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-16">
        <section className="w-full max-w-[652px] rounded-xl border border-line bg-white px-6 py-10 shadow-card sm:px-14 sm:py-14">
          <h1 className="text-center text-[28px] font-bold text-gray-900 sm:text-[34px]">회원가입</h1>
          <p className="mt-3 text-center text-base text-gray-600 sm:text-lg">소속 기관을 선택하고 계정을 만드세요.</p>

          <div className="mt-10">
            <Suspense fallback={<Notice>가입 가능한 기관 목록을 불러오고 있습니다.</Notice>}>
              <SignupFormWithInstitutions />
            </Suspense>
          </div>

          <p className="mt-8 border-t border-line pt-6 text-center text-[15px] text-gray-600">
            이미 계정이 있으신가요?{" "}
            <Link href={ROUTES.login} className="font-semibold text-primary underline-offset-4 hover:underline">
              로그인
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}

async function SignupFormWithInstitutions() {
  // 기관 목록은 바뀔 수 있어 빌드 시점이 아니라 요청 시점에 조회한다
  await connection();
  const result = await loadPublicInstitutions();

  if (!result.ok) {
    return (
      <Notice title="기관 목록을 불러오지 못했습니다." tone="error">
        {result.message}
        {/* 서버 컴포넌트를 다시 조회하도록 전체 페이지를 다시 연다 */}
        <a href={ROUTES.signup} className="mt-3 inline-flex font-semibold text-red-700 underline underline-offset-4">
          다시 시도
        </a>
      </Notice>
    );
  }
  if (result.institutions.length === 0) {
    return (
      <Notice title="현재 가입할 수 있는 기관이 없습니다.">
        기관 등록 상태는 ITDA 운영 관리자에게 문의해 주세요.
      </Notice>
    );
  }
  return <SignupForm institutions={result.institutions} />;
}

function Notice({ title, children, tone = "info" }: { title?: string; children: ReactNode; tone?: "info" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-col rounded-lg border px-5 py-5 text-[15px] ${
        tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-line bg-surface-muted text-gray-700"
      }`}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1 flex flex-col text-sm" : "flex flex-col"}>{children}</div>
    </div>
  );
}
