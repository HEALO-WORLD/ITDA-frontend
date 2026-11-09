import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * 장비 장애 현황 집계 `GET /api/v1/equipment-incidents/summary` 통신 계층 (fetchIncidentSummary) 단위 테스트.
 * 실제 네트워크 요청 없음: Gateway 요청(apiRequestData)만 가짜로 바꾸고 remote.ts(기능 확인·응답 검증·오류 처리)는 실제 코드를 쓴다.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

type Call = { path: string; options: Record<string, unknown> };

const validSummary = () => ({
  institutionId: ORG,
  asOf: "2026-11-09T14:03:21.123456789",
  activeDowntimeEquipmentCount: 2,
  affectedReferralCount: 15,
  needsRescheduleReferralCount: 3,
});

const state = {
  response: validSummary() as unknown,
  error: null as Error | null,
  calls: [] as Call[],
};

let remote: typeof import("@/features/incidents/remote");

before(async () => {
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: Record<string, unknown> = {}) => {
        state.calls.push({ path, options });
        if (state.error) throw state.error;
        return state.response;
      },
    },
  });
  remote = await import("@/features/incidents/remote");
});

beforeEach(() => {
  state.response = validSummary();
  state.error = null;
  state.calls = [];
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "incidents";
});

const expectParse = async (response: unknown) => {
  state.response = response;
  await assert.rejects(remote.fetchIncidentSummary(), (error: unknown) => error instanceof ApiError && error.kind === "PARSE");
};

describe("fetchIncidentSummary: 요청", () => {
  it("GET /api/v1/equipment-incidents/summary를 1회 호출하고 institutionId 쿼리를 보내지 않는다 (EXAMINER)", async () => {
    await remote.fetchIncidentSummary();
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].path, "/api/v1/equipment-incidents/summary");
    assert.equal(state.calls[0].options.method, undefined, "GET (method 생략)");
    assert.equal(state.calls[0].options.query, undefined, "쿼리 파라미터 없음");
    assert.equal(state.calls[0].path.includes("institutionId"), false);
  });

  it("인증 헤더·signal을 다른 조회와 같은 방식(options)으로 그대로 넘긴다", async () => {
    const controller = new AbortController();
    const headers = { Authorization: "Bearer test" };
    await remote.fetchIncidentSummary({ headers, signal: controller.signal });
    assert.deepEqual(state.calls[0].options, { headers, signal: controller.signal });
  });

  it("incidents가 API 대상이 아니면 요청하지 않고 CONFIG 오류", async () => {
    process.env.NEXT_PUBLIC_API_FEATURES = "slots";
    await assert.rejects(remote.fetchIncidentSummary(), (error: unknown) => error instanceof ApiError && error.kind === "CONFIG");
    assert.equal(state.calls.length, 0);
  });
});

describe("fetchIncidentSummary: 정상 응답", () => {
  it("응답을 DTO 그대로 돌려준다 (asOf는 Date로 바꾸지 않고 원본 문자열)", async () => {
    const result = await remote.fetchIncidentSummary();
    assert.deepEqual(result, validSummary());
    assert.equal(typeof result.asOf, "string");
    assert.equal(result.asOf, "2026-11-09T14:03:21.123456789");
  });

  it("모든 건수가 0인 응답을 허용한다", async () => {
    state.response = { ...validSummary(), activeDowntimeEquipmentCount: 0, affectedReferralCount: 0, needsRescheduleReferralCount: 0 };
    const result = await remote.fetchIncidentSummary();
    assert.equal(result.activeDowntimeEquipmentCount + result.affectedReferralCount + result.needsRescheduleReferralCount, 0);
  });

  it("LocalDateTime의 초·소수 초 생략 형식과 대문자 UUID를 허용한다", async () => {
    for (const asOf of ["2026-11-09T14:03", "2026-11-09T14:03:21", "2026-11-09T14:03:21.5", "2028-02-29T00:00:00"]) {
      state.response = { ...validSummary(), institutionId: ORG.toUpperCase(), asOf };
      assert.equal((await remote.fetchIncidentSummary()).asOf, asOf);
    }
  });
});

describe("fetchIncidentSummary: 잘못된 응답은 PARSE 오류", () => {
  const countFields = ["activeDowntimeEquipmentCount", "affectedReferralCount", "needsRescheduleReferralCount"] as const;

  it("건수가 음수·소수·문자열·null·안전하지 않은 정수면 거부한다", async () => {
    for (const field of countFields) {
      for (const bad of [-1, 1.5, "3", null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        await expectParse({ ...validSummary(), [field]: bad });
      }
    }
  });

  it("필수 필드가 없으면 거부한다", async () => {
    for (const field of ["institutionId", "asOf", ...countFields]) {
      const response: Record<string, unknown> = validSummary();
      delete response[field];
      await expectParse(response);
    }
  });

  it("institutionId가 UUID가 아니면 거부한다", async () => {
    for (const bad of ["", "not-a-uuid", "11111111-1111-4111-8111-11111111111", 123, null]) {
      await expectParse({ ...validSummary(), institutionId: bad });
    }
  });

  it("asOf가 LocalDateTime 형식이 아니거나 없는 날짜·시각이면 거부한다 (시간대 표기 포함 형식도 거부)", async () => {
    for (const bad of [
      "",
      "2026-11-09",
      "2026-11-09 14:03:21",
      "2026-11-09T14:03:21Z",
      "2026-11-09T14:03:21+09:00",
      "2026-13-01T00:00:00",
      "2026-02-30T00:00:00",
      "2026-11-09T24:00:00",
      "2026-11-09T14:60:00",
      "2026-11-09T14:03:21.1234567890",
      1731128601000,
      null,
    ]) {
      await expectParse({ ...validSummary(), asOf: bad });
    }
  });

  it("응답이 객체가 아니면 거부한다", async () => {
    for (const bad of [null, undefined, "summary", 0, []]) await expectParse(bad);
  });
});

describe("fetchIncidentSummary: HTTP 오류", () => {
  it("Gateway·백엔드 오류(401·403·400·500)를 바꾸지 않고 그대로 전달한다", async () => {
    for (const [status, code] of [
      [401, null],
      [403, "EQUIPMENT_INCIDENT_ACCESS_DENIED"],
      [400, "MISSING_HEADER"],
      [500, null],
    ] as const) {
      const error = new ApiError("HTTP", `HTTP ${status}`, { status, code });
      state.error = error;
      await assert.rejects(remote.fetchIncidentSummary(), (thrown: unknown) => thrown === error);
    }
  });

  it("네트워크 오류도 그대로 전달한다", async () => {
    const error = new ApiError("NETWORK", "서버에 연결할 수 없습니다.");
    state.error = error;
    await assert.rejects(remote.fetchIncidentSummary(), (thrown: unknown) => thrown === error);
  });
});
