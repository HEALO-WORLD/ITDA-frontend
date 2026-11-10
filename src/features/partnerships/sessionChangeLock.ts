"use client";

import { useSyncExternalStore } from "react";

/**
 * 협약 관리 화면의 "다른 탭 계정 변경" 잠금 (브라우저 메모리, 이 탭의 이 화면에서만).
 * 어느 협약 변경 요청이든 서버가 SESSION_CHANGED를 돌려주면 표시해 두고, 새 협약 요청·다시 요청·승인·거절·종료의
 * 확인 버튼이 모두 이 값을 본다 → 대화상자를 닫았다 다시 열거나 필터를 바꿔도 같은 이전 화면에서는 다시 보내지 않는다.
 * 문서를 새로 불러오면(새로고침·SessionGuard의 다시 불러오기) 초기화되어 새 로그인 세션 기준으로 다시 쓸 수 있다.
 * 서버는 이와 별개로 매 요청마다 세션을 다시 확인한다 (이 값은 화면 편의를 위한 잠금일 뿐이다).
 */

let sessionChanged = false;
const listeners = new Set<() => void>();

export function markPartnershipSessionChanged() {
  if (sessionChanged) return;
  sessionChanged = true;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePartnershipSessionChanged(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => sessionChanged,
    () => false,
  );
}
