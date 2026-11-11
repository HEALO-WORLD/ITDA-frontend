import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ApiExamSlot } from "@/features/slots/apiSlots";
import {
  buildApiMonthDayStatuses,
  buildDaySlotView,
  createMonthSlotStore,
  EMPTY_DAY_SLOT_FILTERS,
  getManagementDayRange,
  type DaySlotFilters,
} from "@/features/slots/managementMonth";
import { addMonths, getSeoulNow } from "@/lib/date/seoulDate";

/**
 * 검사기관 선택 날짜 슬롯 목록: 필터(CT/MRI·상태·오전/오후)·10건 페이지·빈 상태 구분·달력 집계 유지·Mock 회귀.
 * 모두 받은 월 데이터 안의 계산이다 (서버 요청 없음).
 */

const CT1 = "30000000-0000-0000-0000-000000000001";
const CT2 = "30000000-0000-0000-0000-000000000002";
const MRI1 = "30000000-0000-0000-0000-000000000003";
const MODALITY = new Map<string, "CT" | "MRI">([
  [CT1, "CT"],
  [CT2, "CT"],
  [MRI1, "MRI"],
]);
const NAMES: Record<string, string> = { [CT1]: "ITDA CT 1호기", [CT2]: "ITDA CT 2호기", [MRI1]: "ITDA MRI 1호기" };
const ALL = [CT1, CT2, MRI1];

const today = getSeoulNow().dateKey;
const nextMonth = addMonths(`${today.slice(0, 7)}-01`, 1);
const DATE = `${nextMonth.slice(0, 7)}-10`;
const OTHER_DATE = `${nextMonth.slice(0, 7)}-11`;

let serial = 0;
function slot(equipmentId: string, time: string, status: ApiExamSlot["status"] = "AVAILABLE", date = DATE): ApiExamSlot {
  serial++;
  const [hh, mm] = time.split(":").map(Number);
  const end = `${String(hh).padStart(2, "0")}:${String(mm + 20).padStart(2, "0")}`;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    organizationId: "20000000-0000-0000-0000-000000000003",
    organizationName: "B영상의학과",
    equipmentId,
    // 장비명에 CT/MRI가 들어 있어도 판단은 장비 modality로 한다: examType을 일부러 반대로 둔다
    equipmentName: NAMES[equipmentId],
    examType: MODALITY.get(equipmentId) === "CT" ? "MRI" : "CT",
    examTypeId: "40000000-0000-0000-0000-000000000001",
    examTypeName: "검사",
    status,
    isAvailable: status === "AVAILABLE",
    startsAt: `${date}T${time}:00+09:00`,
    endsAt: `${date}T${end}:00+09:00`,
    startAt: `${date}T${time}`,
    endAt: `${date}T${end}`,
  };
}

/** 45건: CT1 20건(08~14시) · CT2 15건(12~16시) · MRI1 10건(오전 5·오후 5), 상태 섞임 */
const STATUSES: ApiExamSlot["status"][] = ["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE"];
const MONTH = [
  ...Array.from({ length: 20 }, (_, i) => slot(CT1, `${String(8 + Math.floor(i / 3)).padStart(2, "0")}:${String((i % 3) * 20).padStart(2, "0")}`, STATUSES[i % 4])),
  ...Array.from({ length: 15 }, (_, i) => slot(CT2, `${String(12 + Math.floor(i / 3)).padStart(2, "0")}:${String((i % 3) * 20).padStart(2, "0")}`, STATUSES[i % 4])),
  ...Array.from({ length: 10 }, (_, i) => slot(MRI1, i < 5 ? `${String(9 + i).padStart(2, "0")}:00` : `${String(12 + i).padStart(2, "0")}:00`, STATUSES[i % 4])),
  slot(CT1, "09:00", "AVAILABLE", OTHER_DATE),
];

const view = (filters: Partial<DaySlotFilters> = {}, page = 1, scope = ALL, monthSlots = MONTH, date = DATE) =>
  buildDaySlotView({ monthSlots, date, scopeEquipmentIds: scope, equipmentModality: MODALITY, filters: { ...EMPTY_DAY_SLOT_FILTERS, ...filters }, page });

