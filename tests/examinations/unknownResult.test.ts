import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * P2-A·P2-B: 검사 상태 변경·결과 등록 요청의 결과 불명 처리 (응답 없음·시간 초과·응답 형식 오류·5xx).
 * 실제 Server Action(examinations/actions.ts)·remote.ts를 쓰고, Gateway 요청(apiRequestData)·세션 확인·같은 출처·refresh만 가짜.
 * 백엔드 계약: 상태 변경은 같은 상태 재요청을 기존 값으로 돌려준다(멱등) · 결과는 검사당 1건(409 EXAMINATION_RESULT_ALREADY_EXISTS).
 * 실제 백엔드 요청 없음.
 */

const EXAM = "e0000000-0000-4000-8000-000000000001";
const OTHER_EXAM = "e0000000-0000-4000-8000-000000000002";
const REFERRAL = "a0000000-0000-4000-8000-000000000001";
const RESERVATION = "b0000000-0000-4000-8000-000000000001";
const RESULT_ID = "c0000000-0000-4000-8000-000000000001";
const LOGIN = "loginSessionTagA";
const OK_ACCESS = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: "u", institutionId: "i" } };

const state = {
  loginSession: LOGIN as string | null,
  calls: [] as { method: string; path: string }[],
  /** 서버의 검사 상태 */
  status: "SCHEDULED" as string,
  /** 서버의 결과 (없으면 null) */
  result: null as null | { summary: string; notes: string | null },
  /** 변경 요청 동작: 오류를 던지거나, commit이면 서버에 반영한 뒤 오류 */
  mutationError: null as unknown,
  commit: false,
  listError: null as unknown,
  resultLookupError: null as unknown,
  /** 목록에서 이 검사를 몇 번째 페이지에 둘지 (못 찾는 경우 확인용으로 크게) */
  examPage: 0,
  refreshCount: 0,
};

const listItem = (examinationId: string, status: string) => ({
  examinationId,
  referralId: REFERRAL,
  reservationId: RESERVATION,
  examTypeId: "d0000000-0000-4000-8000-000000000001",
  equipmentId: "f0000000-0000-4000-8000-000000000001",
  status,
  startedAt: null,
  completedAt: null,
  examDate: "2099-01-10",
  startTime: "10:00:00",
  endTime: "10:30:00",
  reservationStatus: "CONFIRMED",
  resultRegistered: false,
});

let actions: typeof import("@/features/examinations/actions");

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => OK_ACCESS,
      requireRoleMutationAccess: async (_role: string, expected: unknown) =>
        expected === state.loginSession ? OK_ACCESS : { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." },
    },
  });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => true } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: Record<string, unknown>; query?: { page?: number } } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ method, path });
        if (method === "PATCH" && path === `/api/v1/examinations/${EXAM}/status`) {
          const next = String(options.body?.status);
          if (state.mutationError && !state.commit) throw state.mutationError;
          const previous = state.status;
          state.status = next;
          if (state.mutationError) throw state.mutationError;
          return { examinationId: EXAM, referralId: REFERRAL, previousStatus: previous, currentStatus: next, updatedAt: "2099-01-10T10:00:00" };
        }
        if (method === "POST" && path === `/api/v1/examinations/${EXAM}/results`) {
          if (state.mutationError && !state.commit) throw state.mutationError;
          if (state.result) throw new ApiError("HTTP", "dup", { status: 409, code: "EXAMINATION_RESULT_ALREADY_EXISTS" });
          state.result = { summary: String(options.body?.summary), notes: (options.body?.notes as string | undefined) ?? null };
          if (state.mutationError) throw state.mutationError;
          return { id: RESULT_ID, examinationId: EXAM, referralId: REFERRAL, summary: state.result.summary, notes: state.result.notes, registeredAt: "2099-01-10T11:00:00" };
        }
        if (method === "GET" && path === "/api/v1/examinations") {
          if (state.listError) throw state.listError;
          const page = options.query?.page ?? 0;
          const contents = page === state.examPage ? [listItem(EXAM, state.status)] : [listItem(OTHER_EXAM, "SCHEDULED")];
          return { contents, totalElements: 10, totalPages: 10, size: 100, number: page };
        }
        if (method === "GET" && path === `/api/v1/examinations/${EXAM}/results`) {
          if (state.resultLookupError) throw state.resultLookupError;
          if (!state.result) throw new ApiError("HTTP", "none", { status: 404, code: "EXAMINATION_RESULT_NOT_FOUND" });
          return { id: RESULT_ID, examinationId: EXAM, referralId: REFERRAL, summary: state.result.summary, notes: state.result.notes, registeredAt: "2099-01-10T11:00:00" };
        }
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  actions = await import("@/features/examinations/actions");
});

