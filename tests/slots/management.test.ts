import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ApiExamSlot } from "@/features/slots/apiSlots";
import { ApiError } from "@/lib/api/errors";
import { addDays, addMonths, getSeoulNow } from "@/lib/date/seoulDate";

/**
 * 검사기관 슬롯 관리 조회 (view=MANAGEMENT): 월 캐시·달력 상태·상태 표시·통신 계층·서버 인증/매핑·Mock 회귀.
 * users/me와 Gateway는 가짜로 바꾼다 (실제 네트워크·DB 변경 없음).
 */

const OWN = "20000000-0000-0000-0000-000000000003";
const OTHER = "20000000-0000-0000-0000-000000000099";
const CT_EQUIPMENT = "30000000-0000-0000-0000-000000000001";
const MRI_EQUIPMENT = "30000000-0000-0000-0000-000000000002";
const OTHER_EQUIPMENT = "30000000-0000-0000-0000-000000000099";
const CT_TYPE = "40000000-0000-0000-0000-000000000001";
const MRI_TYPE = "40000000-0000-0000-0000-000000000002";

const today = getSeoulNow().dateKey;
const thisMonth = `${today.slice(0, 7)}-01`;
const nextMonth = addMonths(thisMonth, 1);
const NOW = getSeoulNow().dateTime;

type SlotStatus = "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE";
let serial = 0;
function dto(date: string, hour: number, overrides: Partial<{ equipmentId: string; examTypeId: string; status: SlotStatus }> = {}) {
  serial++;
  const hh = String(hour).padStart(2, "0");
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    equipmentId: overrides.equipmentId ?? CT_EQUIPMENT,
    examTypeId: overrides.examTypeId ?? CT_TYPE,
    startsAt: `${date}T${hh}:00:00+09:00`,
    endsAt: `${date}T${hh}:40:00+09:00`,
    status: overrides.status ?? "AVAILABLE",
  };
}

