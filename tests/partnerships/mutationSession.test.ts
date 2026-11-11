import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * STEP 3-2-2B-7: 협약 관리 변경 요청의 로그인 세션 정합성.
 * 실제 Server Action(partnerships/actions.ts)·remote.ts를 쓰고, Gateway 요청(apiRequestData)·세션 확인·같은 출처·refresh만 가짜.
 * 공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts. 실제 백엔드 요청 없음.
 */

const REQUESTER_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXAM_ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTNERSHIP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
/** 화면이 렌더링된 로그인 세션 구분 값 */
const LOGIN = "loginSessionTagA";
const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
const OK_ACCESS = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: "u", institutionId: REQUESTER_ORG } };
const STATUS_AFTER: Record<string, string> = { approve: "ACTIVE", reject: "REJECTED", terminate: "TERMINATED" };

type Call = { method: string; path: string; role?: string };
const state = {
  loginSession: LOGIN as string | null,
  access: OK_ACCESS as { ok: boolean; reason?: string; message?: string },
  calls: [] as Call[],
  roles: [] as string[],
  /** 협약 요청 전 사전 조회(GET /partnerships/me)가 돌려줄 기존 협약 상태 */
  existing: null as string | null,
  /** 다음 Gateway 변경 요청을 이 오류로 실패시킨다 */
  error: null as unknown,
  refreshCount: 0,
};

const partnership = (status: string) => ({
  id: PARTNERSHIP,
  requesterInstitutionId: REQUESTER_ORG,
  examInstitutionId: EXAM_ORG,
  status,
  requestedAt: "2026-11-01T09:00:00",
  approvedAt: null,
  terminatedAt: null,
});

let actions: typeof import("@/features/partnerships/actions");

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => state.access,
      // 실제 함수와 같은 순서: 형식 확인 → 역할 확인 → 쿠키의 로그인 세션 비교
      requireRoleMutationAccess: async (role: string, expected: unknown) => {
        state.roles.push(role);
        if (expected !== null && typeof expected !== "string") return SESSION_CHANGED;
        if (!state.access.ok) return state.access;
        return expected === state.loginSession ? state.access : SESSION_CHANGED;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => true } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ method, path });
        if (method === "GET" && path === "/api/v1/partnerships/me") {
          return state.existing
            ? [{ partnershipId: PARTNERSHIP, partnerInstitutionId: EXAM_ORG, partnerInstitutionName: "테스트검사센터", partnerInstitutionType: "EXAM", status: state.existing, requestedAt: "2026-11-01T09:00:00", approvedAt: null, terminatedAt: null }]
            : [];
        }
        if (state.error) throw state.error;
        if (method === "POST" && path === "/api/v1/partnerships") return partnership("PENDING");
        const transition = /^\/api\/v1\/partnerships\/([0-9a-f-]{36})\/(approve|reject|terminate)$/.exec(path);
        if (method === "PATCH" && transition) return partnership(STATUS_AFTER[transition[2]]);
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  actions = await import("@/features/partnerships/actions");
});

