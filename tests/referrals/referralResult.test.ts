import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiError } from "@/lib/api/errors";

/**
 * 의뢰기관 검사결과 조회: Server Function(loadReferralResultAction) + 결과 화면(ResultBody·버튼).
 * Gateway 요청·users/me·Next 헤더는 가짜. 실제 네트워크·POST 없음.
 */

const REFERRAL = "88888888-8888-4888-8888-888888888888";
const RESULT = {
  id: "11111111-1111-4111-8111-111111111111",
  examinationId: "22222222-2222-4222-8222-222222222222",
  referralId: REFERRAL,
  summary: "뇌 MRI 이상 소견 없음",
  notes: "추적 검사 불필요",
  registeredAt: "2099-01-10T11:00:00",
};

const state = {
  access: { ok: true, headers: { Authorization: "Bearer test" }, user: {} } as Record<string, unknown>,
  response: RESULT as unknown,
  calls: [] as { path: string; method?: string; headers?: unknown }[],
  order: [] as string[],
  sameOrigin: true,
};

let actions: typeof import("@/features/referrals/resultActions");
let ui: typeof import("@/features/referrals/components/ReferralResultButton");

before(async () => {
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "referrals";
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        state.order.push(`users/me:${role}`);
        return state.access;
      },
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; headers?: unknown } = {}) => {
        state.calls.push({ path, method: options.method, headers: options.headers });
        state.order.push(`GET ${path}`);
        if (state.response instanceof Error) throw state.response;
        return state.response;
      },
    },
  });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => state.sameOrigin } });
  mock.module("next/navigation", { namedExports: { unstable_rethrow: () => {}, useRouter: () => ({ refresh() {} }) } });
  actions = await import("@/features/referrals/resultActions");
  ui = await import("@/features/referrals/components/ReferralResultButton");
});

beforeEach(() => {
  state.access = { ok: true, headers: { Authorization: "Bearer test" }, user: {} };
  state.response = RESULT;
  state.calls = [];
  state.order = [];
  state.sameOrigin = true;
  process.env.NEXT_PUBLIC_API_MODE = "api";
});

const httpError = (status: number, code: string | null = null) => new ApiError("HTTP", `HTTP ${status}`, { status, code });
const quiet = async <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

