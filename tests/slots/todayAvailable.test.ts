import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ApiExamSlot } from "@/features/slots/apiSlots";
import { isBookableSlot } from "@/features/slots/availability";
import { countTodayAvailableSlots, createMonthSlotStore, type MonthSlotsState } from "@/features/slots/managementMonth";
import type { SlotStatusDto } from "@/features/slots/remote";

/**
 * 오늘 예약 가능 슬롯 수 (검사기관 요약 바, API 모드): 순수 집계 + 월 캐시 재사용(추가 요청 없음·무효화 뒤 갱신).
 * 실제 네트워크 없음 (월 로더는 가짜).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const TODAY = "2026-11-05";
const NOW = "2026-11-05T10:30";
const MONTH = "2026-11-01";

let seq = 0;
const slot = (startAt: string, status: SlotStatusDto = "AVAILABLE", organizationId = ORG): ApiExamSlot => {
  seq++;
  const id = `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  return {
    id,
    organizationId,
    organizationName: "A 영상센터",
    equipmentId: "bbbbbbbb-0000-4000-8000-000000000001",
    equipmentName: "CT-1",
    examType: "CT",
    examTypeId: "cccccccc-0000-4000-8000-000000000001",
    examTypeName: "흉부 CT",
    startAt,
    endAt: `${startAt.slice(0, 11)}23:59`,
    startsAt: `${startAt}:00+09:00`,
    endsAt: `${startAt.slice(0, 11)}23:59:00+09:00`,
    isAvailable: status === "AVAILABLE",
    status,
  };
};

const loaded = (slots: ApiExamSlot[]): MonthSlotsState => ({ status: "loaded", slots });
const count = (state: MonthSlotsState | undefined, nowDateTime = NOW, institutionIds = new Set([ORG])) =>
  countTodayAvailableSlots(state, { today: TODAY, nowDateTime, institutionIds });

describe("countTodayAvailableSlots", () => {
  it("오늘 예약 가능 슬롯이 없으면 0건 (loaded)", () => {
    assert.deepEqual(count(loaded([])), { status: "loaded", count: 0 });
    assert.deepEqual(count(loaded([slot("2026-11-06T09:00")])), { status: "loaded", count: 0 });
  });

  it("오늘 AVAILABLE·지금 이후 슬롯을 모두 센다", () => {
    const slots = [slot("2026-11-05T11:00"), slot("2026-11-05T14:00"), slot("2026-11-05T23:30")];
    assert.deepEqual(count(loaded(slots)), { status: "loaded", count: 3 });
  });

  it("시작 시각이 지났거나 지금과 같은 AVAILABLE 슬롯은 뺀다 (Mock isBookableSlot과 같은 기준)", () => {
    const slots = [slot("2026-11-05T09:00"), slot("2026-11-05T10:30"), slot("2026-11-05T10:31")];
    assert.deepEqual(count(loaded(slots)), { status: "loaded", count: 1 });
    // 같은 슬롯을 Mock 기준 함수에 넣어도 같은 결과
    assert.equal(slots.filter((item) => isBookableSlot(item, NOW)).length, 1);
  });

  it("HELD·BOOKED·UNAVAILABLE은 뺀다", () => {
    const slots = (["HELD", "BOOKED", "UNAVAILABLE", "AVAILABLE"] as const).map((status) => slot("2026-11-05T15:00", status));
    assert.deepEqual(count(loaded(slots)), { status: "loaded", count: 1 });
  });

  it("다른 기관 슬롯은 뺀다 (기관 ID는 대소문자 구분 없음)", () => {
    const slots = [slot("2026-11-05T15:00", "AVAILABLE", OTHER_ORG), slot("2026-11-05T15:00", "AVAILABLE", ORG.toUpperCase())];
    assert.deepEqual(count(loaded(slots)), { status: "loaded", count: 1 });
    assert.deepEqual(count(loaded(slots), NOW, new Set()), { status: "loaded", count: 0 });
  });

  it("현재 시각이 지나면 수가 줄어든다 (분 단위)", () => {
    const state = loaded([slot("2026-11-05T11:00"), slot("2026-11-05T12:00")]);
    assert.equal((count(state, "2026-11-05T10:59") as { count: number }).count, 2);
    assert.equal((count(state, "2026-11-05T11:00") as { count: number }).count, 1);
    assert.equal((count(state, "2026-11-05T12:00") as { count: number }).count, 0);
  });

  it("조회 전·요청 중은 loading, 실패는 error (0건으로 바꾸지 않는다)", () => {
    assert.deepEqual(count(undefined), { status: "loading" });
    assert.deepEqual(count({ status: "loading" }), { status: "loading" });
    assert.deepEqual(count({ status: "error", reason: "NETWORK", message: "연결 실패" }), { status: "error", message: "연결 실패" });
  });
});

describe("월 캐시 재사용 (createMonthSlotStore)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const institutionIds = new Set([ORG]);

  it("달력과 요약이 같은 달을 요청해도 서버 요청은 1회", async () => {
    let calls = 0;
    const store = createMonthSlotStore(async () => {
      calls++;
      return { ok: true, slots: [slot("2026-11-05T11:00")] };
    });
    store.request(MONTH); // 달력
    store.request(MONTH); // 오늘 슬롯 수
    await flush();
    store.request(MONTH);
    assert.equal(calls, 1);
    assert.deepEqual(countTodayAvailableSlots(store.getSnapshot()[MONTH], { today: TODAY, nowDateTime: NOW, institutionIds }), { status: "loaded", count: 1 });
  });

  it("슬롯 생성 뒤 invalidate → 다시 요청하면 새 값으로 갱신", async () => {
    let slots = [slot("2026-11-05T11:00")];
    let calls = 0;
    const store = createMonthSlotStore(async () => {
      calls++;
      return { ok: true, slots };
    });
    store.request(MONTH);
    await flush();
    slots = [...slots, slot("2026-11-05T13:00"), slot("2026-11-05T14:00")];
    store.invalidate();
    assert.deepEqual(countTodayAvailableSlots(store.getSnapshot()[MONTH], { today: TODAY, nowDateTime: NOW, institutionIds }), { status: "loading" });
    store.request(MONTH);
    await flush();
    assert.equal(calls, 2);
    assert.deepEqual(countTodayAvailableSlots(store.getSnapshot()[MONTH], { today: TODAY, nowDateTime: NOW, institutionIds }), { status: "loaded", count: 3 });
  });

  it("조회 실패는 error로 남고 자동으로 다시 요청하지 않으며, retry로만 다시 받는다", async () => {
    let fail = true;
    let calls = 0;
    const store = createMonthSlotStore(async () => {
      calls++;
      return fail ? { ok: false, reason: "SERVER_ERROR", message: "서버 오류" } : { ok: true, slots: [slot("2026-11-05T11:00")] };
    });
    store.request(MONTH);
    await flush();
    assert.equal(countTodayAvailableSlots(store.getSnapshot()[MONTH], { today: TODAY, nowDateTime: NOW, institutionIds }).status, "error");
    store.request(MONTH);
    assert.equal(calls, 1);
    fail = false;
    store.retry(MONTH);
    await flush();
    assert.equal(calls, 2);
    assert.deepEqual(countTodayAvailableSlots(store.getSnapshot()[MONTH], { today: TODAY, nowDateTime: NOW, institutionIds }), { status: "loaded", count: 1 });
  });

  it("로더가 예외를 던지면 error (네트워크 실패)", async () => {
    const store = createMonthSlotStore(async () => {
      throw new Error("fetch failed");
    });
    store.request(MONTH);
    await flush();
    assert.equal(countTodayAvailableSlots(store.getSnapshot()[MONTH], { today: TODAY, nowDateTime: NOW, institutionIds }).status, "error");
  });
});
