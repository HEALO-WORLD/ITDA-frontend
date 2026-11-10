import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * STEP 3-2-2B-6: 장비 관리 변경 요청의 로그인 세션 정합성.
 * 실제 Server Action(equipment/actions.ts)·remote.ts를 쓰고, Gateway 요청(apiRequestData)·세션 확인·같은 출처·refresh만 가짜.
 * 공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts. 실제 백엔드 요청 없음.
 */

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EQUIPMENT = "33333333-3333-4333-8333-333333333333";
const NEW_EQUIPMENT = "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
const EXAM_TYPE = "55555555-5555-4555-8555-555555555555";
/** 화면이 렌더링된 로그인 세션 구분 값 */
const LOGIN = "loginSessionTagA";
const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
const OK_ACCESS = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: "u", institutionId: ORG } };

type Call = { method: string; path: string; body?: unknown };
const state = {
  loginSession: LOGIN as string | null,
  access: OK_ACCESS as { ok: boolean; reason?: string; message?: string },
  calls: [] as Call[],
  /** 다음 Gateway 요청을 이 오류로 실패시킨다 */
  error: null as unknown,
  refreshCount: 0,
};

const link = (equipmentId: string, examTypeId: string, durationMinutes: number) => ({
  id: "4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c",
  equipmentId,
  examTypeId,
  examTypeName: "흉부 CT",
  modality: "CT",
  durationMinutes,
});

let actions: typeof import("@/features/equipment/actions");