describe("loadReferralResultAction", () => {
  it("성공: users/me(REQUESTER) 확인 뒤 GET /api/v1/referrals/{id}/results 1회, 토큰은 Authorization만", async () => {
    const result = await actions.loadReferralResultAction(REFERRAL);
    assert.deepEqual(result, { ok: true, data: RESULT });
    assert.deepEqual(state.order, ["users/me:REFERRING", `GET /api/v1/referrals/${REFERRAL}/results`]);
    assert.equal(state.calls[0].method, undefined, "GET");
    assert.deepEqual(state.calls[0].headers, { Authorization: "Bearer test" });
    assert.equal(JSON.stringify(result).includes("Bearer"), false);
  });

  it("404는 백엔드 오류 코드로 구분한다", async () => {
    const cases: [unknown, string, string][] = [
      [httpError(404, "EXAMINATION_RESULT_NOT_FOUND"), "NOT_REGISTERED", "아직 등록된 검사결과가 없습니다."],
      [httpError(404, "EXAMINATION_NOT_FOUND"), "NOT_FOUND", "검사결과를 조회할 수 없습니다."],
      [httpError(404, "REFERRAL_NOT_FOUND"), "NOT_FOUND", "검사결과를 조회할 수 없습니다."],
    ];
    for (const [error, reason, message] of cases) {
      state.response = error;
      const result = await quiet(() => actions.loadReferralResultAction(REFERRAL));
      assert.deepEqual(result, { ok: false, reason, message });
    }
  });

  it("401·403(다른 기관 의뢰)·네트워크·시간 초과·5xx를 구분한다", async () => {
    for (const [error, reason] of [
      [httpError(401, "TOKEN_EXPIRED"), "UNAUTHORIZED"],
      [httpError(403, "EXAMINATION_RESULT_READ_ACCESS_DENIED"), "FORBIDDEN"],
      [new ApiError("NETWORK", "x"), "NETWORK"],
      [new ApiError("TIMEOUT", "x"), "NETWORK"],
      [httpError(500), "ERROR"],
    ] as const) {
      state.response = error;
      const result = await quiet(() => actions.loadReferralResultAction(REFERRAL));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, reason);
    }
  });

  it("응답 형식이 다르거나 다른 의뢰의 결과면 보여 주지 않는다", async () => {
    for (const bad of [null, { ...RESULT, referralId: "99999999-9999-4999-8999-999999999999" }, { ...RESULT, summary: 1 }, { ...RESULT, registeredAt: "어제" }, { ...RESULT, id: "x" }]) {
      state.response = bad;
      const result = await actions.loadReferralResultAction(REFERRAL);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "INVALID_RESPONSE");
    }
    state.response = { ...RESULT, notes: null };
    assert.deepEqual(await actions.loadReferralResultAction(REFERRAL), { ok: true, data: { ...RESULT, notes: null } });
  });

  it("다른 출처·Mock 모드·로그인 안 함·다른 역할·잘못된 ID는 Gateway 요청 전에 멈춘다", async () => {
    state.sameOrigin = false;
    assert.equal((await actions.loadReferralResultAction(REFERRAL)).ok, false);
    state.sameOrigin = true;
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const mockMode = await actions.loadReferralResultAction(REFERRAL);
    assert.equal(!mockMode.ok && mockMode.reason, "NOT_AVAILABLE");
    process.env.NEXT_PUBLIC_API_MODE = "api";
    for (const [reason, expected] of [["SIGNED_OUT", "SIGNED_OUT"], ["UNAUTHORIZED", "UNAUTHORIZED"], ["FORBIDDEN_ROLE", "FORBIDDEN"]] as const) {
      state.access = { ok: false, reason, message: "x" };
      const result = await actions.loadReferralResultAction(REFERRAL);
      assert.equal(!result.ok && result.reason, expected);
    }
    state.access = { ok: true, headers: {}, user: {} };
    const invalid = await actions.loadReferralResultAction("abc");
    assert.equal(!invalid.ok && invalid.reason, "INVALID_INPUT");
    assert.equal(state.calls.length, 0);
  });
});

describe("검사결과 화면", () => {
  it("결과: 요약·추가 소견·등록 일시", () => {
    const html = renderToStaticMarkup(createElement(ui.ResultBody, { result: { ok: true, data: RESULT } }));
    for (const text of ["검사결과 요약", "뇌 MRI 이상 소견 없음", "추가 소견", "추적 검사 불필요", "결과 등록 일시", "2099-01-10"]) assert.ok(html.includes(text), text);
    const noNotes = renderToStaticMarkup(createElement(ui.ResultBody, { result: { ok: true, data: { ...RESULT, notes: null } } }));
    assert.match(noNotes, /추가 소견이 없습니다\./);
  });

  it("결과 미등록은 안내(status), 네트워크 오류는 다시 시도, 만료는 다시 로그인", () => {
    const empty = renderToStaticMarkup(createElement(ui.ResultBody, { result: { ok: false, reason: "NOT_REGISTERED", message: "아직 등록된 검사결과가 없습니다." } }));
    assert.match(empty, /role="status"[\s\S]*아직 등록된 검사결과가 없습니다\./);
    assert.doesNotMatch(empty, /다시 시도/);
    const network = renderToStaticMarkup(createElement(ui.ResultBody, { result: { ok: false, reason: "NETWORK", message: "m" }, onRetry: () => {} }));
    assert.match(network, /role="alert"[\s\S]*다시 시도/);
    const expired = renderToStaticMarkup(createElement(ui.ResultBody, { result: { ok: false, reason: "UNAUTHORIZED", message: "m" } }));
    assert.match(expired, /다시 로그인/);
  });

  it("버튼: '상세'와 같은 크기(h-9)·한 단계 낮은 위계(회색 테두리·글자)의 [검사결과], 열기 전에는 조회하지 않는다", () => {
    const html = renderToStaticMarkup(createElement(ui.default, { referralId: REFERRAL }));
    assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*aria-label="[^"]*검사결과"[^>]*class="inline-flex h-9[^"]*border-line[^"]*text-gray-700[^"]*">검사결과<\/button>/);
    assert.equal(state.calls.length, 0);
  });
});

