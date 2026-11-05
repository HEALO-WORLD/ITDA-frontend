import { CircleAlert, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";

import type { PartnershipLoadFailure } from "../types";

const TITLES: Record<PartnershipLoadFailure["reason"], string> = {
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: "협약 정보를 볼 수 없는 계정입니다.",
  NOT_FOUND: "협약 정보를 찾을 수 없습니다.",
  NETWORK: "서버에 연결할 수 없습니다.",
  ERROR: "협약 목록을 불러오지 못했습니다.",
};

const actionClass =
  "mt-1 inline-flex h-9 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50";

/**
 * 협약 조회 실패 안내 (API 모드). 401은 토큰을 지워야 다시 로그인할 수 있으므로 로그아웃(폼 POST) 후 로그인 화면으로 보낸다.
 * Mock 데이터로 대신 보여 주지 않는다. 문구는 서버 오류 본문이 아니라 정해 둔 안내다.
 */
export default function PartnershipFailureNotice({ failure }: { failure: PartnershipLoadFailure }) {
  const isError = failure.reason !== "SIGNED_OUT" && failure.reason !== "FORBIDDEN";
  const action: ReactNode =
    failure.reason === "SIGNED_OUT" ? (
      <Link href={ROUTES.login} className={actionClass}>
        로그인
      </Link>
    ) : failure.reason === "UNAUTHORIZED" ? (
      <form action="/auth/logout" method="post">
        <button type="submit" className={actionClass}>
          다시 로그인
        </button>
      </form>
    ) : failure.reason === "FORBIDDEN" ? null : (
      <form method="get">
        <button type="submit" className={actionClass}>
          다시 시도
        </button>
      </form>
    );
  const message = failure.reason === "SIGNED_OUT" ? "기관 계정으로 로그인한 뒤 이용할 수 있습니다." : failure.reason === "UNAUTHORIZED" ? "다시 로그인해 주세요." : failure.message;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center ${
        isError ? "border-red-100 bg-red-50/70" : "border-dashed border-line-strong bg-white"
      }`}
    >
      {isError ? <CircleAlert className="size-6 text-red-500" aria-hidden="true" /> : <Info className="size-6 text-gray-400" aria-hidden="true" />}
      <p className="text-[15px] font-semibold text-gray-900">{TITLES[failure.reason]}</p>
      <p className="text-sm text-gray-600">{message}</p>
      {action}
    </div>
  );
}