describe("필터", () => {
  it("1·2. CT/MRI: 장비 modality 기준 (장비명·검사 종류 문자열로 판단하지 않는다), 전체·CT·MRI 건수", () => {
    assert.equal(view().filtered, 45);
    assert.equal(view({ modality: "CT" }).filtered, 35);
    assert.equal(view({ modality: "MRI" }).filtered, 10);
    assert.ok(view({ modality: "MRI" }).items.every((item) => item.equipmentId === MRI1));
  });

  it("3. 상태: 서버 원본 상태로 거른다 (지난 시간이어도 원본 그대로)", () => {
    const counts = STATUSES.map((status) => view({ status }).filtered);
    assert.equal(counts.reduce((a, b) => a + b, 0), 45);
    for (const status of STATUSES) assert.ok(view({ status }).items.every((item) => item.status === status));
    const past = slot(CT1, "09:00", "BOOKED", today);
    assert.equal(view({ status: "BOOKED" }, 1, ALL, [past], today).filtered, 1);
  });

  it("4. 오전/오후: 11:59까지 오전, 12:00부터 오후", () => {
    const edge = [slot(CT1, "11:59"), slot(CT1, "12:00"), slot(CT1, "00:00"), slot(CT1, "23:40")];
    assert.deepEqual(view({ timeOfDay: "AM" }, 1, ALL, edge).items.map((item) => item.startAt.slice(11)), ["00:00", "11:59"]);
    assert.deepEqual(view({ timeOfDay: "PM" }, 1, ALL, edge).items.map((item) => item.startAt.slice(11)), ["12:00", "23:40"]);
    const onDate = MONTH.filter((item) => item.startAt.startsWith(DATE));
    const am = onDate.filter((item) => item.startAt.slice(11) < "12:00").length;
    assert.ok(am > 0 && am < 45);
    assert.equal(view({ timeOfDay: "AM" }).filtered, am);
    assert.equal(view({ timeOfDay: "PM" }).filtered, 45 - am);
  });

  it("5. 상단에서 CT 1호기를 고른 뒤 오른쪽에서 MRI를 고르면 다른 MRI 장비 슬롯이 나오지 않는다", () => {
    const result = view({ modality: "MRI" }, 1, [CT1]);
    assert.equal(result.total, 20);
    assert.equal(result.filtered, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.otherEquipmentCount, 25);
  });

  it("6. 상태·시간대 복합", () => {
    const expected = MONTH.filter((item) => item.startAt.startsWith(DATE) && item.status === "AVAILABLE" && item.startAt.slice(11) >= "12:00").length;
    const result = view({ status: "AVAILABLE", timeOfDay: "PM" });
    assert.equal(result.filtered, expected);
    assert.ok(result.items.every((item) => item.status === "AVAILABLE" && item.startAt.slice(11) >= "12:00"));
  });

  it("정렬: 시작 시각 오름차순, 같으면 장비명", () => {
    const same = [slot(CT2, "09:00"), slot(MRI1, "09:00"), slot(CT1, "09:00"), slot(CT1, "08:00")];
    assert.deepEqual(
      view({}, 1, ALL, same).items.map((item) => `${item.startAt.slice(11)} ${item.equipmentName}`),
      ["08:00 ITDA CT 1호기", "09:00 ITDA CT 1호기", "09:00 ITDA CT 2호기", "09:00 ITDA MRI 1호기"],
    );
  });
});

describe("10건 페이지", () => {
  it("7·8. 45건 → 5페이지, 마지막 페이지 5건", () => {
    const first = view();
    assert.deepEqual([first.totalPages, first.items.length, first.page], [5, 10, 1]);
    const last = view({}, 5);
    assert.deepEqual([last.items.length, last.page], [5, 5]);
    // 페이지가 겹치거나 빠지지 않는다
    const ids = [1, 2, 3, 4, 5].flatMap((page) => view({}, page).items.map((item) => item.id));
    assert.equal(new Set(ids).size, 45);
  });

  it("현재 페이지가 전체 페이지를 넘으면 마지막 페이지로 맞춘다", () => {
    assert.equal(view({ modality: "MRI" }, 5).page, 1);
    assert.equal(view({}, 99).page, 5);
    assert.equal(view({}, 0).page, 1);
  });

  it("9·10. 필터·날짜가 바뀌면 1페이지 (화면은 날짜·필터를 키로 페이지를 기억한다)", () => {
    const source = readFileSync(new URL("../../src/features/equipment/components/ApiSlotSchedule.tsx", import.meta.url), "utf8");
    assert.match(source, /const pageKey = `\$\{selectedDate\}\|\$\{filters\.modality\}\|\$\{filters\.status\}\|\$\{filters\.timeOfDay\}`;/);
    assert.match(source, /const requestedPage = pageState\.key === pageKey \? pageState\.page : 1;/);
  });
});

