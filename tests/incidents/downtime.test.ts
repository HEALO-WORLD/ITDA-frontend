import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ApiError } from "@/lib/api/errors";
import { getSeoulNow, addDays } from "@/lib/date/seoulDate";

/**
 * 장비 장애(중단) 등록 (API 모드) 단위·회귀 테스트. 실제 네트워크·DB 요청 없음.
 * - Gateway 요청(apiRequestData)·users/me(requireRoleAccess)·장비 목록·Next 캐시/헤더는 가짜로 바꾼다
 * - downtimeRules·remote(DTO 검증·응답 확인·오류 분류)·downtimeServer·downtimeActions는 실제 코드를 쓴다
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "33333333-3333-4333-8333-333333333333";
const EQUIPMENT = "55555555-5555-4555-8555-555555555555";
const OTHER_EQUIPMENT = "56666666-5555-4555-8555-555555555555";
const DOWNTIME = "77777777-7777-4777-8777-777777777777";
const SLOT = "44444444-4444-4444-8444-444444444444";
const RESERVATION = "aaaaaaaa-8888-4888-8888-888888888888";

// 시각: 실제 현재 시각 기준 (종료 > 현재 검증이 실제 시계를 쓴다)
const today = getSeoulNow().dateKey;
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);

type Access = { ok: true; headers: HeadersInit; user: { userId: string; institutionId: string } } | { ok: false; reason: string; message: string };
const okAccess: Access = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: USER, institutionId: ORG } };

type Call = { path: string; method: string; body?: unknown; headers?: HeadersInit; query?: Record<string, unknown> };

const responseFor = (body: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  id: DOWNTIME,
  equipmentId: body.equipmentId,
  startedAt: body.startedAt,
  endedAt: body.endedAt,
  reason: body.reason,
  affectedSlotCount: 3,
  conflictedSlots: [{ slotId: SLOT, status: "BOOKED", reservationId: RESERVATION }],
  ...overrides,
});

const state = {
  access: okAccess as Access,
  equipments: [{ id: EQUIPMENT, institutionId: ORG, name: "MRI-1", modality: "MRI", status: "OPERATIONAL" }] as unknown[] | Error,
  post: ((body: Record<string, unknown>) => responseFor(body)) as ((body: Record<string, unknown>) => unknown) | Error,
  incidentPage: { contents: [], totalElements: 0, totalPages: 0, size: 10, number: 0 } as unknown,
  calls: [] as Call[],
  order: [] as string[],
  refreshCount: 0,
  sameOrigin: true,
};

function reset() {
  state.access = okAccess;
  state.equipments = [{ id: EQUIPMENT, institutionId: ORG, name: "MRI-1", modality: "MRI", status: "OPERATIONAL" }];
  state.post = (body) => responseFor(body);
  state.incidentPage = { contents: [], totalElements: 0, totalPages: 0, size: 10, number: 0 };
  state.calls = [];
  state.order = [];
  state.refreshCount = 0;
  state.sameOrigin = true;
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "incidents,equipment";
  process.env.NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION = "true";
}

const httpError = (status: number, code: string | null = null) => new ApiError("HTTP", `HTTP ${status}`, { status, code });
const posts = () => state.calls.filter((call) => call.method === "POST");

let rules: typeof import("@/features/incidents/downtimeRules");
let remote: typeof import("@/features/incidents/remote");
let server: typeof import("@/features/incidents/downtimeServer");
let actions: typeof import("@/features/incidents/downtimeActions");
let incidentServer: typeof import("@/features/incidents/server");
let mockRules: typeof import("@/features/incidents/rules");
let Register: typeof import("@/features/incidents/components/IncidentDowntimeRegister").default;
let registerModule: typeof import("@/features/incidents/components/IncidentDowntimeRegister");
let config: typeof import("@/features/incidents/downtimeConfig");
let tracking: typeof import("@/features/incidents/downtimeTracking");

before(async () => {
  reset();
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        state.order.push(`users/me:${role}`);
        return state.access;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/features/equipment/remote", {
    namedExports: {
      EQUIPMENT_PAGE_MAX_SIZE: 100,
      fetchEquipmentPage: async (institutionId: string) => {
        state.order.push(`equipments:${institutionId}`);
        if (state.equipments instanceof Error) throw state.equipments;
        return { contents: state.equipments, totalElements: state.equipments.length, totalPages: 1, size: 100, number: 0 };
      },
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown; headers?: HeadersInit; query?: Record<string, unknown> } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ path, method, body: options.body, headers: options.headers, ...(options.query ? { query: options.query } : {}) });
        state.order.push(`${method} ${path}`);
        if (method === "POST" && path === "/api/v1/equipment-downtimes") {
          if (state.post instanceof Error) throw state.post;
          return state.post(options.body as Record<string, unknown>);
        }
        if (path === "/api/v1/equipment-incidents") return state.incidentPage;
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => state.sameOrigin } });
  mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {} }), unstable_rethrow: () => {} } });

  rules = await import("@/features/incidents/downtimeRules");
  remote = await import("@/features/incidents/remote");
  server = await import("@/features/incidents/downtimeServer");
  actions = await import("@/features/incidents/downtimeActions");
  incidentServer = await import("@/features/incidents/server");
  mockRules = await import("@/features/incidents/rules");
  config = await import("@/features/incidents/downtimeConfig");
  tracking = await import("@/features/incidents/downtimeTracking");
  registerModule = await import("@/features/incidents/components/IncidentDowntimeRegister");
  Register = registerModule.default;
});

beforeEach(reset);

const form = (overrides: Record<string, unknown> = {}) => ({
  equipmentId: EQUIPMENT,
  startedAt: `${yesterday}T09:00`,
  endedAt: `${tomorrow}T18:00`,
  reason: "  MRI 장비 냉각 시스템 오류 ",
  ...overrides,
});

const quiet = async <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

// ── 1. 입력 규칙·한국 시간 변환 ──

describe("downtimeRules", () => {
  const ctx = (nowDateTime = `${today}T12:00`) => ({ equipmentIds: new Set([EQUIPMENT]), nowDateTime });

  it("한국 시간 → +09:00 OffsetDateTime (시간대와 관계없이 문자열 그대로)", () => {
    assert.equal(rules.toSeoulOffsetDateTime("2026-11-06T10:00"), "2026-11-06T10:00:00+09:00");
    assert.equal(rules.toSeoulOffsetDateTime("2026-12-31T23:59"), "2026-12-31T23:59:00+09:00");
    for (const bad of ["2026-02-30T10:00", "2026-11-06T24:00", "2026-11-06T10:60", "2026-11-06 10:00", "2026-11-06T10:00:00", ""]) {
      assert.equal(rules.toSeoulOffsetDateTime(bad), null, bad);
    }
    assert.equal(rules.toSeoulOffsetDateTime("2028-02-29T00:00"), "2028-02-29T00:00:00+09:00");
  });

  it("정상 입력은 오류 없음 (시작은 과거 허용)", () => {
    assert.deepEqual(rules.validateDowntimeForm(form({ startedAt: "2020-01-01T00:00" }), ctx()), {});
  });

  it("필수값 누락", () => {
    const errors = rules.validateDowntimeForm({ equipmentId: "", startedAt: "", endedAt: "", reason: "   " }, ctx());
    assert.deepEqual(Object.keys(errors).sort(), ["endedAt", "equipmentId", "reason", "startedAt"]);
  });

  it("목록에 없는 장비·형식이 틀린 장비 ID는 거절", () => {
    assert.ok(rules.validateDowntimeForm(form({ equipmentId: OTHER_EQUIPMENT }), ctx()).equipmentId);
    assert.ok(rules.validateDowntimeForm(form({ equipmentId: "not-a-uuid" }), ctx()).equipmentId);
    assert.deepEqual(rules.validateDowntimeForm(form({ equipmentId: EQUIPMENT.toUpperCase() }), ctx()), {});
  });

  it("종료가 시작보다 빠르거나 같으면 거절", () => {
    assert.match(rules.validateDowntimeForm(form({ startedAt: `${tomorrow}T18:00`, endedAt: `${tomorrow}T17:00` }), ctx()).endedAt ?? "", /시작 일시 이후/);
    assert.match(rules.validateDowntimeForm(form({ startedAt: `${tomorrow}T18:00`, endedAt: `${tomorrow}T18:00` }), ctx()).endedAt ?? "", /시작 일시 이후/);
  });

  it("종료가 현재 이전·같으면 거절", () => {
    assert.match(rules.validateDowntimeForm(form({ endedAt: `${today}T11:59` }), ctx()).endedAt ?? "", /현재 시각 이후/);
    assert.match(rules.validateDowntimeForm(form({ endedAt: `${today}T12:00` }), ctx()).endedAt ?? "", /현재 시각 이후/);
    assert.deepEqual(rules.validateDowntimeForm(form({ endedAt: `${today}T12:01` }), ctx()), {});
  });

  it("사유: 공백만은 거절, 500자(UTF-16 단위, 앞뒤 공백 제외)까지 허용, 501자 거절", () => {
    assert.ok(rules.validateDowntimeForm(form({ reason: " \n\t " }), ctx()).reason);
    assert.equal(rules.validateDowntimeForm(form({ reason: `  ${"가".repeat(500)}  ` }), ctx()).reason, undefined);
    assert.match(rules.validateDowntimeForm(form({ reason: "가".repeat(501) }), ctx()).reason ?? "", /500자/);
    // 이모지는 Java String.length처럼 2로 센다
    assert.equal(rules.downtimeReasonLength("😀"), 2);
    assert.ok(rules.validateDowntimeForm(form({ reason: "😀".repeat(251) }), ctx()).reason);
  });
});

// ── 2. 요청·응답 DTO ──

describe("createEquipmentDowntime (remote)", () => {
  const body = { equipmentId: EQUIPMENT, startedAt: "2026-11-06T10:00:00+09:00", endedAt: "2026-11-06T14:00:00+09:00", reason: " 냉각 오류 " };

  it("POST /api/v1/equipment-downtimes 에 DTO 필드만 보내고(사유 trim) 응답을 그대로 돌려준다", async () => {
    const result = await remote.createEquipmentDowntime({ ...body, institutionId: ORG } as never);
    assert.deepEqual(posts(), [
      { path: "/api/v1/equipment-downtimes", method: "POST", body: { ...body, reason: "냉각 오류" }, headers: undefined },
    ]);
    assert.equal(result.id, DOWNTIME);
    assert.equal(result.affectedSlotCount, 3);
    assert.deepEqual(result.conflictedSlots, [{ slotId: SLOT, status: "BOOKED", reservationId: RESERVATION }]);
  });

  it("응답 시각 표기가 달라도 같은 순간이면 받는다 (Z 등)", async () => {
    state.post = (b) => responseFor(b, { startedAt: "2026-11-06T01:00:00Z", endedAt: "2026-11-06T05:00:00.000Z" });
    assert.equal((await remote.createEquipmentDowntime(body)).id, DOWNTIME);
  });

  it("요청 전 검증에 걸리면 보내지 않는다 (CONFIG → NOT_SENT)", async () => {
    for (const bad of [
      { equipmentId: "x" },
      { startedAt: "2026-11-06T10:00:00" },
      { endedAt: "2026-11-06T09:00:00+09:00" },
      { reason: "   " },
      { reason: "a".repeat(501) },
    ]) {
      await assert.rejects(remote.createEquipmentDowntime({ ...body, ...bad }), (error: unknown) => {
        assert.equal(remote.getDowntimeCreateFailure(error).reason, "NOT_SENT");
        return true;
      });
    }
    assert.equal(posts().length, 0);
  });

  it("응답이 계약과 다르거나 요청과 다르면 PARSE (보정하지 않음)", async () => {
    const cases: Record<string, unknown>[] = [
      { id: "bad" },
      { equipmentId: OTHER_EQUIPMENT },
      { startedAt: "2026-11-06T11:00:00+09:00" },
      { reason: "다른 사유" },
      { affectedSlotCount: -1 },
      { affectedSlotCount: "3" },
      { conflictedSlots: null },
      { conflictedSlots: [{ slotId: SLOT, status: "AVAILABLE", reservationId: null }] },
      { conflictedSlots: [{ slotId: "x", status: "HELD", reservationId: null }] },
    ];
    for (const override of cases) {
      state.post = (b) => responseFor(b, override);
      await assert.rejects(remote.createEquipmentDowntime(body), (error: unknown) => {
        const failure = remote.getDowntimeCreateFailure(error);
        assert.equal(failure.reason, "INVALID_RESPONSE", JSON.stringify(override));
        assert.equal(remote.DOWNTIME_CREATE_UNCERTAIN.has(failure.reason), true);
        return true;
      });
    }
  });

  it("conflictedSlots의 reservationId null은 그대로 받는다", async () => {
    state.post = (b) => responseFor(b, { conflictedSlots: [{ slotId: SLOT, status: "HELD", reservationId: null }] });
    assert.equal((await remote.createEquipmentDowntime(body)).conflictedSlots[0].reservationId, null);
  });

  it("incidents가 API 대상이 아니면 요청하지 않는다", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    await assert.rejects(remote.createEquipmentDowntime(body), { kind: "CONFIG" });
    assert.equal(posts().length, 0);
  });
});

describe("getDowntimeCreateFailure", () => {
  const cases: [unknown, string, boolean][] = [
    [httpError(400, "VALIDATION_FAILED"), "INVALID_REQUEST", false],
    [httpError(400, "DOWNTIME_INVALID_TIME_RANGE"), "INVALID_REQUEST", false],
    [httpError(400, "DOWNTIME_END_NOT_FUTURE"), "INVALID_REQUEST", false],
    [httpError(400, "MISSING_HEADER"), "UNAUTHORIZED", false],
    [httpError(401, "TOKEN_EXPIRED"), "UNAUTHORIZED", false],
    [httpError(403, "FORBIDDEN"), "FORBIDDEN", false],
    [httpError(403, "ACCESS_DENIED"), "FORBIDDEN", false],
    [httpError(404, "RESOURCE_NOT_FOUND"), "NOT_FOUND", false],
    [httpError(409, "DOWNTIME_OVERLAP"), "OVERLAP", false],
    [httpError(409, "SOMETHING_ELSE"), "CONFLICT", false],
    [httpError(502, "REFERENCE_RESPONSE_INVALID"), "REFERENCE_UNAVAILABLE", false],
    [httpError(503, "REFERENCE_SERVICE_UNAVAILABLE"), "REFERENCE_UNAVAILABLE", false],
    [httpError(500), "SERVER_ERROR", true],
    [httpError(503), "SERVER_ERROR", true],
    [new ApiError("NETWORK", "x"), "NETWORK", true],
    [new ApiError("ABORTED", "x"), "NETWORK", true],
    [new ApiError("TIMEOUT", "x"), "TIMEOUT", true],
    [new ApiError("PARSE", "x"), "INVALID_RESPONSE", true],
    [new Error("x"), "SERVER_ERROR", true],
  ];
  for (const [error, reason, uncertain] of cases) {
    const label = error instanceof ApiError ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "일반 Error";
    it(`${label} → ${reason}${uncertain ? " (결과 불명)" : ""}`, () => {
      const failure = remote.getDowntimeCreateFailure(error);
      assert.equal(failure.reason, reason);
      assert.equal(remote.DOWNTIME_CREATE_UNCERTAIN.has(failure.reason), uncertain);
      assert.ok(failure.message.length > 0);
      assert.equal(failure.message.includes("HTTP"), false);
    });
  }
  it("시간 오류 코드는 종료 예정 일시 칸에 표시한다", () => {
    assert.equal(remote.getDowntimeCreateFailure(httpError(400, "DOWNTIME_END_NOT_FUTURE")).field, "endedAt");
    assert.equal(remote.getDowntimeCreateFailure(httpError(400, "DOWNTIME_INVALID_TIME_RANGE")).field, "endedAt");
  });
  it("409 겹침은 성공이 아니며 앞선 등록 가능성을 안내한다", () => {
    assert.match(remote.getDowntimeCreateFailure(httpError(409, "DOWNTIME_OVERLAP")).message, /등록하지 않았습니다.*목록을 확인/);
  });
});

// ── 3. 서버 처리 ──

describe("submitEquipmentDowntime", () => {
  it("성공: users/me → 장비 목록 → POST 1회, +09:00 본문, 기관·역할 헤더 없음", async () => {
    const result = await server.submitEquipmentDowntime(form());
    assert.equal(result.ok, true);
    assert.deepEqual(state.order, ["users/me:EXAMINING", `equipments:${ORG}`, "POST /api/v1/equipment-downtimes"]);
    const [call] = posts();
    assert.deepEqual(call.body, {
      equipmentId: EQUIPMENT,
      startedAt: `${yesterday}T09:00:00+09:00`,
      endedAt: `${tomorrow}T18:00:00+09:00`,
      reason: "MRI 장비 냉각 시스템 오류",
    });
    assert.deepEqual(call.headers, { Authorization: "Bearer test" });
    if (result.ok) {
      assert.equal(result.message, "장비 장애가 등록되었습니다. 영향받은 예약과 의뢰의 후속 처리는 순차적으로 반영됩니다.");
      assert.equal(result.downtimeId, DOWNTIME);
      assert.equal(result.affectedSlotCount, 3);
      assert.equal(result.conflictedSlotCount, 1);
      assert.equal("incidentId" in result, false);
      assert.equal(JSON.stringify(result).includes("Bearer"), false);
    }
  });

  it("기능 스위치가 꺼져 있으면(기본) 아무 요청도 하지 않는다", async () => {
    for (const value of [undefined, "", "false", "1"]) {
      if (value === undefined) delete process.env.NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION;
      else process.env.NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION = value;
      assert.equal(config.isDowntimeRegistrationEnabled(), false);
      const result = await server.submitEquipmentDowntime(form());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "NOT_AVAILABLE");
    }
    process.env.NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION = "true";
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    assert.equal(config.isDowntimeRegistrationEnabled(), false, "Mock 모드에서는 꺼짐");
    assert.deepEqual(state.order, []);
  });

  it("인증·역할 실패는 데이터 요청 전에 멈춘다", async () => {
    for (const [reason, expected] of [["SIGNED_OUT", "SIGNED_OUT"], ["UNAUTHORIZED", "UNAUTHORIZED"], ["FORBIDDEN_ROLE", "FORBIDDEN"]] as const) {
      reset();
      state.access = { ok: false, reason, message: "x" };
      const result = await server.submitEquipmentDowntime(form());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, expected);
      assert.deepEqual(state.order, ["users/me:EXAMINING"]);
    }
  });

  it("장비 목록 조회 실패면 등록하지 않는다 (임의 장비 ID로 보내지 않음)", async () => {
    state.equipments = new ApiError("NETWORK", "x");
    const result = await quiet(() => server.submitEquipmentDowntime(form()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "EQUIPMENT_LOOKUP_FAILED");
    assert.equal(posts().length, 0);
  });

  it("다른 기관 장비·목록에 없는 장비·입력 오류는 POST하지 않고 필드 오류를 돌려준다", async () => {
    state.equipments = [
      { id: EQUIPMENT, institutionId: ORG, name: "MRI-1", modality: "MRI", status: "OPERATIONAL" },
      { id: OTHER_EQUIPMENT, institutionId: OTHER_ORG, name: "타기관", modality: "CT", status: "OPERATIONAL" },
    ];
    const cases: [Record<string, unknown>, string][] = [
      [{ equipmentId: OTHER_EQUIPMENT }, "equipmentId"],
      [{ equipmentId: "bad" }, "equipmentId"],
      [{ startedAt: "" }, "startedAt"],
      [{ endedAt: `${yesterday}T10:00` }, "endedAt"],
      [{ startedAt: `${tomorrow}T19:00` }, "endedAt"],
      [{ reason: "" }, "reason"],
      [{ reason: "a".repeat(501) }, "reason"],
    ];
    for (const [override, field] of cases) {
      const result = await server.submitEquipmentDowntime(form(override));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "INVALID_INPUT");
        assert.ok(result.fieldErrors?.[field as "reason"], `${JSON.stringify(override)} → ${field}`);
      }
    }
    assert.equal(posts().length, 0);
    assert.equal((await server.submitEquipmentDowntime(null)).ok, false);
    assert.equal(posts().length, 0);
  });

  const postFailures: [string, unknown, string, boolean][] = [
    ["400 시간 범위", httpError(400, "DOWNTIME_INVALID_TIME_RANGE"), "INVALID_REQUEST", false],
    ["400 종료 과거", httpError(400, "DOWNTIME_END_NOT_FUTURE"), "INVALID_REQUEST", false],
    ["401", httpError(401), "UNAUTHORIZED", false],
    ["403", httpError(403, "FORBIDDEN"), "FORBIDDEN", false],
    ["404", httpError(404, "RESOURCE_NOT_FOUND"), "NOT_FOUND", false],
    ["409 겹침", httpError(409, "DOWNTIME_OVERLAP"), "OVERLAP", false],
    ["500", httpError(500), "SERVER_ERROR", true],
    ["503 기준정보", httpError(503, "REFERENCE_SERVICE_UNAVAILABLE"), "REFERENCE_UNAVAILABLE", false],
    ["TIMEOUT", new ApiError("TIMEOUT", "x"), "TIMEOUT", true],
    ["NETWORK", new ApiError("NETWORK", "x"), "NETWORK", true],
    ["PARSE", new ApiError("PARSE", "x"), "INVALID_RESPONSE", true],
  ];
  for (const [label, error, reason, uncertain] of postFailures) {
    it(`POST ${label} → ${reason}${uncertain ? " (결과 불명, 재전송 없음)" : ""}`, async () => {
      state.post = error as Error;
      const result = await quiet(() => server.submitEquipmentDowntime(form()));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, reason);
        assert.equal(result.uncertain === true, uncertain);
      }
      assert.equal(posts().length, 1, "자동 재시도하지 않는다");
    });
  }

  it("같은 사용자·장비 요청이 처리 중이면 두 번째는 POST하지 않는다", async () => {
    let release: () => void = () => {};
    state.post = (body) => new Promise((resolve) => (release = () => resolve(responseFor(body))));
    const first = server.submitEquipmentDowntime(form());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await server.submitEquipmentDowntime(form({ equipmentId: EQUIPMENT.toUpperCase() }));
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.reason, "IN_PROGRESS");
      assert.equal(second.uncertain, true);
    }
    release();
    assert.equal((await first).ok, true);
    assert.equal(posts().length, 1);
    state.post = (body) => responseFor(body);
    assert.equal((await server.submitEquipmentDowntime(form())).ok, true);
    assert.equal(posts().length, 2);
  });
});

// ── 4. Server Function (CSRF·화면 갱신) ──

describe("registerEquipmentDowntimeAction", () => {
  it("다른 출처 요청은 아무것도 하지 않는다", async () => {
    state.sameOrigin = false;
    const result = await actions.registerEquipmentDowntimeAction(form());
    assert.equal(result.ok, false);
    assert.deepEqual(state.order, []);
    assert.equal(state.refreshCount, 0);
  });

  it("성공·결과 불명·409 겹침이면 화면을 다시 불러오고, 입력 오류·403은 그대로 둔다", async () => {
    assert.equal((await actions.registerEquipmentDowntimeAction(form())).ok, true);
    assert.equal(state.refreshCount, 1);
    for (const [error, refreshed] of [
      [new ApiError("TIMEOUT", "x"), true],
      [httpError(409, "DOWNTIME_OVERLAP"), true],
      [httpError(403, "FORBIDDEN"), false],
    ] as const) {
      reset();
      state.post = error;
      await quiet(() => actions.registerEquipmentDowntimeAction(form()));
      assert.equal(state.refreshCount, refreshed ? 1 : 0, `${(error as ApiError).kind} ${(error as ApiError).code ?? ""}`);
    }
    reset();
    await actions.registerEquipmentDowntimeAction(form({ reason: "" }));
    assert.equal(state.refreshCount, 0);
  });

  it("Kafka 후속 처리 전: 등록 성공 뒤 장애 목록이 비어 있어도 목록 조회는 그대로 동작한다 (임의로 채우지 않음)", async () => {
    const created = await actions.registerEquipmentDowntimeAction(form());
    assert.equal(created.ok, true);
    const list = await incidentServer.loadIncidentPage(0);
    assert.equal(list.ok, true);
    if (list.ok) assert.equal(list.items.length, 0);
    // 등록 응답 ID로 장애 상세를 부르지 않는다
    assert.equal(state.calls.some((call) => call.path.includes(DOWNTIME)), false);
  });
});

// ── 5. 버튼 표시·회귀 ──

describe("IncidentDowntimeRegister 버튼", () => {
  const render = (equipments: unknown) => renderToStaticMarkup(createElement(Register, { equipments } as never));
  it("장비 목록이 있으면 등록 버튼 활성", () => {
    const html = render([{ id: EQUIPMENT, name: "MRI-1", modality: "MRI" }]);
    assert.match(html, /장비 장애 등록/);
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*aria-haspopup/);
  });
  it("장비 목록 조회 실패·장비 없음이면 비활성 + 이유", () => {
    assert.match(render(null), /disabled=""[^>]*title="장비 목록을 불러오지 못해/);
    assert.match(render([]), /disabled=""[^>]*title="등록된 장비가 없습니다/);
  });
});

describe("회귀", () => {
  it("Mock 장애 등록 규칙(occurredAt 모델)은 그대로다", () => {
    const now = "2026-11-05T12:00";
    const ok = mockRules.validateIncidentRegister(
      { equipmentId: "eq-1", occurredAt: "2026-11-05T11:00", reason: "고장" },
      { organizationEquipmentIds: new Set(["eq-1"]), activeEquipmentIds: new Set(), nowDateTime: now },
    );
    assert.deepEqual(ok, {});
    const future = mockRules.validateIncidentRegister(
      { equipmentId: "eq-1", occurredAt: "2026-11-05T13:00", reason: "x".repeat(201) },
      { organizationEquipmentIds: new Set(["eq-1"]), activeEquipmentIds: new Set(), nowDateTime: now },
    );
    assert.ok(future.occurredAt && future.reason);
    assert.equal(mockRules.INCIDENT_REASON_MAX_LENGTH, 200);
  });

  it("장애 목록 조회는 GET /api/v1/equipment-incidents 그대로 (기관 ID를 보내지 않음)", async () => {
    state.incidentPage = {
      contents: [
        {
          incidentId: "12121212-1212-4121-8121-121212121212",
          equipmentId: EQUIPMENT,
          institutionId: ORG,
          reason: "고장",
          status: "OCCURRED",
          occurredAt: "2026-11-05T09:00:00",
          startAt: "2026-11-05T09:00:00",
          endAt: "2026-11-05T18:00:00",
          createdAt: "2026-11-05T09:00:01",
        },
      ],
      totalElements: 1,
      totalPages: 1,
      size: 10,
      number: 0,
    };
    const list = await incidentServer.loadIncidentPage(0, EQUIPMENT);
    assert.equal(list.ok, true);
    if (list.ok) assert.equal(list.items.length, 1);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].method, "GET");
    assert.equal(state.calls[0].path, "/api/v1/equipment-incidents");
  });

  it("장애 목록 조회 실패는 Mock으로 대체하지 않고 실패로 돌려준다", async () => {
    state.access = { ok: false, reason: "SIGNED_OUT", message: "x" };
    const list = await incidentServer.loadIncidentPage(0);
    assert.equal(list.ok, false);
    assert.equal(state.calls.length, 0);
  });
});

// ── 6. 24시간제 시각 입력 ──

describe("시각 입력 (TimeInput)", () => {
  it("HH:mm·H:mm·HHmm·Hmm을 HH:mm으로 맞춘다", () => {
    const { normalizeTimeInput } = registerModule;
    assert.equal(normalizeTimeInput("09:30"), "09:30");
    assert.equal(normalizeTimeInput("9:30"), "09:30");
    assert.equal(normalizeTimeInput("930"), "09:30");
    assert.equal(normalizeTimeInput("2238"), "22:38");
    assert.equal(normalizeTimeInput(" 14:00 "), "14:00");
    assert.equal(normalizeTimeInput("00:00"), "00:00");
    assert.equal(normalizeTimeInput("23:59"), "23:59");
  });

  it("범위 밖·불완전한 값은 null (입력값은 그대로 둔다)", () => {
    const { normalizeTimeInput } = registerModule;
    for (const bad of ["24:00", "23:60", "9", "9:3", "12:", ":30", "12345", "ab:cd", "", "9:300", "-1:00"]) {
      assert.equal(normalizeTimeInput(bad), null, bad);
    }
  });

  it("입력은 숫자·콜론만, 최대 5자", () => {
    const { sanitizeTimeInput } = registerModule;
    assert.equal(sanitizeTimeInput("09:30 오전"), "09:30");
    assert.equal(sanitizeTimeInput("1a2b3"), "123");
    assert.equal(sanitizeTimeInput("12:345"), "12:34");
  });

  it("↑/↓ 1분·10분 이동, 하루 안에서 순환", () => {
    const { stepTime } = registerModule;
    assert.equal(stepTime("09:30", 1), "09:31");
    assert.equal(stepTime("09:30", -10), "09:20");
    assert.equal(stepTime("23:59", 1), "00:00");
    assert.equal(stepTime("00:05", -10), "23:55");
  });

  it("맞춘 시각으로 만든 구간은 기존 규칙·+09:00 변환을 그대로 통과한다", () => {
    const { normalizeTimeInput } = registerModule;
    const startedAt = `${yesterday}T${normalizeTimeInput("930")}`;
    const endedAt = `${tomorrow}T${normalizeTimeInput("2238")}`;
    assert.deepEqual(rules.validateDowntimeForm(form({ startedAt, endedAt }), { equipmentIds: new Set([EQUIPMENT]), nowDateTime: `${today}T12:00` }), {});
    assert.equal(rules.toSeoulOffsetDateTime(endedAt), `${tomorrow}T22:38:00+09:00`);
  });

  it("처음 연 화면: 브라우저 시간 선택(type=time)을 쓰지 않고, 오류를 미리 보여 주지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(registerModule.DowntimeRegisterForm, {
        equipments: [{ id: EQUIPMENT, name: "MRI-1", modality: "MRI" }],
        pending: false,
        failure: null,
        onSubmit: () => {},
      }),
    );
    assert.doesNotMatch(html, /type="time"/);
    assert.equal((html.match(/inputMode="numeric"|inputmode="numeric"/g) ?? []).length, 2);
    assert.equal((html.match(/placeholder="HH:mm"/g) ?? []).length, 2);
    // 시작 시각 기본값 = 연 시점의 한국 시각, 종료 예정은 빈 값
    assert.match(html, new RegExp(`id="downtime-start-time"[^>]*value="${getSeoulNow().dateTime.slice(11, 16)}"|value="${getSeoulNow().dateTime.slice(11, 16)}"[^>]*id="downtime-start-time"`));
    assert.match(html, /id="downtime-end-time"[^>]*value=""|value=""[^>]*id="downtime-end-time"/);
    assert.doesNotMatch(html, /aria-invalid="true"/);
    // 오류 문구 칸(…-error)은 비어 있다 (필수 표시 * 는 오류가 아니다)
    assert.doesNotMatch(html, /-error"[^>]*>[^<]+</);
  });

  it("서버가 돌려준 칸별 오류는 해당 입력칸 아래에 보여 준다", () => {
    const html = renderToStaticMarkup(
      createElement(registerModule.DowntimeRegisterForm, {
        equipments: [{ id: EQUIPMENT, name: "MRI-1", modality: "MRI" }],
        pending: false,
        failure: { ok: false, reason: "INVALID_REQUEST", message: "종료 예정 일시는 현재 시각 이후여야 합니다.", fieldErrors: { endedAt: "종료 예정 일시는 현재 시각 이후여야 합니다." } },
        onSubmit: () => {},
      }),
    );
    assert.match(html, /id="downtime-end-error"[^>]*>종료 예정 일시는 현재 시각 이후여야 합니다/);
    assert.match(html, /id="downtime-end-time"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*id="downtime-end-time"/);
  });
});

// ── 6-1. 등록 대화상자 레이아웃 (장비 등록 모달과 같은 form2·2단·하단 고정 버튼) ──

describe("장애 등록 대화상자 레이아웃", () => {
  type ButtonProps = { disabled?: boolean; form?: string; type?: string; onClick?: () => void; children?: unknown };
  const buttonsOf = (node: unknown, found: { props: ButtonProps }[] = []): { props: ButtonProps }[] => {
    if (Array.isArray(node)) node.forEach((child) => buttonsOf(child, found));
    else if (node && typeof node === "object" && "props" in node) {
      const element = node as { type: unknown; props: ButtonProps };
      if (element.type === "button") found.push(element);
      buttonsOf(element.props.children, found);
    }
    return found;
  };
  const formHtml = () =>
    renderToStaticMarkup(
      createElement(registerModule.DowntimeRegisterForm, {
        equipments: [{ id: EQUIPMENT, name: "MRI-1", modality: "MRI" }],
        pending: false,
        failure: null,
        onSubmit: () => {},
      }),
    );

  it("모달은 form2(980px)이고 버튼 줄은 Modal footer에 둔다 (다른 모달 크기는 그대로)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/features/incidents/components/IncidentDowntimeRegister.tsx", "utf8");
    assert.match(source, /<Modal\b[^>]*\btitle="장비 장애 등록"[^>]*\bsize="form2"/);
    assert.match(source, /footer=\{[^}]*<DowntimeRegisterActions /);
    // Mock 장애 화면(IncidentBoard)의 등록·상세 모달은 바꾸지 않는다
    const board = readFileSync("src/features/incidents/components/IncidentBoard.tsx", "utf8");
    assert.match(board, /<Modal\s+open=\{isRegisterOpen\}\s+title="장비 장애 등록"/);
    assert.doesNotMatch(board, /size="form2"/);
  });

  it("860px 이상 2단(왼쪽 장애 장비·사유 5 : 오른쪽 시작·종료 예정 일시 7), 좁으면 1단", () => {
    const html = formHtml();
    assert.match(html, /<form id="downtime-register-form"/);
    assert.match(html, /class="grid grid-cols-1 gap-x-8 gap-y-5 min-\[860px\]:grid-cols-\[minmax\(0,5fr\)_minmax\(0,7fr\)\]"/);
    const grid = html.indexOf("min-[860px]:grid-cols-");
    const columns = [...html.slice(grid).matchAll(/<div class="flex min-w-0 flex-col gap-5">/g)].map((match) => grid + (match.index ?? 0));
    assert.equal(columns.length, 2);
    const at = (id: string) => html.indexOf(`id="${id}"`);
    // 왼쪽 열: 장비 → 사유 / 오른쪽 열: 시작 → 종료 예정
    assert.ok(columns[0] < at("downtime-equipment") && at("downtime-equipment") < at("downtime-reason") && at("downtime-reason") < columns[1]);
    assert.ok(columns[1] < at("downtime-start-time") && at("downtime-start-time") < at("downtime-end-time"));
    // 안내 문구는 2단 아래 전체 폭, 폼 안에는 제출 버튼이 없다 (footer 버튼이 form 속성으로 제출)
    assert.ok(html.indexOf("중단 기간만 저장합니다") > at("downtime-end-time"));
    assert.doesNotMatch(html, /type="submit"/);
    assert.doesNotMatch(html, />취소</);
  });

  it("footer 버튼: 평소 [취소][장애 등록], 요청 중 [등록 중] 비활성 + 안내(취소는 그대로 눌러 닫을 수 있다), 결과 불확실 [닫기][목록에서 확인 필요] 비활성", () => {
    const { DowntimeRegisterActions, DOWNTIME_FORM_ID } = registerModule;
    let cancelled = 0;
    const onCancel = () => cancelled++;
    const idle = buttonsOf(DowntimeRegisterActions({ pending: false, failure: null, onCancel }));
    assert.deepEqual(idle.map((button) => [button.props.children, Boolean(button.props.disabled)]), [["취소", false], ["장애 등록", false]]);
    assert.equal(idle[1].props.type, "submit");
    assert.equal(idle[1].props.form, DOWNTIME_FORM_ID);
    idle[0].props.onClick?.();
    assert.equal(cancelled, 1);

    const pendingHtml = renderToStaticMarkup(createElement(DowntimeRegisterActions, { pending: true, failure: null, onCancel }));
    assert.match(pendingHtml, /<button type="submit" form="downtime-register-form" disabled=""[^>]*>등록 중<\/button>/);
    assert.match(pendingHtml, /<button type="button"[^>]*>취소<\/button>/);
    assert.doesNotMatch(pendingHtml, /<button type="button" disabled/);
    assert.match(pendingHtml, /창을 닫아도 등록 요청은 계속 처리되며/);

    const uncertain = buttonsOf(
      DowntimeRegisterActions({ pending: false, failure: { ok: false, reason: "NETWORK", message: "x", uncertain: true }, onCancel }),
    );
    assert.deepEqual(uncertain.map((button) => [button.props.children, Boolean(button.props.disabled)]), [["닫기", false], ["목록에서 확인 필요", true]]);
  });
});

// ── 7. 등록 뒤 장애 목록 반영 자동 확인 ──

const INCIDENT_ID = "12121212-1212-4121-8121-121212121212";
const incidentOf = (overrides: Record<string, unknown> = {}) => ({
  incidentId: INCIDENT_ID,
  equipmentId: EQUIPMENT,
  institutionId: ORG,
  reason: "MRI 장비 냉각 시스템 오류",
  status: "OCCURRED",
  occurredAt: `${getSeoulNow().dateTime}:30`,
  startAt: `${yesterday}T09:00:00`,
  endAt: `${tomorrow}T18:00:00`,
  createdAt: `${getSeoulNow().dateTime}:31`,
  ...overrides,
});
const pageOf = (contents: unknown[]) => ({ contents, totalElements: contents.length, totalPages: 1, size: 10, number: 0 });

describe("isRegisteredIncident (등록 건 식별)", () => {
  const match = () => ({
    equipmentId: EQUIPMENT,
    startAt: `${yesterday}T09:00:00`,
    endAt: `${tomorrow}T18:00:00`,
    reason: "MRI 장비 냉각 시스템 오류",
    registeredAt: getSeoulNow().dateTime,
  });

  it("장비·시작·종료·사유가 같고 등록 이후 발생한 장애만 같은 건으로 본다 (초·소수 표기 차이는 같다)", () => {
    assert.equal(tracking.isRegisteredIncident(incidentOf(), match()), true);
    assert.equal(tracking.isRegisteredIncident(incidentOf({ startAt: `${yesterday}T09:00`, endAt: `${tomorrow}T18:00:00.000000` }), match()), true);
    assert.equal(tracking.isRegisteredIncident(incidentOf({ equipmentId: EQUIPMENT.toUpperCase() }), match()), true);
  });

  it("하나라도 다르면 다른 장애로 본다 (잘못 '반영됨'으로 판단하지 않음)", () => {
    for (const override of [
      { equipmentId: OTHER_EQUIPMENT },
      { startAt: `${yesterday}T09:01:00` },
      { endAt: `${tomorrow}T18:00:01` },
      { reason: "다른 사유" },
      { occurredAt: "2020-01-01T00:00:00" },
      { startAt: "bad" },
      { occurredAt: "bad" },
    ]) {
      assert.equal(tracking.isRegisteredIncident(incidentOf(override), match()), false, JSON.stringify(override));
    }
  });

  it("발생 시각은 서버 간 시계 차이 2분까지 허용", () => {
    const m = { ...match(), registeredAt: "2026-11-05T10:00" };
    assert.equal(tracking.isRegisteredIncident(incidentOf({ occurredAt: "2026-11-05T09:58:00" }), m), true);
    assert.equal(tracking.isRegisteredIncident(incidentOf({ occurredAt: "2026-11-05T09:57:59" }), m), false);
    assert.equal(tracking.addMinutes("2026-01-01T00:01", -2), "2025-12-31T23:59");
  });
});

describe("startIncidentPoller (2초 간격·최대 30초)", () => {
  /** 가짜 시계·타이머: runNext()로 예약된 확인을 차례로 실행한다 */
  function fakeClock() {
    let time = 0;
    const timers: { fn: () => void; at: number; id: number }[] = [];
    let seq = 0;
    return {
      now: () => time,
      setTimer: (fn: () => void, ms: number) => {
        const id = ++seq;
        timers.push({ fn, at: time + ms, id });
        return id;
      },
      clearTimer: (id: unknown) => {
        const index = timers.findIndex((t) => t.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
      pending: () => timers.length,
      async runNext() {
        const next = timers.shift();
        if (!next) return false;
        time = next.at;
        next.fn();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return true;
      },
    };
  }

  it("반영될 때까지 2초마다 확인하고, 찾으면 멈춘다", async () => {
    const clock = fakeClock();
    const outcomes = ["NOT_YET", "RETRY", "FOUND"] as const;
    const at: number[] = [];
    let found = 0;
    tracking.startIncidentPoller({
      check: async () => {
        at.push(clock.now());
        return outcomes[at.length - 1];
      },
      onFound: () => found++,
      onTimeout: () => assert.fail("timeout"),
      onStop: () => assert.fail("stop"),
      ...clock,
    });
    while (await clock.runNext());
    assert.deepEqual(at, [2000, 4000, 6000]);
    assert.equal(found, 1);
    assert.equal(clock.pending(), 0);
  });

  it("30초 동안 찾지 못하면 더 확인하지 않고 onTimeout (최대 15회)", async () => {
    const clock = fakeClock();
    let checks = 0;
    let timeout = 0;
    tracking.startIncidentPoller({
      check: async () => {
        checks++;
        return "NOT_YET";
      },
      onFound: () => assert.fail("found"),
      onTimeout: () => timeout++,
      onStop: () => assert.fail("stop"),
      ...clock,
    });
    while (await clock.runNext());
    assert.equal(checks, 15);
    assert.equal(timeout, 1);
    assert.ok(clock.now() <= 30_000);
  });

  it("확인이 끝나기 전에는 다음 확인을 예약하지 않는다 (동시 조회 없음)", async () => {
    const clock = fakeClock();
    let release: (v: "NOT_YET") => void = () => {};
    let inFlight = 0;
    let maxInFlight = 0;
    tracking.startIncidentPoller({
      check: () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          release = (v) => {
            inFlight--;
            resolve(v);
          };
        });
      },
      onFound: () => {},
      onTimeout: () => {},
      onStop: () => {},
      ...clock,
    });
    await clock.runNext();
    assert.equal(clock.pending(), 0, "응답 전에는 다음 예약이 없다");
    release("NOT_YET");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(clock.pending(), 1);
    assert.equal(maxInFlight, 1);
  });

  it("권한·로그인 문제(STOP)면 바로 멈추고, check 예외는 다음에 다시 시도한다", async () => {
    const clock = fakeClock();
    let stopped = 0;
    let calls = 0;
    tracking.startIncidentPoller({
      check: async () => {
        calls++;
        if (calls === 1) throw new Error("network");
        return "STOP";
      },
      onFound: () => assert.fail("found"),
      onTimeout: () => assert.fail("timeout"),
      onStop: () => stopped++,
      ...clock,
    });
    while (await clock.runNext());
    assert.equal(calls, 2);
    assert.equal(stopped, 1);
  });

  it("cancel(언마운트·안내 닫기) 뒤에는 예약을 지우고 늦게 온 응답도 무시한다", async () => {
    const clock = fakeClock();
    let release: (v: "FOUND") => void = () => {};
    let found = 0;
    const poller = tracking.startIncidentPoller({
      check: () => new Promise((resolve) => (release = resolve)),
      onFound: () => found++,
      onTimeout: () => {},
      onStop: () => {},
      ...clock,
    });
    await clock.runNext();
    poller.cancel();
    release("FOUND");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(found, 0);
    assert.equal(clock.pending(), 0);

    const clock2 = fakeClock();
    let checks = 0;
    const p2 = tracking.startIncidentPoller({
      check: async () => {
        checks++;
        return "NOT_YET";
      },
      onFound: () => {},
      onTimeout: () => {},
      onStop: () => {},
      ...clock2,
    });
    p2.cancel();
    assert.equal(clock2.pending(), 0);
    assert.equal(checks, 0);
  });
});