beforeEach(() => {
  state.loginSession = LOGIN;
  state.access = OK_ACCESS;
  state.calls = [];
  state.roles = [];
  state.existing = null;
  state.error = null;
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

/** 5개 변경 Action: 같은 입력으로 렌더링 세션 값만 바꿔 부른다 (role: 기존 화면 역할, method·path: 변경 요청) */
const MUTATIONS: { name: string; role: string; method: string; path: string; call: (login?: unknown) => Promise<{ ok: boolean; reason?: string }> }[] = [
  { name: "협약 요청·다시 요청 requestPartnershipAction (POST)", role: "REFERRING", method: "POST", path: "/api/v1/partnerships", call: (login) => actions.requestPartnershipAction(EXAM_ORG, login) },
  { name: "협약 승인 approvePartnershipAction (PATCH)", role: "EXAMINING", method: "PATCH", path: `/api/v1/partnerships/${PARTNERSHIP}/approve`, call: (login) => actions.approvePartnershipAction(PARTNERSHIP, login) },
  { name: "협약 거절 rejectPartnershipAction (PATCH)", role: "EXAMINING", method: "PATCH", path: `/api/v1/partnerships/${PARTNERSHIP}/reject`, call: (login) => actions.rejectPartnershipAction(PARTNERSHIP, login) },
  {
    name: "협약 종료(의뢰기관) terminateReferringPartnershipAction (PATCH)",
    role: "REFERRING",
    method: "PATCH",
    path: `/api/v1/partnerships/${PARTNERSHIP}/terminate`,
    call: (login) => actions.terminateReferringPartnershipAction(PARTNERSHIP, login),
  },
  {
    name: "협약 종료(검사기관) terminateExaminingPartnershipAction (PATCH)",
    role: "EXAMINING",
    method: "PATCH",
    path: `/api/v1/partnerships/${PARTNERSHIP}/terminate`,
    call: (login) => actions.terminateExaminingPartnershipAction(PARTNERSHIP, login),
  },
];

describe("협약 관리 변경 Action: 로그인 세션 정합성 (STEP 3-2-2B-7)", () => {
  for (const mutation of MUTATIONS) {
    describe(mutation.name, () => {
      it("같은 세션(Refresh Token 회전 포함: 로그인 세션 값은 그대로): 기존 역할로 확인, 정상 처리, 변경 요청 1회, 목록 다시 그리기", async () => {
        const result = await mutation.call(LOGIN);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(state.roles, [mutation.role]);
        assert.deepEqual(
          state.calls.filter((call) => call.method !== "GET"),
          [{ method: mutation.method, path: mutation.path }],
        );
        assert.equal(state.refreshCount, 1);
      });

      it("다른 탭에서 계정이 바뀌면 SESSION_CHANGED: Gateway 요청 0회(변경·사전 조회 모두), 목록 다시 그리지 않음", async () => {
        state.loginSession = "loginSessionTagB";
        assert.deepEqual(await mutation.call(LOGIN), SESSION_CHANGED);
        assert.deepEqual(state.calls, []);
        assert.equal(state.refreshCount, 0);
      });

      it("렌더링 세션 인자를 빠뜨리면(undefined) 거부한다", async () => {
        assert.equal((await mutation.call()).reason, "SESSION_CHANGED");
        assert.deepEqual(state.calls, []);
        assert.equal(state.refreshCount, 0);
      });

      it("기존 인증·권한 실패는 그대로 구분 (SESSION_CHANGED로 덮지 않음)", async () => {
        state.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
        assert.equal((await mutation.call(LOGIN)).reason, "UNAUTHORIZED");
        state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
        assert.equal((await mutation.call(LOGIN)).reason, "FORBIDDEN");
        state.access = { ok: false, reason: "SIGNED_OUT", message: "로그인" };
        assert.equal((await mutation.call(LOGIN)).reason, "SIGNED_OUT");
        assert.deepEqual(state.calls, []);
      });
    });
  }

  it("같은 세션의 백엔드 오류 처리 유지: 409 CONFLICT·404 NOT_FOUND(목록 다시 그리기), 400 INVALID, 403 FORBIDDEN, 401 UNAUTHORIZED", async () => {
    const cases: [number, string, number][] = [[409, "CONFLICT", 1], [404, "NOT_FOUND", 1], [400, "INVALID", 0], [403, "FORBIDDEN", 0], [401, "UNAUTHORIZED", 0]];
    for (const [status, reason, refreshes] of cases) {
      for (const mutation of MUTATIONS) {
        state.error = new ApiError("HTTP", "x", { status });
        state.refreshCount = 0;
        const result = await quiet(() => mutation.call(LOGIN));
        assert.equal(result.reason, reason, `${mutation.name} ${status}`);
        assert.equal(state.refreshCount, refreshes, `${mutation.name} ${status} refresh`);
      }
    }
  });

  it("협약 요청의 기존 정책 유지: 같은 세션이면 사전 조회 뒤 진행 중(승인 대기·협약 중)이면 요청하지 않음, 거절·종료면 다시 요청", async () => {
    for (const status of ["PENDING", "ACTIVE"]) {
      state.calls = [];
      state.existing = status;
      const result = await actions.requestPartnershipAction(EXAM_ORG, LOGIN);
      assert.equal((result as { reason?: string }).reason, "CONFLICT");
      assert.deepEqual(state.calls.map((call) => call.method), ["GET"]);
    }
    state.calls = [];
    state.existing = "TERMINATED";
    const again = await actions.requestPartnershipAction(EXAM_ORG, LOGIN);
    assert.equal(again.ok, true);
    assert.match((again as { message: string }).message, /다시 요청했습니다/);
    assert.deepEqual(state.calls.map((call) => call.method), ["GET", "POST"]);
  });

  it("입력 검증은 그대로 (잘못된 ID는 요청 없이 INVALID)", async () => {
    assert.equal(((await actions.requestPartnershipAction("not-uuid", LOGIN)) as { reason?: string }).reason, "INVALID");
    assert.equal(((await actions.approvePartnershipAction("not-uuid", LOGIN)) as { reason?: string }).reason, "INVALID");
    assert.deepEqual(state.calls, []);
  });

  it("화면: 협약 변경 요청 모두 렌더링 세션을 보내고, SESSION_CHANGED면 공유 잠금으로 확인 버튼을 막는다", () => {
    const table = readFileSync("src/features/partnerships/components/PartnershipTable.tsx", "utf8").replace(/\r\n/g, "\n");
    const dialog = readFileSync("src/features/partnerships/components/PartnershipRequestDialog.tsx", "utf8").replace(/\r\n/g, "\n");
    for (const pattern of [
      /approvePartnershipAction\(item\.partnershipId, renderedLoginSession\)/,
      /rejectPartnershipAction\(item\.partnershipId, renderedLoginSession\)/,
      /requestPartnershipAction\(item\.partnerInstitutionId, renderedLoginSession\)/,
      /terminateReferringPartnershipAction\(item\.partnershipId, renderedLoginSession\)/,
      /terminateExaminingPartnershipAction\(item\.partnershipId, renderedLoginSession\)/,
    ]) assert.match(table, pattern);
    assert.match(dialog, /requestPartnershipAction\(selected\.id, renderedLoginSession\)/);
    assert.equal((table.match(/markPartnershipSessionChanged\(\)/g) ?? []).length, 1);
    assert.equal((dialog.match(/markPartnershipSessionChanged\(\)/g) ?? []).length, 1);
    assert.match(table, /disabled=\{pending \|\| sessionChanged\}/);
    assert.match(dialog, /disabled=\{pending \|\| !selected \|\| sessionChanged\}/);
    assert.doesNotMatch(table + dialog, /\/auth\/session/);
  });
});
