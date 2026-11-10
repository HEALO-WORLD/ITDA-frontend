import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * STEP 3-2-2B-8: 관리자 변경 요청의 로그인 세션 정합성.
 * 실제 Server Action(admin/actions.ts)·remote.ts를 쓰고, Gateway 요청(apiRequestData)·세션 확인·같은 출처·refresh만 가짜.
 * 공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts. 실제 백엔드 요청 없음 (기관 삭제 포함).
 */

const USER = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const INSTITUTION = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const EXAM_TYPE = "55555555-5555-4555-8555-555555555555";
/** 화면이 렌더링된 로그인 세션 구분 값 */
const LOGIN = "loginSessionTagA";
const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
const OK_ACCESS = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: "admin", institutionId: null } };

type Call = { method: string; path: string };
const state = {
  loginSession: LOGIN as string | null,
  access: OK_ACCESS as { ok: boolean; reason?: string; message?: string },
  calls: [] as Call[],
  roles: [] as string[],
  /** 다음 Gateway 요청을 이 오류로 실패시킨다 */
  error: null as unknown,
  refreshCount: 0,
};

const institution = (id: string, body: Record<string, unknown>) => ({
  id,
  name: body.name,
  type: body.type ?? "EXAM",
  address: body.address,
  careInstitutionCode: body.careInstitutionCode ?? "12345678",
  active: true,
  createdAt: "2026-11-01T09:00:00",
});

let actions: typeof import("@/features/admin/actions");

before(async () => {
  process.env.NEXT_PUBLIC_API_MODE = "api";
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
      apiRequestData: async (path: string, options: { method?: string; body?: Record<string, unknown> } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ method, path });
        if (state.error) throw state.error;
        const body = options.body ?? {};
        if (method === "PATCH" && path === `/api/v1/users/${USER}/approve`) {
          return { userId: USER, loginId: "new_user", role: "REQUESTER", active: true, institutionId: INSTITUTION, institutionName: "새의원", createdAt: "2026-11-01T09:00:00" };
        }
        if (method === "POST" && path === "/api/v1/institutions") return institution("f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3", body);
        if (method === "PATCH" && path === `/api/v1/institutions/${INSTITUTION}`) return institution(INSTITUTION, body);
        if (method === "DELETE" && path === `/api/v1/institutions/${INSTITUTION}`) return null;
        if (method === "POST" && path === "/api/v1/exam-types") return { id: "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4", name: body.name, modality: body.modality };
        if (method === "PATCH" && path === `/api/v1/exam-types/${EXAM_TYPE}`) return { id: EXAM_TYPE, name: body.name, modality: "CT" };
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  actions = await import("@/features/admin/actions");
});