describe("findRegisteredIncident / checkRegisteredIncidentAction", () => {
  const matchFromSubmit = async () => {
    const created = await server.submitEquipmentDowntime(form());
    assert.equal(created.ok, true);
    if (!created.ok || !created.match) throw new Error("no match");
    reset();
    return created.match;
  };

  /** 장애 목록 GET이 error를 던지게 하고 fn을 실행한다 */
  const withIncidentError = async <T>(error: Error, fn: () => Promise<T>) => {
    Object.defineProperty(state, "incidentPage", {
      configurable: true,
      get() {
        throw error;
      },
    });
    try {
      return await quiet(fn);
    } finally {
      Object.defineProperty(state, "incidentPage", { value: pageOf([]), writable: true, configurable: true, enumerable: true });
    }
  };

  it("등록 성공 결과에 응답 원본으로 만든 확인 값(서울 LocalDateTime)을 담는다", async () => {
    const created = await server.submitEquipmentDowntime(form());
    assert.equal(created.ok, true);
    if (created.ok) {
      assert.equal(created.match?.equipmentId, EQUIPMENT);
      assert.equal(created.match?.startAt, `${yesterday}T09:00:00`);
      assert.equal(created.match?.endAt, `${tomorrow}T18:00:00`);
      assert.equal(created.match?.reason, "MRI 장비 냉각 시스템 오류");
      assert.match(created.match?.registeredAt ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    }
  });

  it("목록에 아직 없으면 found=false, 반영되면 그 장애의 incidentId (그 장비 첫 페이지 1회 조회, 캐시 없음)", async () => {
    const match = await matchFromSubmit();
    state.incidentPage = pageOf([incidentOf({ incidentId: "13131313-1313-4131-8131-131313131313", startAt: `${yesterday}T08:00:00` })]);
    assert.deepEqual(await actions.checkRegisteredIncidentAction(match), { ok: true, found: false });
    state.incidentPage = pageOf([incidentOf()]);
    assert.deepEqual(await actions.checkRegisteredIncidentAction(match), { ok: true, found: true, incidentId: INCIDENT_ID });
    const gets = state.calls.filter((call) => call.path === "/api/v1/equipment-incidents");
    assert.equal(gets.length, 2, "확인마다 서버 조회 (이전 결과를 재사용하지 않음)");
    assert.deepEqual(gets[0].query, { page: 0, size: 10, equipmentId: EQUIPMENT, institutionId: undefined, status: undefined });
    assert.equal(state.refreshCount, 0, "확인 조회는 화면을 다시 그리지 않는다");
    assert.equal(posts().length, 0, "등록 POST를 다시 보내지 않는다");
  });

  it("다른 장애만 있으면 반영되지 않은 것으로 본다", async () => {
    const match = await matchFromSubmit();
    state.incidentPage = pageOf([incidentOf({ reason: "다른 장애" }), incidentOf({ occurredAt: "2020-01-01T00:00:00" })]);
    assert.deepEqual(await actions.checkRegisteredIncidentAction(match), { ok: true, found: false });
  });

  it("입력 형식이 틀리면 조회하지 않고, 인가 실패·다른 출처는 조회 전에 멈춘다", async () => {
    const match = await matchFromSubmit();
    for (const bad of [null, { ...match, equipmentId: "x" }, { ...match, startAt: "2026-11-06 10:00" }, { ...match, registeredAt: "x" }, { ...match, reason: "" }]) {
      const result = await actions.checkRegisteredIncidentAction(bad);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "INVALID_INPUT");
    }
    assert.equal(state.calls.length, 0);
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "x" };
    const forbidden = await actions.checkRegisteredIncidentAction(match);
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.reason, "FORBIDDEN");
    state.sameOrigin = false;
    assert.equal((await actions.checkRegisteredIncidentAction(match)).ok, false);
    assert.equal(state.calls.length, 0);
  });

  it("조회 401·403은 확인 중단 대상, 그 밖의 실패는 ERROR(다음에 다시)", async () => {
    const match = await matchFromSubmit();
    for (const [error, reason] of [
      [httpError(401), "UNAUTHORIZED"],
      [httpError(403), "FORBIDDEN"],
      [httpError(500), "ERROR"],
      [new ApiError("TIMEOUT", "x"), "ERROR"],
    ] as const) {
      const result = await withIncidentError(error, () => actions.checkRegisteredIncidentAction(match));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, reason);
    }
  });

  it("기능 스위치가 꺼져 있으면 확인 조회도 하지 않는다", async () => {
    const match = await matchFromSubmit();
    delete process.env.NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION;
    const result = await actions.checkRegisteredIncidentAction(match);
    assert.equal(result.ok, false);
    assert.equal(state.calls.length, 0);
  });
});
