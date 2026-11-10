"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { onSessionChanged } from "@/features/auth/authChannel";
import { LoginSessionContext } from "@/features/auth/loginSessionContext";

import SessionRestore from "./SessionRestore";

/**
 * 보호 화면 안에서 이동할 때의 세션 확인 (API 모드, ApiRoleGate가 확인을 통과한 화면을 감싼다).
 *
 * 같은 영역 안의 링크 이동은 레이아웃(ApiRoleGate)을 다시 그리지 않아, Access 쿠키가 만료돼도 게이트가 복구하지 못한다.
 * 그래서 주소가 바뀔 때마다 `GET /auth/session`(쿠키 존재만, 백엔드 요청 없음)을 확인하고,
 * Access 쿠키가 없고 Refresh 쿠키가 있으면 복구 화면(SessionRestore)을 보여 준다 → 재발급 후 화면을 다시 그리면 원래 화면으로 돌아온다.
 *
 * 다른 탭에서 계정이 바뀌거나 로그아웃했으면 문서를 다시 불러온다: 로그인 세션 구분 값이 게이트 렌더링 때와 다르거나,
 * 쿠키가 모두 없어졌을 때(signed-out. 구분 값 쿠키가 없던 STEP 3-2 이전 세션의 로그아웃도 여기서 감지한다).
 * 헤더(레이아웃)는 이전 사용자인데 본문은 새 쿠키로 그려지는 불일치를 막고, 이전 계정의 클라이언트 상태·숨겨 둔 화면(Activity)도 지운다.
 * router.refresh()는 서버 부분만 다시 그려 클라이언트 상태가 남으므로 쓰지 않는다. 로그아웃 상태면 다시 불러온 게이트가 로그인 화면으로 보낸다.
 * 확인 시점: 화면 이동 뒤(기존 확인과 같은 요청) + 다른 탭의 로그인·로그아웃 신호(BroadcastChannel) + 탭·창으로 돌아왔을 때(focus·visibilitychange).
 * 확인 요청이 진행 중이면 겹친 이벤트는 그 결과를 함께 쓴다 (시간으로 건너뛰지 않으므로 확인 직후 바뀐 계정도 다음 이벤트에서 감지한다).
 * 토큰 재발급(회전)은 로그인 세션 구분 값을 바꾸지 않으므로 다시 불러오지 않는다. 일반 API·POST 요청은 다시 실행하지 않는다.
 * 렌더링 시점 구분 값은 LoginSessionContext로 하위 화면에 제공한다 (변경 요청이 서버에 함께 보낸다).
 */
export default function SessionGuard({ children, loginSession }: { children: ReactNode; loginSession: string | null }) {
  const pathname = usePathname();
  /** 복구 화면을 보여 주는 주소 (주소가 바뀌면 자동으로 원래 화면으로) */
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  /** 처음 마운트는 게이트가 방금 서버에서 확인했으므로 건너뛴다 */
  const checkedPathRef = useRef(pathname);
  /** 다시 불러오기를 한 번만 (확인 응답이 여러 번 와도) */
  const reloadingRef = useRef(false);
  /** 진행 중인 `/auth/session` 확인 (끝나면 비운다) */
  const inFlightRef = useRef<Promise<{ status?: unknown; loginSession?: unknown } | null> | null>(null);

  useEffect(() => {
    let active = true;
    const readSession = () => {
      inFlightRef.current ??= fetch("/auth/session", { cache: "no-store", headers: { Accept: "application/json" } })
        .then((response) => response.json())
        .then((body: unknown) => (typeof body === "object" && body !== null ? (body as { status?: unknown; loginSession?: unknown }) : null))
        // 확인하지 못하면 기존 화면 그대로 둔다 (각 화면의 인증 안내가 그대로 보인다)
        .catch(() => null)
        .finally(() => {
          inFlightRef.current = null;
        });
      return inFlightRef.current;
    };
    /** restorePath: 화면 이동 뒤 확인일 때만 그 주소에서 복구 화면을 보여 줄 수 있다 */
    const check = (restorePath: string | null) => {
      void readSession().then((session) => {
        if (!active || !session) return;
        const { status, loginSession: current } = session;
        const changed = (typeof current === "string" || current === null) && current !== loginSession;
        if (status === "signed-out" || changed) {
          if (!reloadingRef.current) {
            reloadingRef.current = true;
            window.location.reload();
          }
          return;
        }
        if (restorePath && status === "restorable") setRestoringPath(restorePath);
      });
    };
    if (checkedPathRef.current !== pathname) {
      checkedPathRef.current = pathname;
      check(pathname);
    }
    const onFocus = () => check(null);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") check(null);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribe = onSessionChanged(() => check(null));
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
  }, [pathname, loginSession]);

  if (restoringPath === pathname) {
    return (
      <div className="flex min-h-[320px] items-center justify-center px-4 py-16">
        <SessionRestore onRefreshed={() => setRestoringPath(null)} />
      </div>
    );
  }
  return <LoginSessionContext.Provider value={loginSession}>{children}</LoginSessionContext.Provider>;
}