beforeEach(() => {
  state.loginSession = LOGIN;
  state.access = OK_ACCESS;
  state.calls = [];
  state.roles = [];
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
type Result = { ok: boolean; reason?: string };

/** 6개 변경 Action: 같은 입력으로 렌더링 세션 값만 바꿔 부른다 */
const MUTATIONS: { name: string; method: string; path: string; call: (login?: unknown) => Promise<Result> }[] = [
  { name: "가입 승인 approveUserAction (PATCH)", method: "PATCH", path: `/api/v1/users/${USER}/approve`, call: (login) => actions.approveUserAction(USER, login) },
  {
    name: "기관 등록 createInstitutionAction (POST)",
    method: "POST",
    path: "/api/v1/institutions",
    call: (login) => actions.createInstitutionAction({ name: "새검사센터", type: "EXAM", address: "서울시 중구", careInstitutionCode: "12345678" }, login),
  },
  {
    name: "기관 수정 updateInstitutionAction (PATCH)",
    method: "PATCH",
    path: `/api/v1/institutions/${INSTITUTION}`,
    call: (login) => actions.updateInstitutionAction(INSTITUTION, { name: "수정검사센터", address: "서울시 종로구" }, login),
  },
  { name: "기관 삭제 deleteInstitutionAction (DELETE)", method: "DELETE", path: `/api/v1/institutions/${INSTITUTION}`, call: (login) => actions.deleteInstitutionAction(INSTITUTION, login) },
  { name: "검사 유형 등록 createExamTypeAction (POST)", method: "POST", path: "/api/v1/exam-types", call: (login) => actions.createExamTypeAction({ name: "복부 CT", modality: "CT" }, login) },
  { name: "검사 유형 이름 수정 updateExamTypeAction (PATCH)", method: "PATCH", path: `/api/v1/exam-types/${EXAM_TYPE}`, call: (login) => actions.updateExamTypeAction(EXAM_TYPE, { name: "흉부 CT(조영)" }, login) },
];

describe("관리자 변경 Action: 로그인 세션 정합성 (STEP 3-2-2B-8)", () => {
  for (const mutation of MUTATIONS) {
    describe(mutation.name, () => {
      it("같은 세션(Refresh Token 회전 포함: 로그인 세션 값은 그대로): ADMIN으로 확인, 정상 처리, 변경 요청 1회, 목록 다시 그리기", async () => {
        const result = await mutation.call(LOGIN);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(state.roles, ["ADMIN"]);
        assert.deepEqual(state.calls, [{ method: mutation.method, path: mutation.path }]);
        assert.equal(state.refreshCount, 1);
      });

      it("다른 탭에서 계정이 바뀌면 SESSION_CHANGED: Gateway 요청 0회, 목록 다시 그리지 않음", async () => {
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
        state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "관리자 아님" };
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

  it("입력 검증은 그대로 (잘못된 입력은 세션 확인·요청 없이 INVALID)", async () => {
    const results: Result[] = [
      await actions.approveUserAction("not-uuid", LOGIN),
      await actions.createInstitutionAction({ name: "", type: "EXAM", address: "서울", careInstitutionCode: "1234" }, LOGIN),
      await actions.updateInstitutionAction(INSTITUTION, { name: "", address: "서울" }, LOGIN),
      await actions.deleteInstitutionAction("not-uuid", LOGIN),
      await actions.createExamTypeAction({ name: "복부 CT", modality: "XRAY" }, LOGIN),
      await actions.updateExamTypeAction(EXAM_TYPE, { name: "   " }, LOGIN),
    ];
    assert.deepEqual(results.map((result) => result.reason), Array(6).fill("INVALID"));
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.roles, []);
  });

  it("화면: 관리자 변경 요청 모두 렌더링 세션을 보내고, SESSION_CHANGED면 공유 잠금으로 변경 버튼을 막는다 (처리 중 중복 제출도 막는다)", () => {
    const read = (name: string) => readFileSync(`src/features/admin/components/${name}`, "utf8").replace(/\r\n/g, "\n");
    const users = read("AdminUserTable.tsx");
    const institutions = read("AdminInstitutionManager.tsx");
    const examTypes = read("AdminExamTypeManager.tsx");
    assert.match(users, /approveUserAction\(target\.userId, renderedLoginSession\)/);
    assert.match(institutions, /createInstitutionAction\(values, renderedLoginSession\)/);
    assert.match(institutions, /updateInstitutionAction\(institution!\.id, \{ name: values\.name, address: values\.address \}, renderedLoginSession\)/);
    assert.match(institutions, /deleteInstitutionAction\(institution\.id, renderedLoginSession\)/);
    assert.match(examTypes, /updateExamTypeAction\(editing\.id, \{ name \}, renderedLoginSession\)/);
    assert.match(examTypes, /createExamTypeAction\(\{ name, modality \}, renderedLoginSession\)/);
    assert.equal((users.match(/markAdminSessionChanged\(\)/g) ?? []).length, 1);
    assert.equal((institutions.match(/markAdminSessionChanged\(\)/g) ?? []).length, 2, "등록·수정 폼, 삭제 확인");
    assert.equal((examTypes.match(/markAdminSessionChanged\(\)/g) ?? []).length, 1);
    assert.equal((users.match(/disabled=\{pending \|\| sessionChanged\}/g) ?? []).length, 1);
    assert.equal((institutions.match(/disabled=\{pending \|\| sessionChanged\}/g) ?? []).length, 2);
    assert.equal((examTypes.match(/disabled=\{pending \|\| sessionChanged\}/g) ?? []).length, 1);
    assert.equal((users + institutions + examTypes).match(/pendingRef\.current \|\| sessionChanged/g)?.length, 4, "처리 중·잠금이면 다시 보내지 않는다");
    assert.doesNotMatch(users + institutions + examTypes, /\/auth\/session/);
  });
});
