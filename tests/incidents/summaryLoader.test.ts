import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * 장비 장애 현황 집계 로더 loadIncidentSummary (server.ts) 단위 테스트. 실제 네트워크 요청 없음.
 * - users/me(requireRoleAccess)·Gateway 요청(apiRequestData)·Next 내부 오류 판별(unstable_rethrow)만 가짜로 바꾼다
 * - server.ts(권한 확인 순서·실패 변환)·remote.ts(기능 확인·응답 검증·오류 문구)는 실제 코드를 쓴다
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const TOKEN_HEADERS = { Authorization: "Bearer secret-test-token" };

type Access =
  | { ok: true; headers: HeadersInit; user: { userId: string; institutionId: string } }
  | { ok: false; reason: "SIGNED_OUT" | "UNAUTHORIZED" | "UNVERIFIED" | "FORBIDDEN_ROLE"; message: string };
type Call = { path: string; options: Record<string, unknown> };

const okAccess: Access = { ok: true, headers: TOKEN_HEADERS, user: { userId: USER, institutionId: ORG } };
const validSummary = () => ({
  institutionId: ORG,
  asOf: "2026-11-09T14:03:21.123456",
  activeDowntimeEquipmentCount: 2,
  affectedReferralCount: 15,
  needsRescheduleReferralCount: 3,
});

/** Next 내부 제어 흐름 오류 흉내 (unstable_rethrow가 다시 던져야 하는 오류) */
class NextInternalError extends Error {}

const state = {
  access: okAccess as Access,
  response: validSummary() as unknown,
  error: null as unknown,
  calls: [] as Call[],
  order: [] as string[],
  logs: [] as unknown[][],
};

let server: typeof import("@/features/incidents/server");
const originalConsoleError = console.error;

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        state.order.push(`users/me:${role}`);
        return state.access;
      },
      // 실제 session.ts의 toRoleAccessFailure와 같은 구분 (만료 → UNAUTHORIZED, 다른 역할·확인 실패 → FORBIDDEN)
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: Record<string, unknown> = {}) => {
        state.calls.push({ path, options });
        state.order.push(`GET ${path}`);
        if (state.error) throw state.error;
        return state.response;
      },
    },
  });
  mock.module("@/features/equipment/remote", { namedExports: { EQUIPMENT_PAGE_MAX_SIZE: 100, fetchEquipmentPage: async () => ({ contents: [] }) } });
  mock.module("next/navigation", {
    namedExports: {
      unstable_rethrow: (error: unknown) => {
        if (error instanceof NextInternalError) throw error;
      },
    },
  });
  server = await import("@/features/incidents/server");
});

beforeEach(() => {
  state.access = okAccess;
  state.response = validSummary();
  state.error = null;
  state.calls = [];
  state.order = [];
  state.logs = [];
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "incidents";
  // 실패 로그는 화면에 찍지 않고 모아서 토큰이 없는지 확인한다
  console.error = (...args: unknown[]) => void state.logs.push(args);
});

afterEach(() => {
  console.error = originalConsoleError;
});

const httpError = (status: number, code: string | null = null) => new ApiError("HTTP", `HTTP ${status}`, { status, code });
const summaryCalls = () => state.calls.filter((call) => call.path === "/api/v1/equipment-incidents/summary");

describe("loadIncidentSummary: 권한 확인과 요청", () => {
  it("검사기관 역할을 users/me로 먼저 확인한 뒤 집계 API를 1회 호출한다", async () => {
    const result = await server.loadIncidentSummary();
    assert.equal(result.ok, true);
    assert.deepEqual(state.order, ["users/me:EXAMINING", "GET /api/v1/equipment-incidents/summary"]);
  });

  it("인증 헤더를 그대로 넘기고, 기관 ID 쿼리는 보내지 않는다", async () => {
    await server.loadIncidentSummary();
    assert.deepEqual(summaryCalls()[0].options, { headers: TOKEN_HEADERS });
    assert.equal(summaryCalls()[0].options.query, undefined);
    assert.equal(summaryCalls()[0].path.includes(ORG), false, "users/me 기관 ID도 경로·쿼리에 넣지 않는다");
  });

  it("로그인하지 않았으면 API를 호출하지 않고 SIGNED_OUT", async () => {
    state.access = { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
    assert.deepEqual(await server.loadIncidentSummary(), { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다.", code: null });
    assert.equal(state.calls.length, 0);
  });

  it("다른 역할(의뢰기관·관리자)이면 API를 호출하지 않고 FORBIDDEN", async () => {
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "이 화면의 정보에 접근할 권한이 없는 계정입니다." };
    const result = await server.loadIncidentSummary();
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "FORBIDDEN");
    assert.equal(state.calls.length, 0);
  });

  it("users/me 확인에서 만료(401)면 API를 호출하지 않고 UNAUTHORIZED, 확인 실패면 FORBIDDEN", async () => {
    state.access = { ok: false, reason: "UNAUTHORIZED", message: "로그인이 만료되었습니다." };
    const expired = await server.loadIncidentSummary();
    assert.equal(!expired.ok && expired.reason, "UNAUTHORIZED");
    state.access = { ok: false, reason: "UNVERIFIED", message: "사용자 정보를 확인하지 못했습니다." };
    const unverified = await server.loadIncidentSummary();
    assert.equal(!unverified.ok && unverified.reason, "FORBIDDEN");
    assert.equal(state.calls.length, 0);
  });
});

describe("loadIncidentSummary: 성공 결과", () => {
  it("집계 건수·기준 시각을 바꾸지 않고 전달한다", async () => {
    assert.deepEqual(await server.loadIncidentSummary(), { ok: true, summary: validSummary() });
  });

  it("집계 값이 모두 0이어도 성공 결과다", async () => {
    state.response = { ...validSummary(), activeDowntimeEquipmentCount: 0, affectedReferralCount: 0, needsRescheduleReferralCount: 0 };
    const result = await server.loadIncidentSummary();
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.summary, state.response);
  });

  it("응답의 다른 필드는 결과에 담지 않는다", async () => {
    state.response = { ...validSummary(), debug: "internal" };
    const result = await server.loadIncidentSummary();
    assert.deepEqual(result, { ok: true, summary: validSummary() });
  });
});