describe("Mock 모드 검사결과 (백엔드 요청 없음)", () => {
  it("시나리오: R-001 결과 등록(요약·추가 소견·등록 일시) / R-009 검사 완료·결과 미등록 / R-004 검사 전 / 검사 기록 없음", async () => {
    const { getMockReferralResult } = await import("@/features/referrals/mockResult");
    // R-001: 검사 완료 + 결과 등록 (10/27 예약 확정 → 11/05 결과 등록)
    const ok = getMockReferralResult("mock-referral-001");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.match(ok.data.summary, /MRI 검사 결과 특이 소견 없음/);
      assert.match(ok.data.notes ?? "", /정기적인 추적 검사를 권고/);
      assert.equal(ok.data.registeredAt, "2026-11-05T14:30");
    }
    const html = renderToStaticMarkup(createElement(ui.ResultBody, { result: ok }));
    for (const text of ["검사결과 요약", "MRI 검사 결과 특이 소견 없음", "추가 소견", "정기적인 추적 검사를 권고", "결과 등록 일시", "2026-11-05"]) assert.ok(html.includes(text), text);
    // R-010: 기존 결과(추가 소견 없음)는 그대로
    const legacy = getMockReferralResult("mock-referral-010");
    assert.equal(legacy.ok && legacy.data.notes, null);
    // R-009: 검사 완료, 결과 미등록
    assert.deepEqual(getMockReferralResult("mock-referral-009"), { ok: false, reason: "NOT_REGISTERED", message: "아직 등록된 검사결과가 없습니다." });
    // R-004: 검사 대기 (11/03 예정)
    assert.deepEqual(getMockReferralResult("mock-referral-004"), { ok: false, reason: "NOT_REGISTERED", message: "아직 검사가 완료되지 않아 검사결과가 없습니다." });
    // 검사 기록이 없는 의뢰
    assert.deepEqual(getMockReferralResult("mock-referral-002"), { ok: false, reason: "NOT_FOUND", message: "검사결과를 조회할 수 없습니다." });
    assert.equal(state.calls.length, 0, "Mock 조회는 Gateway를 부르지 않는다");
  });

  it("Mock 데이터 정합성: 결과는 검사 완료 기록에만, 등록 일시는 예약 일시 이후", async () => {
    const { MOCK_EXAMINATIONS } = await import("@/lib/dev/mockExaminations");
    const { getRecentReferrals } = await import("@/features/referrals/api");
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const referrals = await getRecentReferrals();
    for (const record of MOCK_EXAMINATIONS.filter((item) => item.result)) {
      assert.equal(record.progressStatus, "COMPLETED", record.referralId);
      const referral = referrals.find((item) => item.id === record.referralId);
      assert.ok(referral, `${record.referralId} 의뢰 있음`);
      assert.equal(referral!.organizationId, record.organizationId, `${record.referralId} 검사기관 일치`);
      assert.ok(record.result!.registeredAt > referral!.scheduledAt, `${record.referralId} 결과 등록은 검사 이후`);
    }
  });

  it("Mock 의뢰·예약 목록: 행마다 [상세] 옆 [검사결과] (의뢰 번호로 표시)", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const Table = (await import("@/features/referrals/components/ReferralHistoryTable")).default;
    const referral = { id: "mock-referral-010", referralNumber: "R-010", virtualPatientId: "DEMO-1110", referringOrganizationId: "o", referringOrganizationName: "o", organizationId: "org-gaon", organizationName: "가온", equipmentName: "CT 1호기", examType: "CT", scheduledAt: "2026-10-16T09:00", status: "CONFIRMED", purpose: "", requestedAt: "2026-10-10T09:00" };
    const html = renderToStaticMarkup(createElement(Table, { referrals: [referral] } as never));
    assert.match(html, />상세<\/button>[\s\S]*aria-label="R-010 검사결과"[^>]*>검사결과<\/button>/);
    assert.equal(state.calls.length, 0);
  });
});
