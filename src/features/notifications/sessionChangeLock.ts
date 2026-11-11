"use client";

import { useSyncExternalStore } from "react";

/**
 * 알림 화면의 "다른 탭 계정 변경" 잠금 (브라우저 메모리, 이 탭의 이 화면에서만).
 * 읽음 처리 요청에 서버가 SESSION_CHANGED를 돌려주면 그 안내 문구를 저장해 두고, 의뢰기관·검사기관 알림의 읽음 처리가 모두 이 값을 본다
 * → 같은 이전 화면에서는 다시 보내지 않고 같은 안내를 보인다 (읽음 표시·읽지 않은 알림 수는 바꾸지 않는다).
 * 문서를 새로 불러오면(새로고침·SessionGuard의 다시 불러오기) 초기화되어 새 로그인 세션 기준으로 다시 쓸 수 있다.
 * 서버는 이와 별개로 매 요청마다 세션을 다시 확인한다 (이 값은 화면 편의를 위한 잠금일 뿐이다).
 */

let sessionChangedMessage: string | null = null;
const listeners = new Set<() => void>();

export function markNotificationSessionChanged(message: string) {
  if (sessionChangedMessage !== null) return;
  sessionChangedMessage = message;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 잠겼으면 서버가 준 안내 문구, 아니면 null */
export function useNotificationSessionChanged(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => sessionChangedMessage,
    () => null,
  );
}