describe("loadIncidentSummary: 실패 결과 (0건으로 바꾸지 않는다)", () => {
  it("401 → UNAUTHORIZED (공통 안내 문구, 로그 없음)", async () => {
    state.error = new ApiError("HTTP", "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.", { status: 401, code: "UNAUTHORIZED" });
    const result = await server.loadIncidentSummary();
    assert.deepEqual(result, { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.", code: "UNAUTHORIZED" });
    assert.equal(state.logs.length, 0);
  });

  it("403 → FORBIDDEN (오류 코드별 안내)", async () => {
    state.error = httpError(403, "EQUIPMENT_INCIDENT_ACCESS_DENIED");
    assert.deepEqual(await server.loadIncidentSummary(), {
      ok: false,
      reason: "FORBIDDEN",
      message: "장비 장애는 검사기관 담당자만 조회할 수 있습니다.",
      code: "EQUIPMENT_INCIDENT_ACCESS_DENIED",
    });
  });

  it("네트워크 오류·시간 초과 → NETWORK", async () => {
    for (const kind of ["NETWORK", "TIMEOUT"] as const) {
      state.error = new ApiError(kind, kind === "NETWORK" ? "서버에 연결할 수 없습니다." : "응답 시간이 초과되었습니다.");
      const result = await server.loadIncidentSummary();
      assert.equal(!result.ok && result.reason, "NETWORK", kind);
      assert.equal(!result.ok && result.message, (state.error as ApiError).message);
    }
  });

  it("서버 오류(500)·잘못된 요청(400) → ERROR", async () => {
    state.error = httpError(500);
    const serverError = await server.loadIncidentSummary();
    assert.equal(!serverError.ok && serverError.reason, "ERROR");
    state.error = httpError(400, "MISSING_HEADER");
    const badRequest = await server.loadIncidentSummary();
    assert.deepEqual(badRequest, { ok: false, reason: "ERROR", message: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.", code: "MISSING_HEADER" });
  });

  it("404는 상세 조회와 달리 NOT_FOUND가 아니라 ERROR (집계에는 대상 장애가 없다)", async () => {
    state.error = httpError(404);
    const result = await server.loadIncidentSummary();
    assert.equal(!result.ok && result.reason, "ERROR");
  });

  it("응답 형식 오류(PARSE) → ERROR + 집계 전용 안내 문구 (응답 내용은 보여 주지 않는다)", async () => {
    state.response = { ...validSummary(), affectedReferralCount: -1 };
    assert.deepEqual(await server.loadIncidentSummary(), {
      ok: false,
      reason: "ERROR",
      message: "장비 장애 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      code: null,
    });
  });

  it("incidents 기능이 꺼져 있으면(설정 오류) 요청하지 않고 ERROR", async () => {
    process.env.NEXT_PUBLIC_API_FEATURES = "slots";
    const result = await server.loadIncidentSummary();
    assert.equal(!result.ok && result.reason, "ERROR");
    assert.equal(state.calls.length, 0);
  });

  it("실패 로그에 인증 토큰을 남기지 않는다", async () => {
    for (const error of [httpError(403, "EQUIPMENT_INCIDENT_ACCESS_DENIED"), httpError(500), new ApiError("NETWORK", "x")]) {
      state.error = error;
      await server.loadIncidentSummary();
    }
    state.error = null;
    state.response = { broken: true };
    await server.loadIncidentSummary();
    assert.ok(state.logs.length > 0);
    assert.equal(JSON.stringify(state.logs.map((args) => args.map(String))).includes("secret-test-token"), false);
  });

  it("Next 내부 제어 흐름 오류는 실패 결과로 바꾸지 않고 다시 던진다", async () => {
    const internal = new NextInternalError("NEXT_PRERENDER_INTERRUPTED");
    state.error = internal;
    await assert.rejects(server.loadIncidentSummary(), (thrown: unknown) => thrown === internal);
  });
});
