"use client";

import { useCallback, useSyncExternalStore } from "react";

import StatusBadge from "@/components/ui/StatusBadge";

import { getImpactWindowStatus, IMPACT_WINDOW_META, msUntilImpactWindowChange } from "../impactWindow";

/** setTimeout 최대 지연(약 24.8일). 그보다 먼 경계는 이 시간 뒤에 다시 계산한다 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** 서버 렌더링·hydration에서는 현재 시각을 읽지 않는다 ('확인 중'으로 두고 브라우저에서 계산) */
const getServerSnapshot = () => undefined;

/**
 * 장비 장애 중단 기간 상태 배지 (중단 예정·중단 중·중단 해제). 검사기관·관리자 목록과 상세 공용.
 * - 현재 시각은 브라우저에서만 읽는다: 서버 렌더링(프리렌더 포함)과 hydration 첫 화면은 '확인 중'으로 같고,
 *   hydration 직후 브라우저 시각으로 상태를 계산한다 (서버·클라이언트 불일치 없음)
 * - 화면을 열어 둔 동안: 주기적으로 다시 그리지 않고, 다음 경계(시작 또는 종료) 시각에 타이머 하나로만 갱신한다
 * - '중단 해제'는 등록된 중단 기간이 지났다는 뜻이며 장비 복구 완료가 아니다
 */
export default function ImpactWindowBadge({ startAt, endAt }: { startAt: string; endAt: string }) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        const wait = msUntilImpactWindowChange(startAt, endAt, Date.now());
        if (wait === null) return;
        // 경계 시각 직후에 다시 계산한다 (타이머가 조금 일찍 깨어나도 다음 일정으로 이어진다)
        timer = setTimeout(() => {
          onChange();
          schedule();
        }, Math.min(wait + 50, MAX_TIMEOUT_MS));
      };
      schedule();
      return () => clearTimeout(timer);
    },
    [startAt, endAt],
  );
  const status = useSyncExternalStore(subscribe, () => getImpactWindowStatus(startAt, endAt, Date.now()), getServerSnapshot);

  if (status === undefined) return <StatusBadge tone="neutral">확인 중</StatusBadge>;
  if (status === null) return <StatusBadge tone="neutral">확인 불가</StatusBadge>;
  const { label, tone } = IMPACT_WINDOW_META[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
