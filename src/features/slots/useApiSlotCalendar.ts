"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { addDays, getSeoulNow } from "@/lib/date/seoulDate";

import {
  API_SEARCH_MAX_LOOKAHEAD_DAYS,
  fetchApiSlotSearch,
  getMonthSearchWindow,
  toMonthKey,
  type SlotSearchClientFailureReason,
} from "./apiSearchClient";
import type { ApiExamSlot } from "./apiSlots";

/**
 * 슬롯 검색 달력(API 모드)의 월별 예약 가능 슬롯.
 *
 * - 표시 중인 월만 조회한다: 그 달 1일(이번 달이면 오늘)~다음 달 1일 (31일 이하 한 번, 조건 없이 전체)
 *   검사 종류·검사기관·시간대는 받은 슬롯에서 거르므로 조건을 바꿔도 다시 요청하지 않는다
 * - 이미 받은 월은 다시 요청하지 않는다. 실패한 월은 저장하지 않고 다음에 그 월을 다시 표시할 때 재시도한다
 * - 데이터는 이 컴포넌트 메모리에만 둔다 (브라우저 저장소·공유 캐시 없음, 새로고침하면 사라진다)
 */

export type ApiCalendarMonthState =
  | { status: "loading" }
  | { status: "loaded"; slots: ApiExamSlot[] }
  | { status: "error"; reason: SlotSearchClientFailureReason; message: string }
  /** 다 지난 달·검색 가능 기간 밖 (조회하지 않는다) */
  | { status: "out-of-range" };

export function useApiSlotCalendar(enabled: boolean) {
  const [months, setMonths] = useState<Record<string, ApiCalendarMonthState>>({});
  /** 받은 월·요청 중인 월 (같은 월을 겹쳐 요청하지 않는다). 렌더링에는 쓰지 않는다 */
  const settledRef = useRef(new Set<string>());
  const pendingRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, []);

  const requestMonth = useCallback(
    (year: number, month: number) => {
      if (!enabled) return;
      const key = toMonthKey(year, month);
      if (settledRef.current.has(key) || pendingRef.current.has(key)) return;
      const today = getSeoulNow().dateKey;
      const window = getMonthSearchWindow(year, month, today);
      if (!window || window.endDateExclusive > addDays(today, API_SEARCH_MAX_LOOKAHEAD_DAYS)) {
        settledRef.current.add(key);
        setMonths((prev) => ({ ...prev, [key]: { status: "out-of-range" } }));
        return;
      }
      const controller = new AbortController();
      pendingRef.current.set(key, controller);
      setMonths((prev) => ({ ...prev, [key]: { status: "loading" } }));
      void fetchApiSlotSearch(window, { signal: controller.signal }).then((result) => {
        if (pendingRef.current.get(key) !== controller) return;
        pendingRef.current.delete(key);
        if (result.ok) {
          settledRef.current.add(key);
          setMonths((prev) => ({ ...prev, [key]: { status: "loaded", slots: result.slots } }));
        } else if (result.reason !== "ABORTED") {
          setMonths((prev) => ({ ...prev, [key]: { status: "error", reason: result.reason, message: result.message } }));
        }
      });
    },
    [enabled],
  );

  return { months, requestMonth };
}
