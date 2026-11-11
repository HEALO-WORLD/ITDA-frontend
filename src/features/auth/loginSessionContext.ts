"use client";

import { createContext, useContext } from "react";

/**
 * 보호 화면이 렌더링될 때의 로그인 세션 구분 값 (ApiRoleGate → SessionGuard가 제공한다).
 * 변경 요청 Server Action에 "이 화면이 그려진 세션"으로 함께 보내, 그 사이 다른 탭에서 계정이 바뀌었으면 서버가 실행하지 않게 한다.
 * 인증·인가 근거가 아니다 (서버는 HttpOnly 쿠키 값과 비교만 하고, 권한은 기존 확인·백엔드가 판단한다).
 * - undefined: SessionGuard 밖 (서버가 거부한다) · null: 구분 값 쿠키가 없던 기존 세션 · 문자열: 현재 로그인 세션
 * `/auth/session`에서 새로 읽은 값이 아니라 렌더링 시점 값이어야 한다 (새 값이면 계정이 바뀌어도 일치해 버린다).
 */
export const LoginSessionContext = createContext<string | null | undefined>(undefined);

export function useRenderedLoginSession(): string | null | undefined {
  return useContext(LoginSessionContext);
}