beforeEach(() => {
  state.loginSession = LOGIN;
  state.calls = [];
  state.status = "SCHEDULED";
  state.result = null;
  state.mutationError = null;
  state.commit = false;
  state.listError = null;
  state.resultLookupError = null;
  state.examPage = 0;
  state.refreshCount = 0;
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
const count = (method: string, suffix: string) => state.calls.filter((c) => c.method === method && c.path.endsWith(suffix)).length;
type Result = { ok: boolean; reason?: string; message: string };
const UNKNOWN: [string, unknown][] = [
  ["500", new ApiError("HTTP", "x", { status: 500 })],
  ["502", new ApiError("HTTP", "x", { status: 502 })],
  ["503", new ApiError("HTTP", "x", { status: 503 })],
  ["504", new ApiError("HTTP", "x", { status: 504 })],
  ["TIMEOUT", new ApiError("TIMEOUT", "x")],
  ["NETWORK", new ApiError("NETWORK", "x")],
  ["PARSE", new ApiError("PARSE", "x")],
];

describe("P2-A 검사 상태 변경: 결과 불명 처리", () => {
  it("정상: SCHEDULED → IN_PROGRESS → COMPLETED, 각 PATCH 1회", async () => {
    assert.equal(((await actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN)) as Result).ok, true);
    state.status = "IN_PROGRESS";
    assert.equal(((await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN)) as Result).ok, true);
    assert.equal(count("PATCH", "/status"), 2);
    assert.equal(state.status, "COMPLETED");
  });

  for (const [label, error] of UNKNOWN) {
    it(`서버 반영 + 응답 ${label}: PATCH 재전송 0, 목록 재조회로 반영 확인 → 반영 안내(ok)`, async () => {
      state.mutationError = error;
      state.commit = true;
      const result = (await quiet(() => actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN))) as Result;
      assert.equal(result.ok, true, label);
      assert.match(result.message, /응답을 받지 못했지만 서버에서 검사 상태가 '검사 중'\(으\)로 바뀐 것을 확인했습니다/);
      assert.equal(count("PATCH", "/status"), 1);
      assert.equal(state.refreshCount, 1);
    });
  }

  it("서버 미반영 + 500: 이전 상태 그대로면 실패로 단정하지 않고 UNCERTAIN (PATCH 1회)", async () => {
    state.mutationError = new ApiError("HTTP", "x", { status: 500 });
    const result = (await quiet(() => actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.match(result.message, /처리 중일 수 있습니다/);
    assert.equal(count("PATCH", "/status"), 1);
    assert.equal(state.status, "SCHEDULED");
  });

  it("IN_PROGRESS → COMPLETED 응답 유실(TIMEOUT)도 반영 확인", async () => {
    state.status = "IN_PROGRESS";
    state.mutationError = new ApiError("TIMEOUT", "x");
    state.commit = true;
    const result = (await quiet(() => actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN))) as Result;
    assert.equal(result.ok, true);
    assert.match(result.message, /'검사 완료'/);
  });

  it("목록 재조회 실패: UNCERTAIN(최신 상태 확인 실패), 화면 다시 그리지 않음", async () => {
    state.mutationError = new ApiError("TIMEOUT", "x");
    state.listError = new ApiError("HTTP", "x", { status: 503 });
    const result = (await quiet(() => actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.match(result.message, /최신 상태도 불러오지 못했습니다/);
    assert.equal(state.refreshCount, 0);
  });

  it("목록 앞쪽 페이지(최대 3페이지)에서 못 찾으면 '확인 실패'로 (요청 수 상한, 단정하지 않음)", async () => {
    state.mutationError = new ApiError("HTTP", "x", { status: 502 });
    state.examPage = 5;
    const result = (await quiet(() => actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.equal(count("GET", "/api/v1/examinations"), 3);
  });

  it("기존 처리 유지: 409 CONFLICT(목록 다시 그리기)·400·403·404는 결과 불명이 아니다", async () => {
    for (const [status, reason] of [[409, "CONFLICT"], [400, "INVALID"], [403, "FORBIDDEN"], [404, "NOT_FOUND"]] as const) {
      state.mutationError = new ApiError("HTTP", "x", { status });
      state.calls = [];
      const result = (await quiet(() => actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN))) as Result;
      assert.equal(result.reason, reason);
      assert.equal(count("GET", "/api/v1/examinations"), 0);
    }
  });

  it("SESSION_CHANGED면 PATCH·조회 0회 (기존 보호 그대로)", async () => {
    state.loginSession = "loginSessionTagB";
    const result = (await actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN)) as Result;
    assert.equal(result.reason, "SESSION_CHANGED");
    assert.equal(state.calls.length, 0);
  });
});

describe("P2-B 검사 결과 등록: 결과 불명 처리", () => {
  const RESULT = { summary: "이상 소견 없음", notes: "추적 관찰" };

  it("정상 등록: POST 1회", async () => {
    assert.equal(((await actions.registerExaminationResultAction(EXAM, RESULT, LOGIN)) as Result).ok, true);
    assert.equal(count("POST", "/results"), 1);
  });

  for (const [label, error] of UNKNOWN) {
    it(`서버 등록 + 응답 ${label}: POST 재전송 0, 결과 조회로 같은 내용 확인 → 등록 안내(ok)`, async () => {
      state.mutationError = error;
      state.commit = true;
      const result = (await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN))) as Result;
      assert.equal(result.ok, true, label);
      assert.match(result.message, /응답을 받지 못했지만 검사 결과가 등록된 것을 확인했습니다/);
      assert.equal(count("POST", "/results"), 1);
      assert.equal(count("GET", "/results"), 1);
      assert.equal(state.refreshCount, 1);
    });
  }

  it("서버 미등록 + 500: 결과 없음(404)이면 UNCERTAIN, 다시 등록해도 중복은 서버가 막는다", async () => {
    state.mutationError = new ApiError("HTTP", "x", { status: 500 });
    const result = (await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.match(result.message, /없을 때만 다시 등록/);
    assert.equal(state.result, null);
  });

  it("결과 조회 실패: UNCERTAIN(결과 확인 실패), 화면 다시 그리지 않음", async () => {
    state.mutationError = new ApiError("TIMEOUT", "x");
    state.commit = true;
    state.resultLookupError = new ApiError("HTTP", "x", { status: 503 });
    const result = (await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.match(result.message, /등록된 결과도 불러오지 못했습니다/);
    assert.equal(state.refreshCount, 0);
  });

  it("다른 내용의 결과가 이미 있으면 CONFLICT로 안내 (다시 등록하지 않음)", async () => {
    state.result = { summary: "다른 판독", notes: null };
    state.mutationError = new ApiError("HTTP", "x", { status: 504 });
    const result = (await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN))) as Result;
    assert.equal(result.reason, "CONFLICT");
    assert.match(result.message, /이미 다른 내용의 검사 결과가 등록되어 있습니다/);
    assert.equal(count("POST", "/results"), 1);
  });

  it("응답 유실 뒤 사용자가 다시 등록해도 결과는 1건 (백엔드 409, 중복 등록 없음)", async () => {
    state.mutationError = new ApiError("HTTP", "x", { status: 500 });
    state.commit = true;
    state.resultLookupError = new ApiError("NETWORK", "x");
    await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN));
    state.mutationError = null;
    state.resultLookupError = null;
    const again = (await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN))) as Result;
    assert.equal(again.reason, "CONFLICT");
    assert.equal(count("POST", "/results"), 2, "사용자의 두 번째 시도");
    assert.deepEqual(state.result, { summary: RESULT.summary, notes: RESULT.notes });
  });

  it("기존 처리 유지: 409·400·403·404는 결과 불명이 아니다 (결과 조회 없음)", async () => {
    for (const [status, reason] of [[409, "CONFLICT"], [400, "INVALID"], [403, "FORBIDDEN"], [404, "NOT_FOUND"]] as const) {
      state.mutationError = new ApiError("HTTP", "x", { status });
      state.calls = [];
      const result = (await quiet(() => actions.registerExaminationResultAction(EXAM, RESULT, LOGIN))) as Result;
      assert.equal(result.reason, reason);
      assert.equal(count("GET", "/results"), 0);
    }
  });
});
