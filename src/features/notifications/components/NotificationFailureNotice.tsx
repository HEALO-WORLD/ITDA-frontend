import Link from "next/link";
import type { ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";

import type { NotificationFailure } from "../types";

const TITLES: Record<NotificationFailure["reason"], string> = {
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: "알림을 확인할 수 없는 계정입니다.",
  NOT_FOUND: "알림을 찾을 수 없습니다.",
  NETWORK: "알림 서버에 연결할 수 없습니다.",
  ERROR: "알림을 불러오지 못했습니다.",
};

/**
 * 알림 API 조회 실패 안내 (API 모드, 의뢰기관·검사기관 공통).
 * 401은 토큰을 지워야 다시 로그인할 수 있으므로 로그아웃(폼 POST) 후 로그인 화면으로 보낸다.
 * Mock 데이터로 대신 보여 주지 않는다.
 */
export default function NotificationFailureNotice({ failure }: { failure: NotificationFailure }) {
  const isError = failure.reason === "NETWORK" || failure.reason === "ERROR" || failure.reason === "UNAUTHORIZED";
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
    ) : null;
  const message =
    failure.reason === "SIGNED_OUT"
      ? "알림은 의뢰기관·검사기관 계정으로 로그인한 뒤 확인할 수 있습니다."
      : failure.reason === "UNAUTHORIZED"
        ? "다시 로그인해 주세요."
        : failure.message;

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center ${
        isError ? "border-red-200 bg-red-50 text-red-700" : "border-dashed border-line bg-white text-gray-600"
      }`}
    >
      <p className="text-[15px] font-semibold">{TITLES[failure.reason]}</p>
      <p className="text-sm">{message}</p>
      {action}
    </div>
  );
}

const actionClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50";
