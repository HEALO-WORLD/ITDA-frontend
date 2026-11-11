/**
 * 같은 브라우저의 다른 탭에 "로그인 상태가 바뀌었을 수 있다"는 신호만 보낸다 (BroadcastChannel, 같은 출처끼리만).
 * 메시지에는 토큰·계정·개인정보를 담지 않는다. 받은 탭은 `/auth/session`으로 직접 확인한다 (메시지 내용을 믿지 않는다).
 * BroadcastChannel이 없으면 아무것도 하지 않는다 (보호 화면은 다음 화면 이동 때 확인한다).
 */

const CHANNEL_NAME = "itda:auth";
const SESSION_CHANGED = "session-changed";

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** 로그인 성공·로그인 화면 진입(로그아웃 뒤 포함) 때 다른 탭에 알린다 */
export function notifySessionChanged() {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage(SESSION_CHANGED);
  } finally {
    channel.close();
  }
}

/** 다른 탭의 신호를 받는다. 해제 함수를 돌려준다 */
export function onSessionChanged(listener: () => void): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  channel.onmessage = (event) => {
    if (event.data === SESSION_CHANGED) listener();
  };
  return () => channel.close();
}