describe("빈 상태·집계·요청", () => {
  it("11. 필터 결과 0건(원본 있음)과 날짜 자체 0건을 구분하고, 모두 예약 불가인 날을 알린다", () => {
    const filteredOut = view({ status: "AVAILABLE" }, 1, ALL, [slot(CT1, "09:00", "BOOKED")]);
    assert.deepEqual([filteredOut.total, filteredOut.filtered, filteredOut.allUnavailable], [1, 0, true]);
    const empty = view({}, 1, ALL, MONTH, `${nextMonth.slice(0, 7)}-20`);
    assert.deepEqual([empty.total, empty.filtered, empty.allUnavailable], [0, 0, false]);
  });

  it("12. 필터를 바꿔도 서버 요청이 늘지 않는다 (월 캐시 요청은 달 단위)", async () => {
    let calls = 0;
    const store = createMonthSlotStore(async () => {
      calls++;
      return { ok: true, slots: MONTH };
    });
    store.request(nextMonth);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = store.getSnapshot()[nextMonth];
    assert.ok(state.status === "loaded");
    for (const filters of [{ modality: "CT" }, { status: "HELD" }, { timeOfDay: "PM" }, {}] as Partial<DaySlotFilters>[]) {
      view(filters, 2, ALL, state.slots);
      store.request(nextMonth);
    }
    assert.equal(calls, 1);
    const source = readFileSync(new URL("../../src/features/equipment/components/ApiSlotSchedule.tsx", import.meta.url), "utf8");
    assert.match(source, /\}, \[store, monthStart, selectedMonth, monthStates\]\);/, "요청 effect는 필터 값에 의존하지 않는다");
  });

  it("13. 달력 집계는 오른쪽 필터와 무관하게 상단 장비 범위 기준 그대로", () => {
    const range = getManagementDayRange(today);
    const now = getSeoulNow().dateTime;
    const before = buildApiMonthDayStatuses(nextMonth, { status: "loaded", slots: MONTH }, ALL, range, now).get(DATE);
    view({ modality: "MRI", status: "BOOKED", timeOfDay: "PM" });
    const after = buildApiMonthDayStatuses(nextMonth, { status: "loaded", slots: MONTH }, ALL, range, now).get(DATE);
    assert.deepEqual(before, after);
    assert.deepEqual(before, { kind: "AVAILABLE", total: 45, available: MONTH.filter((item) => item.startAt.startsWith(DATE) && item.status === "AVAILABLE").length });
  });
});

describe("레이아웃·DaySlotList", () => {
  it("API 일정 영역은 달력 40% : 목록 60%", () => {
    const api = readFileSync(new URL("../../src/features/equipment/components/ApiSlotSchedule.tsx", import.meta.url), "utf8");
    assert.match(api, /min-\[900px\]:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\]/);
  });

  it("API: 필터 영역·건수 요약·필터 0건 문구·페이지 영역을 그린다", async () => {
    const { default: DaySlotList } = await import("@/features/equipment/components/DaySlotList");
    const html = renderToStaticMarkup(
      createElement(DaySlotList, {
        date: DATE,
        state: { kind: "READY" },
        slots: [],
        scopeLabel: "전체 장비 3대",
        singleEquipmentName: null,
        otherEquipmentSlotCount: 0,
        slotMinutes: new Map(),
        nowDateTime: getSeoulNow().dateTime,
        onSelectSlot: () => {},
        toolbar: createElement("div", { "data-testid": "toolbar" }, "필터"),
        countSummary: " · 전체 45건 · 필터 결과 0건",
        emptyMessage: "현재 조건에 맞는 슬롯이 없습니다.",
        footer: createElement("nav", null, "페이지"),
      }),
    );
    assert.match(html, /data-testid="toolbar"/);
    assert.match(html, /전체 45건 · 필터 결과 0건/);
    assert.match(html, /현재 조건에 맞는 슬롯이 없습니다\./);
    assert.doesNotMatch(html, /이 날짜에는 슬롯이 없습니다/);
    assert.match(html, /<nav>페이지<\/nav>/);
  });

  it("15. Mock(추가 prop 없음): 기존 건수 줄·빈 문구 그대로, 필터·페이지 없음", async () => {
    const { default: DaySlotList } = await import("@/features/equipment/components/DaySlotList");
    const html = renderToStaticMarkup(
      createElement(DaySlotList, {
        date: DATE,
        state: { kind: "READY" },
        slots: [],
        scopeLabel: "전체 장비 3대",
        singleEquipmentName: null,
        otherEquipmentSlotCount: 0,
        slotMinutes: new Map(),
        nowDateTime: getSeoulNow().dateTime,
        onSelectSlot: () => {},
      }),
    );
    assert.match(html, /이 날짜에는 슬롯이 없습니다\./);
    assert.doesNotMatch(html, /필터|페이지/);
  });
});
