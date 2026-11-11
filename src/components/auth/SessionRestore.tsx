"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ROUTES } from "@/constants/navigation";
import { getSessionRestorer, type RestoreReason, type SessionRestoreOutcome } from "@/features/auth/sessionRestore";

/**
 * 로그인 상태 자동 복구 화면 (API 모드 보호 화면, ApiRoleGate가 현재 주소 그대로 보여 준다).
 *
 * Access Token이 없거나 만료됐고 Refresh 쿠키가 있을 때: `POST /auth/reissue`(한 번) → 성공하면 router.refresh()로
 * 서버가 인증을 다시 확인해 원래 화면을 그린다. 주소를 바꾸지 않으므로 복귀 경로 파라미터가 없다 (외부 이동 불가).
 * - 재로그인이 필요한 결과(Refresh 없음·만료·재사용) → /login?reason=expired
 * - 네트워크·시간 초과·5xx → 자동으로 다시 보내지 않고 안내 + [다시 시도]
 * - 복구했는데도 이 화면이 그대로면(인증 재확인 실패) 반복하지 않고 안내한다
 *   (onRefreshed가 있으면 SessionGuard 안: 게이트가 확인을 통과해 감싼 화면이 다시 그려졌다는 뜻이므로 원래 화면으로 돌린다)
 * - reason: 복구를 시작한 이유 (게이트: Access 없음/401, SessionGuard: Access 없음). 다른 탭이 이미 복구해 재발급을 건너뛰면
 *   문서 전체를 다시 불러온다 (다른 탭이 바꾼 쿠키로 화면·클라이언트 상태를 새로 시작한다)
 * 일반 API·POST 요청은 다시 실행하지 않는다 (화면만 다시 그린다).
 */

type Phase =
  | { kind: "restoring" }
  /** 재발급 성공 → 화면 다시 확인 중 (끝났는데 이 화면이 남아 있으면 인증 재확인 실패) */
  | { kind: "refreshing" }
  | { kind: "error"; message: string; canRetry: boolean };

const STUCK_MESSAGE = "로그인 상태를 복구하지 못했습니다. 다시 시도하거나 다시 로그인해 주세요.";

const buttonClass =
  "inline-flex h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-[15px] font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400";

export default function SessionRestore({ reason, onRefreshed }: { reason: RestoreReason; onRefreshed?: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "restoring" });
  const [isRefreshing, startRefresh] = useTransition();

  const handle = (outcome: SessionRestoreOutcome) => {
    if (outcome.ok && "reusedFromOtherTab" in outcome) {
      // 이 탭은 재발급하지 않았다: 다른 탭의 복구 결과로 문서를 새로 불러온다
      window.location.reload();
      return;
    }
    if (outcome.ok) {
      setPhase({ kind: "refreshing" });
      startRefresh(() => router.refresh());
      return;
    }
    if (outcome.reloginRequired) {
      router.replace(`${ROUTES.login}?reason=expired`);
      return;
    }
    setPhase({ kind: "error", message: outcome.message, canRetry: outcome.retryable });
  };

  useEffect(() => {
    let active = true;
    const started = getSessionRestorer().startAuto(reason);
    if (!started) {
      // 최근에 자동 복구를 이미 했다: 반복하지 않는다 (렌더 뒤 비동기로 바꿔 effect 안의 동기 setState를 피한다)
      void Promise.resolve().then(() => active && setPhase({ kind: "error", message: STUCK_MESSAGE, canRetry: true }));
    } else {
      void started.then((outcome) => active && handle(outcome));
    }
    return () => {
      active = false;
    };
    // 마운트할 때 한 번만 자동으로 시도한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setPhase({ kind: "restoring" });
    void getSessionRestorer().restore(reason).then(handle);
  };

  const refreshed = phase.kind === "refreshing" && !isRefreshing;
  useEffect(() => {
    if (refreshed) onRefreshed?.();
  }, [refreshed, onRefreshed]);

  // 재발급 후 화면을 다시 확인했는데도 이 화면이 남아 있다 → 인증 재확인 실패 (자동 반복 없음)
  const view: Phase = refreshed && !onRefreshed ? { kind: "error", message: STUCK_MESSAGE, canRetry: true } : phase;

  if (view.kind !== "error") {
    return (
      <p role="status" className="text-[15px] text-gray-500">
        로그인 상태를 확인하고 있습니다.
      </p>
    );
  }
  return (
    <section role="alert" className="flex w-full max-w-[560px] flex-col items-center gap-3 rounded-xl border border-line bg-white px-8 py-10 text-center">
      <h1 className="text-xl font-bold text-gray-900">로그인 상태를 확인하지 못했습니다.</h1>
      <p className="text-[15px] text-gray-600">{view.message}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {view.canRetry && (
          <button type="button" onClick={retry} className={buttonClass}>
            다시 시도
          </button>
        )}
        <form action="/auth/logout" method="post">
          <button type="submit" className={buttonClass}>
            다시 로그인
          </button>
        </form>
      </div>
    </section>
  );
}
