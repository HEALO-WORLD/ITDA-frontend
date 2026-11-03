"use client";

import { useRef, useState } from "react";

import { markNotificationAsReadAction } from "../actions";
import type { NotificationApiFeature } from "../remote";
import type { ApiNotificationItem } from "../types";

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

/**
 * API 모드 개별 읽음 처리 (의뢰기관·검사기관 공통).
 * - 같은 알림은 처리 중에 다시 요청하지 않는다 (상태 갱신 전 연속 클릭까지 ref로 막는다)
 * - 성공하면 Server Function의 refresh()로 목록·읽지 않은 알림 수·헤더 알림 점이 서버 값으로 다시 그려진다
 *   (화면에서 먼저 읽음으로 바꾸지 않는다)
 * - 실패하면 안내 문구를 보여 주고 목록은 그대로 둔다
 */
export function useApiNotificationRead(feature: NotificationApiFeature) {
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const syncPending = () => setPendingIds(new Set(pendingRef.current));

  /** 성공하면 true */
  const markAsRead = async (item: ApiNotificationItem): Promise<boolean> => {
    if (pendingRef.current.has(item.id)) return false;
    pendingRef.current.add(item.id);
    syncPending();
    setErrorMessage(null);

    let ok = false;
    try {
      const result = await markNotificationAsReadAction(feature, item.id);
      ok = result.ok;
      if (result.ok) setAnnouncement(`'${item.title}' 알림을 읽음 처리했습니다.`);
      else setErrorMessage(result.message);
    } catch {
      // Server Function 요청 자체가 실패한 경우 (오프라인 등)
      setErrorMessage(NETWORK_ERROR_MESSAGE);
    } finally {
      pendingRef.current.delete(item.id);
      syncPending();
    }
    return ok;
  };

  return { markAsRead, pendingIds, errorMessage, announcement };
}
