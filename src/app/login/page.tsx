import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import AppHeader from "@/components/layout/AppHeader";
import { ROUTES } from "@/constants/navigation";

import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "의료기관 로그인 | IT:DA",
};

/** 보호 화면에서 로그인 만료(401)로 돌아온 경우 안내 (`?reason=expired`, 주소 값은 문구 선택에만 쓴다) */
async function ExpiredNotice({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  if ((await searchParams).reason !== "expired") return null;
  return (
    <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-center text-[15px] text-red-700">
      로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.
    </p>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader subtitle="의료기관 검사 의뢰·예약 플랫폼" />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-16">
        <section className="w-full max-w-[652px] rounded-xl border border-line bg-white px-6 py-10 shadow-card sm:px-14 sm:py-14">
          <h1 className="text-center text-[28px] font-bold text-gray-900 sm:text-[34px]">의료기관 로그인</h1>
          <p className="mt-3 text-center text-base text-gray-600 sm:text-lg">
            등록된 기관 계정으로 로그인하세요.
          </p>

          <Suspense fallback={null}>
            <ExpiredNotice searchParams={searchParams} />
          </Suspense>
          <div className="mt-10">
            <LoginForm />
          </div>

          <p className="mt-8 border-t border-line pt-6 text-center text-[15px] text-gray-600">
            의뢰기관 · 검사기관 공통 로그인
          </p>
          <p className="mt-3 text-center text-[15px] text-gray-600">
            계정이 없으신가요?{" "}
            <Link href={ROUTES.signup} className="font-semibold text-primary underline-offset-4 hover:underline">
              회원가입
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
