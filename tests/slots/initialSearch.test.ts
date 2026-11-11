import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createLatestGuard } from "@/features/slots/apiSearchClient";
import { isAutoSearchScreen, isPcViewport, PC_MEDIA_QUERY, scheduleInitialSearch } from "@/features/slots/initialSearch";

/**
 * 슬롯 검색 화면(PC)의 최초 자동 검색: 대상 화면, PC 화면 폭 판정, Strict Mode에서 요청 한 번, 오래된 응답 무시.
 */

/** 직접 실행하는 예약 큐 (setTimeout 대신) */
function manualScheduler() {
  const queue = new Map<number, () => void>();
  let next = 0;
  return {
    schedule: (run: () => void) => {
      const id = ++next;
      queue.set(id, run);
      return id;
    },
    cancel: (handle: unknown) => {
      queue.delete(handle as number);
    },
    flush: () => {
      const runs = [...queue.values()];
      queue.clear();
      for (const run of runs) run();
    },
  };
}

describe("자동 검색 대상 화면", () => {
  it("검색 화면의 일반 검색만 (재조정 모드·재조정·알림 대화상자는 기존처럼 [슬롯 검색])", () => {
    assert.equal(isAutoSearchScreen({ embedded: false, isRescheduleMode: false }), true);
    assert.equal(isAutoSearchScreen({ embedded: false, isRescheduleMode: true }), false);
    assert.equal(isAutoSearchScreen({ embedded: true, isRescheduleMode: true }), false);
    assert.equal(isAutoSearchScreen({ embedded: true, isRescheduleMode: false }), false);
  });
});

describe("PC 화면 폭 판정", () => {
  const original = globalThis.window;
  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = original;
  });
  const stubWindow = (matches: boolean, queries: string[] = []) => {
    globalThis.window = { matchMedia: (query: string) => (queries.push(query), { matches }) } as unknown as Window & typeof globalThis;
  };

  it("xl(80rem) 기준: 화면의 xl: 클래스와 같은 기준으로 판정한다", () => {
    const queries: string[] = [];
    stubWindow(true, queries);
    assert.equal(isPcViewport(), true);
    assert.deepEqual(queries, [PC_MEDIA_QUERY]);
    assert.equal(PC_MEDIA_QUERY, "(min-width: 80rem)");
    stubWindow(false);
    assert.equal(isPcViewport(), false);
  });

  it("서버 렌더링(window 없음)에서는 PC가 아니다 (자동 검색하지 않음)", () => {
    Reflect.deleteProperty(globalThis, "window");
    assert.equal(isPcViewport(), false);
  });
});

describe("최초 검색 예약 (Strict Mode)", () => {
  it("effect '실행 → 정리 → 재실행'(Strict Mode 개발 환경)에서도 검색은 한 번만 실행된다", () => {
    const scheduler = manualScheduler();
    let runs = 0;
    const run = () => runs++;
    const cleanup = scheduleInitialSearch(run, scheduler.schedule, scheduler.cancel); // 실행
    cleanup(); // 정리 (Strict Mode의 가짜 언마운트)
    scheduleInitialSearch(run, scheduler.schedule, scheduler.cancel); // 재실행
    scheduler.flush();
    assert.equal(runs, 1);
  });

  it("실행 전에 화면을 떠나면(언마운트) 검색하지 않는다", () => {
    const scheduler = manualScheduler();
    let runs = 0;
    scheduleInitialSearch(() => runs++, scheduler.schedule, scheduler.cancel)();
    scheduler.flush();
    assert.equal(runs, 0);
  });

  it("예약 함수가 취소를 무시해도(이미 꺼낸 작업) 정리 뒤에는 실행하지 않는다", () => {
    let pending: (() => void) | null = null;
    let runs = 0;
    const cleanup = scheduleInitialSearch(
      () => runs++,
      (task) => (pending = task),
      () => {},
    );
    cleanup();
    (pending as (() => void) | null)?.();
    assert.equal(runs, 0);
  });

  it("기본 setTimeout 예약: 같은 틱 안의 정리·재실행 뒤 한 번만 실행", async () => {
    let runs = 0;
    scheduleInitialSearch(() => runs++)();
    scheduleInitialSearch(() => runs++);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(runs, 1);
  });
});

describe("자동 검색과 사용자 검색이 겹칠 때 (createLatestGuard: API·Mock 공통)", () => {
  it("나중에 시작한 검색만 반영한다 (먼저 시작한 자동 검색 응답이 늦게 와도 무시, 요청은 취소)", () => {
    const guard = createLatestGuard();
    const auto = guard.start();
    const user = guard.start();
    assert.equal(auto.signal.aborted, true);
    assert.equal(auto.isLatest(), false);
    assert.equal(user.isLatest(), true);
  });

  it("초기화(cancel) 뒤에는 진행 중이던 검색 응답을 반영하지 않는다", () => {
    const guard = createLatestGuard();
    const pending = guard.start();
    guard.cancel();
    assert.equal(pending.isLatest(), false);
    assert.equal(pending.signal.aborted, true);
  });
});