const apiSlot = (date: string, hour: number, status: SlotStatus, equipmentId = CT_EQUIPMENT): ApiExamSlot => {
  const hh = String(hour).padStart(2, "0");
  return {
    id: `bbbbbbbb-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    organizationId: OWN,
    organizationName: "B영상의학과",
    equipmentId,
    equipmentName: equipmentId === CT_EQUIPMENT ? "CT-1" : "MRI-1",
    examType: equipmentId === CT_EQUIPMENT ? "CT" : "MRI",
    examTypeId: equipmentId === CT_EQUIPMENT ? CT_TYPE : MRI_TYPE,
    examTypeName: equipmentId === CT_EQUIPMENT ? "흉부 CT" : "뇌 MRI",
    status,
    isAvailable: status === "AVAILABLE",
    startsAt: `${date}T${hh}:00:00+09:00`,
    endsAt: `${date}T${hh}:40:00+09:00`,
    startAt: `${date}T${hh}:00`,
    endAt: `${date}T${hh}:40`,
  };
};

// ── 가짜 Gateway ──
type Access = { ok: true; headers: HeadersInit; user: { institutionId: string; institutionName: string } } | { ok: false; reason: string; message: string };
const gateway = {
  access: null as unknown as Access,
  calls: [] as { path: string; query?: Record<string, unknown> }[],
  slots: [] as ReturnType<typeof dto>[],
  slotError: null as ApiError | null,
};
const page = <T>(contents: T[]) => ({ contents, totalElements: contents.length, totalPages: 1, size: 100, number: 0 });

async function fakeApiRequestData(path: string, options: { query?: Record<string, unknown> } = {}) {
  gateway.calls.push({ path, query: options.query });
  if (path === `/api/v1/institutions/${OWN}/equipments`) {
    return page([
      { id: CT_EQUIPMENT, institutionId: OWN, name: "CT-1", modality: "CT", status: "OPERATIONAL" },
      { id: MRI_EQUIPMENT, institutionId: OWN, name: "MRI-1", modality: "MRI", status: "OPERATIONAL" },
    ]);
  }
  if (path === "/api/v1/exam-types") {
    return page([
      { id: CT_TYPE, name: "흉부 CT", modality: "CT" },
      { id: MRI_TYPE, name: "뇌 MRI", modality: "MRI" },
    ]);
  }
  if (path === "/api/v1/slots") {
    if (gateway.slotError) throw gateway.slotError;
    const pageNo = Number(options.query?.page);
    const size = Number(options.query?.size);
    const items = gateway.slots.slice(pageNo * size, (pageNo + 1) * size);
    return { items, page: pageNo, size, hasNext: (pageNo + 1) * size < gateway.slots.length };
  }
  const slotMatch = path.match(/^\/api\/v1\/slots\/(.+)$/);
  if (slotMatch) return gateway.slots.find((slot) => slot.id === slotMatch[1]) ?? Promise.reject(new ApiError("HTTP", "x", { status: 404 } as never));
  const equipmentMatch = path.match(/^\/api\/v1\/equipments\/([^/]+)(\/exam-types)?$/);
  if (equipmentMatch) {
    const id = equipmentMatch[1];
    const institutionId = id === OTHER_EQUIPMENT ? OTHER : OWN;
    if (!equipmentMatch[2]) return { id, institutionId, name: "CT-1", modality: "CT", status: "OPERATIONAL" };
    return page([{ id: "50000000-0000-0000-0000-000000000001", equipmentId: id, examTypeId: CT_TYPE, examTypeName: "흉부 CT", modality: "CT", durationMinutes: 40 }]);
  }
  throw new ApiError("HTTP", "x", { status: 404 } as never);
}

let month: typeof import("@/features/slots/managementMonth");
let remote: typeof import("@/features/slots/remote");
let server: typeof import("@/features/slots/managementServer");

before(async () => {
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "slots,equipment";
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        gateway.calls.push({ path: `users/me:${role}` });
        return gateway.access;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/api/client", { namedExports: { apiRequestData: fakeApiRequestData } });
  month = await import("@/features/slots/managementMonth");
  remote = await import("@/features/slots/remote");
  server = await import("@/features/slots/managementServer");
});

beforeEach(() => {
  gateway.access = { ok: true, headers: { Authorization: "Bearer test" }, user: { institutionId: OWN, institutionName: "B영상의학과" } };
  gateway.calls = [];
  gateway.slots = [];
  gateway.slotError = null;
});

const dataCalls = () => gateway.calls.filter((call) => !call.path.startsWith("users/me"));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("월 캐시 (createMonthSlotStore)", () => {
  it("받은 달은 다시 요청하지 않는다", async () => {
    let calls = 0;
    const store = month.createMonthSlotStore(async () => {
      calls++;
      return { ok: true, slots: [] };
    });
    store.request(thisMonth);
    store.request(thisMonth);
    await tick();
    store.request(thisMonth);
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot()[thisMonth].status, "loaded");
  });

  it("빠른 월 이동: 늦게 온 이전 달 응답은 그 달에만 저장되고 현재 달 값을 덮어쓰지 않는다", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<{ ok: true; slots: ApiExamSlot[] }>>>();
    const store = month.createMonthSlotStore((m) => {
      const d = deferred<{ ok: true; slots: ApiExamSlot[] }>();
      pending.set(m, d);
      return d.promise;
    });
    store.request(thisMonth);
    store.request(nextMonth);
    pending.get(nextMonth)!.resolve({ ok: true, slots: [apiSlot(nextMonth, 9, "AVAILABLE")] });
    await tick();
    pending.get(thisMonth)!.resolve({ ok: true, slots: [apiSlot(thisMonth, 10, "BOOKED")] });
    await tick();
    const states = store.getSnapshot();
    assert.ok(states[nextMonth].status === "loaded" && states[nextMonth].slots[0].startAt.startsWith(nextMonth));
    assert.ok(states[thisMonth].status === "loaded" && states[thisMonth].slots[0].startAt.startsWith(thisMonth));
  });

  it("슬롯 생성 후 invalidate: 진행 중이던 이전 응답은 버리고 다시 받는다", async () => {
    const pending: ReturnType<typeof deferred<{ ok: true; slots: ApiExamSlot[] }>>[] = [];
    const store = month.createMonthSlotStore(() => {
      const d = deferred<{ ok: true; slots: ApiExamSlot[] }>();
      pending.push(d);
      return d.promise;
    });
    store.request(thisMonth);
    store.invalidate();
    assert.equal(store.getSnapshot()[thisMonth], undefined);
    store.request(thisMonth);
    pending[1].resolve({ ok: true, slots: [apiSlot(thisMonth, 9, "AVAILABLE"), apiSlot(thisMonth, 10, "AVAILABLE")] });
    await tick();
    pending[0].resolve({ ok: true, slots: [] }); // 생성 전 응답이 늦게 와도 무시
    await tick();
    const state = store.getSnapshot()[thisMonth];
    assert.ok(state.status === "loaded" && state.slots.length === 2);
    assert.equal(pending.length, 2);
  });

  it("실패는 자동으로 반복 요청하지 않고 retry로만 다시 요청한다 (거부된 Promise도 오류로 표시)", async () => {
    let calls = 0;
    const store = month.createMonthSlotStore(async () => {
      calls++;
      if (calls === 1) return { ok: false, reason: "SERVER_ERROR", message: "서버 오류" };
      if (calls === 2) throw new Error("network");
      return { ok: true, slots: [] };
    });
    store.request(thisMonth);
    await tick();
    store.request(thisMonth);
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot()[thisMonth].status, "error");
    store.retry(thisMonth);
    await tick();
    assert.equal(store.getSnapshot()[thisMonth].status, "error");
    store.retry(thisMonth);
    await tick();
    assert.equal(store.getSnapshot()[thisMonth].status, "loaded");
    assert.equal(calls, 3);
  });
});

describe("달력 날짜 상태 (buildApiMonthDayStatuses)", () => {
  const range = () => month.getManagementDayRange(today);

  it("날짜별 전체·예약 가능 수, 모두 예약 불가, 실제 빈 날짜는 슬롯 없음", () => {
    const d = addDays(nextMonth, 2);
    const e = addDays(nextMonth, 3);
    const slots = [apiSlot(d, 9, "AVAILABLE"), apiSlot(d, 10, "BOOKED"), apiSlot(e, 9, "HELD"), apiSlot(e, 10, "UNAVAILABLE")];
    const statuses = month.buildApiMonthDayStatuses(nextMonth, { status: "loaded", slots }, [CT_EQUIPMENT], range(), NOW);
    assert.deepEqual(statuses.get(d), { kind: "AVAILABLE", total: 2, available: 1 });
    assert.deepEqual(statuses.get(e), { kind: "UNAVAILABLE", total: 2, allPast: false });
    assert.equal(statuses.get(addDays(nextMonth, 4))?.kind, "NO_SLOTS");
  });

  it("장비 선택·CT/MRI 필터: 조회 대상 장비 슬롯만 센다", () => {
    const d = addDays(nextMonth, 2);
    const slots = [apiSlot(d, 9, "AVAILABLE", CT_EQUIPMENT), apiSlot(d, 10, "AVAILABLE", MRI_EQUIPMENT), apiSlot(d, 11, "AVAILABLE", MRI_EQUIPMENT)];
    const ctOnly = month.buildApiMonthDayStatuses(nextMonth, { status: "loaded", slots }, [CT_EQUIPMENT], range(), NOW);
    const mriOnly = month.buildApiMonthDayStatuses(nextMonth, { status: "loaded", slots }, [MRI_EQUIPMENT], range(), NOW);
    assert.deepEqual(ctOnly.get(d), { kind: "AVAILABLE", total: 1, available: 1 });
    assert.deepEqual(mriOnly.get(d), { kind: "AVAILABLE", total: 2, available: 2 });
  });

  it("지난 날짜도 조회 범위(3달 전부터) 안이면 슬롯이 있을 때 선택할 수 있다", () => {
    const lastMonth = addMonths(thisMonth, -1);
    const d = addDays(lastMonth, 3);
    const statuses = month.buildApiMonthDayStatuses(lastMonth, { status: "loaded", slots: [apiSlot(d, 9, "BOOKED")] }, [CT_EQUIPMENT], range(), NOW);
    assert.deepEqual(statuses.get(d), { kind: "UNAVAILABLE", total: 1, allPast: true });
    assert.equal(range().start, addMonths(thisMonth, -3));
  });

  it("불러오는 중은 LOADING, 실패는 UNKNOWN (0건·슬롯 없음으로 표시하지 않는다)", () => {
    const loading = month.buildApiMonthDayStatuses(nextMonth, undefined, [CT_EQUIPMENT], range(), NOW);
    const failed = month.buildApiMonthDayStatuses(nextMonth, { status: "error", reason: "SERVER_ERROR", message: "x" }, [CT_EQUIPMENT], range(), NOW);
    assert.ok([...loading.values()].every((status) => status.kind === "LOADING"));
    assert.ok([...failed.values()].every((status) => status.kind === "UNKNOWN"));
  });

  it("상태 표시: AVAILABLE·HELD·BOOKED·UNAVAILABLE 구분, 지난 슬롯은 원본 상태 유지 + 지난 시간", () => {
    const labels = (["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE"] as const).map((status) => month.getApiSlotStatusView({ status, startAt: `${nextMonth}T09:00` }, NOW).label);
    assert.deepEqual(labels, ["예약 가능", "선점 중", "예약 완료", "사용 불가"]);
    const past = month.getApiSlotStatusView({ status: "BOOKED", startAt: `${addDays(today, -1)}T09:00` }, NOW);
    assert.deepEqual([past.label, past.isPast], ["예약 완료", true]);
  });
});

describe("통신 계층 (searchManagementSlots)", () => {
  const window = { from: `${thisMonth}T00:00:00+09:00`, to: `${nextMonth}T00:00:00+09:00`, page: 0, size: 100 };

  it("view=MANAGEMENT로 보내고 모든 상태를 받는다", async () => {
    gateway.slots = [dto(nextMonth, 9, { status: "BOOKED" }), dto(nextMonth, 10, { status: "HELD" }), dto(nextMonth, 11, { status: "UNAVAILABLE" })];
    const result = await remote.searchManagementSlots(window);
    assert.equal(result.items.length, 3);
    assert.equal(gateway.calls[0].query?.view, "MANAGEMENT");
    assert.equal(gateway.calls[0].query?.status, undefined);
  });

  it("상태·장비 조건과 맞지 않는 응답은 PARSE", async () => {
    gateway.slots = [dto(nextMonth, 9, { status: "BOOKED" })];
    await assert.rejects(remote.searchManagementSlots({ ...window, status: "AVAILABLE" }), (error: unknown) => error instanceof ApiError && error.kind === "PARSE");
    await assert.rejects(remote.searchManagementSlots({ ...window, equipmentId: MRI_EQUIPMENT }), (error: unknown) => error instanceof ApiError && error.kind === "PARSE");
  });

  it("31일 초과·잘못된 상태는 요청하지 않는다", async () => {
    await assert.rejects(remote.searchManagementSlots({ ...window, to: `${addDays(thisMonth, 32)}T00:00:00+09:00` }), (error: unknown) => error instanceof ApiError && error.kind === "CONFIG");
    await assert.rejects(remote.searchManagementSlots({ ...window, status: "DONE" as never }), (error: unknown) => error instanceof ApiError && error.kind === "CONFIG");
    assert.deepEqual(gateway.calls, []);
  });
});

describe("서버 월 조회 (loadManagementMonthSlots)", () => {
  it("정상: 그 달 1일~다음 달 1일, 장비명·검사 유형명 매핑, 서버 endsAt 유지", async () => {
    gateway.slots = [dto(addDays(nextMonth, 1), 9, { status: "BOOKED" }), dto(addDays(nextMonth, 1), 10, { equipmentId: MRI_EQUIPMENT, examTypeId: MRI_TYPE })];
    const result = await server.loadManagementMonthSlots(nextMonth);
    assert.ok(result.ok);
    const slotQuery = gateway.calls.find((call) => call.path === "/api/v1/slots")!.query!;
    assert.equal(slotQuery.from, `${nextMonth}T00:00:00+09:00`);
    assert.equal(slotQuery.to, `${addMonths(nextMonth, 1)}T00:00:00+09:00`);
    assert.equal(slotQuery.view, "MANAGEMENT");
    assert.equal(slotQuery.institutionId, undefined, "기관 ID를 보내지 않는다 (서비스가 우리 기관으로 제한)");
    assert.deepEqual(
      result.slots.map((slot) => [slot.equipmentName, slot.examTypeName, slot.status, slot.endAt.slice(11)]),
      [
        ["CT-1", "흉부 CT", "BOOKED", "09:40"],
        ["MRI-1", "뇌 MRI", "AVAILABLE", "10:40"],
      ],
    );
  });

  it("100건 초과: hasNext로 모든 페이지를 모은다 (250건 = 3페이지)", async () => {
    gateway.slots = Array.from({ length: 250 }, (_, index) => dto(addDays(nextMonth, index % 20), 6 + (index % 12)));
    const result = await server.loadManagementMonthSlots(nextMonth);
    assert.equal(result.ok && result.slots.length, 250);
    assert.deepEqual(gateway.calls.filter((call) => call.path === "/api/v1/slots").map((call) => call.query?.page), [0, 1, 2]);
  });

  it("데이터 없는 달은 빈 목록 (성공)", async () => {
    const result = await server.loadManagementMonthSlots(nextMonth);
    assert.deepEqual(result.ok && result.slots, []);
  });

  it("지난 달(3달 전까지)은 조회, 그보다 이전·형식 오류는 요청 없이 거부", async () => {
    assert.equal((await server.loadManagementMonthSlots(addMonths(thisMonth, -3))).ok, true);
    gateway.calls = [];
    for (const bad of [addMonths(thisMonth, -4), `${today.slice(0, 7)}-15`, "2026-13-01", 42]) {
      const result = await server.loadManagementMonthSlots(bad);
      assert.equal(!result.ok && result.reason, "INVALID");
    }
    assert.deepEqual(dataCalls(), []);
  });

  it("검사기관이 아닌 계정·로그아웃은 Gateway 요청 없이 차단", async () => {
    for (const reason of ["FORBIDDEN_ROLE", "SIGNED_OUT", "UNAUTHORIZED"]) {
      gateway.calls = [];
      gateway.access = { ok: false, reason, message: "x" };
      const result = await server.loadManagementMonthSlots(nextMonth);
      assert.equal(!result.ok && result.reason, reason === "FORBIDDEN_ROLE" ? "FORBIDDEN" : reason);
      assert.deepEqual(dataCalls(), []);
    }
  });

  it("401·403·5xx·TIMEOUT·NETWORK·형식 오류를 구분한다 (Mock으로 대신하지 않는다)", async () => {
    const table: [ApiError, string][] = [
      [new ApiError("HTTP", "x", { status: 401 } as never), "UNAUTHORIZED"],
      [new ApiError("HTTP", "x", { status: 403, code: "FORBIDDEN" } as never), "FORBIDDEN"],
      [new ApiError("HTTP", "x", { status: 500 } as never), "SERVER_ERROR"],
      [new ApiError("HTTP", "x", { status: 503, code: "REFERENCE_SERVICE_UNAVAILABLE" } as never), "SERVER_ERROR"],
      [new ApiError("TIMEOUT", "x"), "TIMEOUT"],
      [new ApiError("NETWORK", "x"), "NETWORK"],
      [new ApiError("PARSE", "x"), "INVALID_RESPONSE"],
    ];
    for (const [error, reason] of table) {
      gateway.slotError = error;
      const result = await server.loadManagementMonthSlots(nextMonth);
      assert.equal(!result.ok && result.reason, reason);
    }
  });

  it("우리 기관 장비 목록에 없는 장비 슬롯·달 밖 슬롯이 오면 일부만 보여 주지 않고 실패", async () => {
    gateway.slots = [dto(nextMonth, 9), dto(nextMonth, 10, { equipmentId: OTHER_EQUIPMENT })];
    const unknown = await server.loadManagementMonthSlots(nextMonth);
    assert.equal(!unknown.ok && unknown.reason, "INVALID_RESPONSE");
    gateway.slots = [dto(addMonths(nextMonth, 1), 9)];
    const outside = await server.loadManagementMonthSlots(nextMonth);
    assert.equal(!outside.ok && outside.reason, "INVALID_RESPONSE");
  });

  it("슬롯 상세: 다른 기관 장비 슬롯은 FORBIDDEN, 우리 기관이면 장비명·검사 유형명", async () => {
    gateway.slots = [dto(nextMonth, 9, { status: "HELD" }), dto(nextMonth, 10, { equipmentId: OTHER_EQUIPMENT })];
    const own = await server.loadManagementSlotDetail(gateway.slots[0].id);
    assert.ok(own.ok);
    assert.deepEqual([own.slot.equipmentName, own.slot.examTypeName, own.slot.status], ["CT-1", "흉부 CT", "HELD"]);
    const other = await server.loadManagementSlotDetail(gateway.slots[1].id);
    assert.equal(!other.ok && other.reason, "FORBIDDEN");
    const bad = await server.loadManagementSlotDetail("not-uuid");
    assert.equal(!bad.ok && bad.reason, "INVALID");
  });
});

describe("슬롯 생성 후 갱신·Mock 분리", () => {
  // 렌더링으로 확인: 시각(useSeoulNow)만 고정한다. 서버 렌더링이라 월 조회 effect는 실행되지 않는다 (Gateway 요청 없음)
  // (ApiSlotSchedule은 .tsx라 mock.module로 바꿀 수 없어 실제 컴포넌트가 그린 문구로 구분한다)
  it("API 워크스페이스: slots 기능이 켜져 있으면 API 슬롯 일정(ApiSlotSchedule)을, 꺼져 있으면 기존 준비 중 달력을 그린다", async () => {
    const nowMock = mock.module("@/lib/date/useSeoulNow", { namedExports: { useSeoulNow: () => ({ dateKey: today, dateTime: NOW }) } });
    const features = process.env.NEXT_PUBLIC_API_FEATURES;
    try {
      const { default: EquipmentApiWorkspace } = await import("@/features/equipment/components/EquipmentApiWorkspace");
      const equipments = [
        { id: CT_EQUIPMENT, institutionId: OWN, name: "CT-1", modality: "CT", status: "OPERATIONAL" },
        { id: MRI_EQUIPMENT, institutionId: OWN, name: "MRI-1", modality: "MRI", status: "OPERATIONAL" },
      ] as const;
      const render = () =>
        renderToStaticMarkup(
          createElement(EquipmentApiWorkspace, { equipments: [...equipments], totalElements: 2, truncated: false, counts: { CT: 1, MRI: 1 } }),
        );

      process.env.NEXT_PUBLIC_API_FEATURES = "slots,equipment";
      const on = render();
      // ApiSlotSchedule: 월 캐시 상태로 달력·날짜 목록을 그린다 (날짜 선택 전 안내), 오늘 예약 가능 수는 월 캐시 조회 중
      assert.match(on, /달력에서 날짜를 선택하면 그날 슬롯을 보여 줍니다/);
      assert.match(on, /오늘 예약 가능 슬롯[\s\S]*?불러오는 중/);
      assert.doesNotMatch(on, /슬롯 목록 조회 기능이 서버에 아직 없어/);
      assert.equal(dataCalls().length, 0, "렌더링만으로 Gateway 요청을 보내지 않는다");

      process.env.NEXT_PUBLIC_API_FEATURES = "equipment";
      const off = render();
      // 기존 준비 중 달력: 날짜별 현황·선택 날짜 슬롯 모두 미연동 안내, 오늘 예약 가능 수는 준비 중
      assert.match(off, /슬롯 목록 조회 기능이 서버에 아직 없어 날짜별 슬롯 현황을 표시할 수 없습니다/);
      assert.match(off, /슬롯 목록 조회 기능이 서버에 아직 없어 선택 날짜의 슬롯\(시간·장비·상태\)을 표시할 수 없습니다/);
      assert.match(off, /조회 준비 중/);
      assert.doesNotMatch(off, /달력에서 날짜를 선택하면 그날 슬롯을 보여 줍니다/);
      assert.equal(dataCalls().length, 0);
    } finally {
      process.env.NEXT_PUBLIC_API_FEATURES = features;
      nowMock.restore();
    }
  });

  // 슬롯 생성 창 닫기는 클릭이 필요해 서버 렌더링으로 확인할 수 없다 (DOM 테스트 도구 없음). 소스의 JSX 연결만 확인한다
  it("API 워크스페이스(소스): 슬롯 생성 창의 onClose가 월 캐시를 invalidate한다. Mock 워크스페이스는 API 일정·조회를 쓰지 않는다", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../src/features/equipment/components/EquipmentApiWorkspace.tsx", import.meta.url), "utf8");
    // onClose 본문({ ... }) 안에서 invalidate()를 부른다 (저장소 변수 이름에는 의존하지 않는다)
    assert.match(source, /<ApiSlotGenerationDialog[^>]*?onClose=\{\(\) => \{[^}]*\.invalidate\(\);/);
    const mockWorkspace = readFileSync(new URL("../../src/features/equipment/components/EquipmentSlotWorkspace.tsx", import.meta.url), "utf8");
    assert.equal(mockWorkspace.includes("ApiSlotSchedule"), false);
    assert.equal(mockWorkspace.includes("managementActions"), false);
  });
});

describe("DaySlotList: Mock 회귀와 API 표시", () => {
  it("Mock(기본): 기존 상태 판정·소요 시간으로 종료 시각", async () => {
    const { default: DaySlotList } = await import("@/features/equipment/components/DaySlotList");
    const slot = { ...apiSlot(nextMonth, 9, "AVAILABLE") };
    const html = renderToStaticMarkup(
      createElement(DaySlotList, {
        date: nextMonth,
        state: { kind: "READY" },
        slots: [slot],
        scopeLabel: "전체 장비 1대",
        singleEquipmentName: null,
        otherEquipmentSlotCount: 0,
        slotMinutes: new Map([[CT_EQUIPMENT, 30]]),
        nowDateTime: NOW,
        onSelectSlot: () => {},
      }),
    );
    assert.match(html, /09:00<span[^>]*>~09:30<\/span>/);
    assert.match(html, />예약 가능</);
  });

  it("API: 서버 상태·서버 종료 시각, 지난 슬롯은 원본 상태 + 지난 시간", async () => {
    const { default: DaySlotList } = await import("@/features/equipment/components/DaySlotList");
    const past = apiSlot(addDays(today, -1), 9, "BOOKED");
    const html = renderToStaticMarkup(
      createElement(DaySlotList, {
        date: past.startAt.slice(0, 10),
        state: { kind: "READY" },
        slots: [past],
        scopeLabel: "전체 장비 1대",
        singleEquipmentName: null,
        otherEquipmentSlotCount: 0,
        slotMinutes: new Map(),
        nowDateTime: NOW,
        onSelectSlot: () => {},
        statusOf: (slot) => month.getApiSlotStatusView(slot as ApiExamSlot, NOW),
        endTimeOf: (slot) => (slot as ApiExamSlot).endAt.slice(11, 16),
      }),
    );
    assert.match(html, /09:00<span[^>]*>~09:40<\/span>/);
    assert.match(html, />예약 완료 · 지난 시간</);
  });
});