before(async () => {
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "equipment,slots";
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => state.access,
      // 실제 함수와 같은 순서: 형식 확인 → 역할 확인 → 쿠키의 로그인 세션 비교
      requireRoleMutationAccess: async (_role: string, expected: unknown) => {
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
        state.calls.push({ method, path, body: options.body });
        if (state.error) throw state.error;
        const body = options.body ?? {};
        if (method === "POST" && path === `/api/v1/institutions/${ORG}/equipments`) {
          return { id: NEW_EQUIPMENT, institutionId: ORG, name: body.name, modality: body.modality, status: "OPERATIONAL" };
        }
        const equipmentPatch = /^\/api\/v1\/equipments\/([0-9a-f-]{36})$/.exec(path);
        if (method === "PATCH" && equipmentPatch) return { id: equipmentPatch[1], institutionId: ORG, name: body.name, modality: "CT", status: "OPERATIONAL" };
        const linkPost = /^\/api\/v1\/equipments\/([0-9a-f-]{36})\/exam-types$/.exec(path);
        if (method === "POST" && linkPost) return link(linkPost[1], body.examTypeId as string, body.durationMinutes as number);
        const linkPatch = /^\/api\/v1\/equipments\/([0-9a-f-]{36})\/exam-types\/([0-9a-f-]{36})$/.exec(path);
        if (method === "PATCH" && linkPatch) return link(linkPatch[1], linkPatch[2], body.durationMinutes as number);
        const hoursPut = /^\/api\/v1\/equipments\/([0-9a-f-]{36})\/operating-hours$/.exec(path);
        if (method === "PUT" && hoursPut) {
          return (body.operatingHours as { week: number; startTime: string; endTime: string }[]).map((item, index) => ({
            id: `7${index}7${index}7${index}7${index}-0000-4000-8000-00000000000${index}`,
            equipmentId: hoursPut[1],
            ...item,
          }));
        }
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  actions = await import("@/features/equipment/actions");
});

beforeEach(() => {
  state.loginSession = LOGIN;
  state.access = OK_ACCESS;
  state.calls = [];
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
const HOURS = [{ weekday: 1, open: "09:00", close: "12:00" }];

/** 6개 변경 Action: 같은 입력으로 렌더링 세션 값만 바꿔 부른다 */
const MUTATIONS: { name: string; call: (login?: unknown) => Promise<{ ok: boolean; reason?: string }>; method: string }[] = [
  { name: "장비 등록 createEquipmentAction (POST)", method: "POST", call: (login) => actions.createEquipmentAction({ name: "CT-9", modality: "CT" }, login) },
  { name: "장비 정보 수정 updateEquipmentAction (PATCH)", method: "PATCH", call: (login) => actions.updateEquipmentAction(EQUIPMENT, { name: "CT-1 수정" }, login) },
  { name: "지원 검사 유형 추가 addEquipmentExamTypeAction (POST)", method: "POST", call: (login) => actions.addEquipmentExamTypeAction(EQUIPMENT, { examTypeId: EXAM_TYPE, durationMinutes: 30 }, login) },
  { name: "검사 소요 시간 수정 updateEquipmentExamTypeDurationAction (PATCH)", method: "PATCH", call: (login) => actions.updateEquipmentExamTypeDurationAction(EQUIPMENT, EXAM_TYPE, 40, login) },
  { name: "운영시간 저장 saveEquipmentOperatingHoursAction (PUT)", method: "PUT", call: (login) => actions.saveEquipmentOperatingHoursAction(EQUIPMENT, HOURS, login) },
  {
    name: "장비 등록(검사 유형·운영시간 포함) createEquipmentWithExamTypesAction (POST·POST·PUT)",
    method: "POST",
    call: (login) => actions.createEquipmentWithExamTypesAction({ name: "CT-9", modality: "CT", examTypes: [{ examTypeId: EXAM_TYPE, durationMinutes: 30 }], operatingHours: HOURS }, login),
  },
];

describe("장비 관리 변경 Action: 로그인 세션 정합성 (STEP 3-2-2B-6)", () => {
  for (const mutation of MUTATIONS) {
    describe(mutation.name, () => {
      it("같은 세션(Refresh Token 회전 포함: 로그인 세션 값은 그대로): 정상 처리, 변경 요청 전송, 목록 다시 그리기", async () => {
        const result = await mutation.call(LOGIN);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.ok(state.calls.some((call) => call.method === mutation.method));
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
      for (const mutation of MUTATIONS.slice(0, 5)) {
        state.error = new ApiError("HTTP", "x", { status });
        state.refreshCount = 0;
        const result = await quiet(() => mutation.call(LOGIN));
        assert.equal(result.reason, reason, `${mutation.name} ${status}`);
        assert.equal(state.refreshCount, refreshes, `${mutation.name} ${status} refresh`);
      }
    }
  });

  it("입력 검증은 세션 확인과 무관하게 그대로 (잘못된 입력은 요청 없이 INVALID)", async () => {
    assert.equal((await actions.createEquipmentAction({ name: "", modality: "CT" }, LOGIN)).ok, false);
    assert.equal(((await actions.updateEquipmentAction("not-uuid", { name: "x" }, LOGIN)) as { reason: string }).reason, "INVALID");
    assert.equal(((await actions.saveEquipmentOperatingHoursAction(EQUIPMENT, [], LOGIN)) as { reason: string }).reason, "INVALID");
    assert.deepEqual(state.calls, []);
  });

  it("화면: 네 변경 화면 모두 렌더링 세션을 보내고, SESSION_CHANGED면 공유 잠금으로 변경 버튼을 막는다", () => {
    const dialogs = readFileSync("src/features/equipment/components/EquipmentApiDialogs.tsx", "utf8").replace(/\r\n/g, "\n");
    const workspace = readFileSync("src/features/equipment/components/EquipmentApiWorkspace.tsx", "utf8").replace(/\r\n/g, "\n");
    for (const pattern of [
      /updateEquipmentAction\(equipment\.id, \{ name \}, renderedLoginSession\)/,
      /createEquipmentAction\(\{ name, modality \}, renderedLoginSession\)/,
      /addEquipmentExamTypeAction\(equipment\.id, \{ examTypeId, durationMinutes: duration\.value \}, renderedLoginSession\)/,
      /updateEquipmentExamTypeDurationAction\(equipment\.id, target\.examTypeId, duration\.value, renderedLoginSession\)/,
    ]) assert.match(dialogs, pattern);
    assert.match(workspace, /saveEquipmentOperatingHoursAction\(created\.equipmentId, operatingHours, renderedLoginSession\)/);
    assert.match(workspace, /saveEquipmentOperatingHoursAction\(equipmentId, toOperatingDaysPayload\(days\), renderedLoginSession\)/);
    assert.match(workspace, /createEquipmentWithExamTypesAction\(\s*\{[\s\S]*?\},\s*renderedLoginSession,\s*\)/);
    assert.equal((dialogs.match(/markEquipmentSessionChanged\(\)/g) ?? []).length, 3, "정보 수정·등록, 검사 유형 추가, 소요 시간 수정");
    assert.equal((workspace.match(/markEquipmentSessionChanged\(\)/g) ?? []).length, 3, "등록, 등록 뒤 운영시간 다시 저장, 운영시간 수정");
    assert.equal((dialogs.match(/disabled=\{pending \|\| sessionChanged\}/g) ?? []).length, 3);
    assert.equal((workspace.match(/disabled=\{pending \|\| sessionChanged\}/g) ?? []).length, 2);
    assert.doesNotMatch(dialogs + workspace, /\/auth\/session/);
  });
});
