/**
 * 슬롯 검색 화면(PC)의 최초 자동 검색.
 * - 검색 화면(대화상자 아님)의 일반 검색에서만, PC(xl ≥1280px) 화면 폭일 때만 기본 조건으로 한 번 검색한다
 *   (재조정 모드·재조정·알림 대화상자·모바일은 기존처럼 [슬롯 검색]을 눌러야 검색한다)
 * - 검색 조건이 바뀌어도 자동으로 다시 검색하지 않는다 (마운트 시 한 번만)
 */

/** PC 레이아웃 기준 (Tailwind xl = 80rem). 화면의 `xl:` 클래스와 같은 기준이어야 한다 */
export const PC_MEDIA_QUERY = "(min-width: 80rem)";

export function isPcViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PC_MEDIA_QUERY).matches;
}

/** 기본 조건 자동 검색을 쓰는 화면인지 (화면 폭은 따로 확인한다) */
export function isAutoSearchScreen(input: { embedded: boolean; isRescheduleMode: boolean }): boolean {
  return !input.embedded && !input.isRescheduleMode;
}

type Schedule = (run: () => void) => unknown;
type Cancel = (handle: unknown) => void;

const defaultSchedule: Schedule = (run) => setTimeout(run, 0);
const defaultCancel: Cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);

/**
 * 최초 검색을 다음 작업으로 미뤄 예약하고, 취소 함수를 돌려준다 (useEffect 정리 함수로 쓴다).
 * React Strict Mode(개발)는 effect를 '실행 → 정리 → 다시 실행'하므로, 바로 요청하면 요청이 두 번 나간다.
 * 미뤄 두면 첫 예약은 정리에서 취소되고 두 번째 예약만 실행되어 요청은 한 번이다
 */
export function scheduleInitialSearch(run: () => void, schedule: Schedule = defaultSchedule, cancel: Cancel = defaultCancel): () => void {
  let isCancelled = false;
  const handle = schedule(() => {
    if (!isCancelled) run();
  });
  return () => {
    isCancelled = true;
    cancel(handle);
  };
}
