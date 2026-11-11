import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * P1-B: 장비 등록 POST 결과 불명 처리 (응답 없음·시간 초과·응답 형식 오류·5xx).
 * 실제 Server Action(equipment/actions.ts)·remote.ts를 쓰고, Gateway 요청(apiRequestData)·세션 확인·같은 출처·refresh만 가짜.
 * 백엔드에는 멱등 키가 없고 같은 기관 같은 장비명은 409(DUPLICATE_EQUIPMENT_NAME)로 막는다 (institution-service EquipmentService).
 * 실제 백엔드 요청 없음.
 */

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEW_EQUIPMENT = "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
const OTHER_EQUIPMENT = "3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b";
const EXAM_TYPE = "55555555-5555-4555-8555-555555555555";
const EXAM_TYPE_2 = "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b";
const LOGIN = "loginSessionTagA";
const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
const OK_ACCESS = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: "u", institutionId: ORG } };

type Equipment = { id: string; institutionId: string; name: string; modality: string; status: string };
const state = {
  loginSession: LOGIN as string | null,
  calls: [] as { method: string; path: string }[],
  /** 장비 등록 POST 동작: 오류를 던지거나, commitThenThrow면 서버에 저장한 뒤 오류 */
  createError: null as unknown,
  commitThenThrow: false,
  /** 서버(격리 DB 대신)의 장비 목록 */
  equipments: [] as Equipment[],
  listError: null as unknown,
  listTotalPages: 1,
  linkError: {} as Record<string, unknown>,
  hoursError: null as unknown,
  refreshCount: 0,
};

let actions: typeof import("@/features/equipment/actions");

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => OK_ACCESS,
      requireRoleMutationAccess: async (_role: string, expected: unknown) => (expected === state.loginSession ? OK_ACCESS : SESSION_CHANGED),
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({ reason: "FORBIDDEN", message: access.message, code: null }),
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
        const body = options.body ?? {};
        if (method === "POST" && path === `/api/v1/institutions/${ORG}/equipments`) {
          const created = { id: NEW_EQUIPMENT, institutionId: ORG, name: String(body.name), modality: String(body.modality), status: "OPERATIONAL" };
          if (state.createError && !state.commitThenThrow) throw state.createError;
          if (state.equipments.some((item) => item.name === created.name)) throw new ApiError("HTTP", "dup", { status: 409, code: "DUPLICATE_EQUIPMENT_NAME" });
          state.equipments.push(created);
          if (state.createError) throw state.createError; // 서버는 저장했지만 응답 단계에서 실패
          return created;
        }
        if (method === "GET" && path === `/api/v1/institutions/${ORG}/equipments`) {
          if (state.listError) throw state.listError;
          return { contents: state.equipments, totalElements: state.equipments.length, totalPages: state.listTotalPages, size: 100, number: 0 };
        }
        const linkPost = /^\/api\/v1\/equipments\/([0-9a-f-]{36})\/exam-types$/.exec(path);
        if (method === "POST" && linkPost) {
          const examTypeId = String(body.examTypeId);
          if (state.linkError[examTypeId]) throw state.linkError[examTypeId];
          return { id: "4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c", equipmentId: linkPost[1], examTypeId, examTypeName: "흉부 CT", modality: "CT", durationMinutes: body.durationMinutes };
        }
        const hoursPut = /^\/api\/v1\/equipments\/([0-9a-f-]{36})\/operating-hours$/.exec(path);
        if (method === "PUT" && hoursPut) {
          if (state.hoursError) throw state.hoursError;
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
  state.calls = [];
  state.createError = null;
  state.commitThenThrow = false;
  state.equipments = [];
  state.listError = null;
  state.listTotalPages = 1;
  state.linkError = {};
  state.hoursError = null;
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
const input = (name = "CT-2") => ({
  name,
  modality: "CT",
  examTypes: [
    { examTypeId: EXAM_TYPE, durationMinutes: 30 },
    { examTypeId: EXAM_TYPE_2, durationMinutes: 20 },
  ],
  operatingHours: [{ weekday: 1, open: "09:00", close: "12:00" }],
});
const count = (method: string, re: RegExp) => state.calls.filter((call) => call.method === method && re.test(call.path)).length;
const createPosts = () => count("POST", /\/institutions\/[^/]+\/equipments$/);
const followUps = () => count("POST", /\/exam-types$/) + count("PUT", /\/operating-hours$/);
type Result = { ok: boolean; reason?: string; message?: string; uncertain?: { lookup: string; equipmentId: string | null }; linkFailed?: number; hoursError?: string | null };

describe("장비 등록: 결과 불명 처리 (P1-B)", () => {
  it("정상 등록: 장비 POST 1회 → 검사 유형 2회 → 운영시간 PUT 1회", async () => {
    const result = (await actions.createEquipmentWithExamTypesAction(input(), LOGIN)) as Result;
    assert.equal(result.ok, true);
    assert.equal(createPosts(), 1);
    assert.equal(followUps(), 3);
    assert.equal(state.refreshCount, 1);
  });

  const unknownErrors: [string, unknown][] = [
    ["500", new ApiError("HTTP", "x", { status: 500 })],
    ["502", new ApiError("HTTP", "x", { status: 502 })],
    ["503", new ApiError("HTTP", "x", { status: 503 })],
    ["504", new ApiError("HTTP", "x", { status: 504 })],
    ["TIMEOUT", new ApiError("TIMEOUT", "x")],
    ["NETWORK", new ApiError("NETWORK", "x")],
    ["PARSE(응답 형식 오류)", new ApiError("PARSE", "x")],
  ];
  for (const [label, error] of unknownErrors) {
    it(`장비 POST ${label} (서버 미저장) → UNCERTAIN·목록 재조회 NOT_FOUND, POST 재전송 0회, 검사 유형·운영시간 진행 안 함`, async () => {
      state.createError = error;
      const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
      assert.equal(result.ok, false);
      assert.equal(result.reason, "UNCERTAIN", label);
      assert.deepEqual(result.uncertain, { lookup: "NOT_FOUND", equipmentId: null });
      assert.match(String(result.message), /먼저 확인하고, 없을 때만 다시 등록/);
      assert.equal(createPosts(), 1);
      assert.equal(followUps(), 0);
      assert.equal(count("GET", /\/equipments$/), 1, "목록 재조회는 GET 1회");
      assert.equal(state.refreshCount, 1);
    });
  }

  it("서버는 등록했지만 응답 유실(500): UNCERTAIN·목록에서 같은 이름 장비 발견(FOUND, 확정 아님), 후속 단계 진행 안 함", async () => {
    state.createError = new ApiError("HTTP", "x", { status: 500 });
    state.commitThenThrow = true;
    const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.deepEqual(result.uncertain, { lookup: "FOUND", equipmentId: NEW_EQUIPMENT });
    assert.match(String(result.message), /가능성이 큽니다/);
    assert.match(String(result.message), /동시에 등록했을 수도/, "같은 기관의 동시 등록 가능성도 알린다 (확정하지 않음)");
    assert.equal(state.equipments.length, 1, "장비는 하나만");
    assert.equal(followUps(), 0, "등록 여부가 확정되지 않은 장비에 검사 유형·운영시간을 저장하지 않는다");
    // 사용자가 같은 이름으로 다시 등록해도 백엔드가 409로 막는다 (중복 생성 없음)
    state.createError = null;
    const again = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
    assert.equal(again.reason, "CONFLICT");
    assert.equal(state.equipments.length, 1);
  });

  it("결과 불명 + 목록 재조회 실패 → LOOKUP_FAILED (목록에서 먼저 확인 안내)", async () => {
    state.createError = new ApiError("TIMEOUT", "x");
    state.listError = new ApiError("HTTP", "x", { status: 503 });
    const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.deepEqual(result.uncertain, { lookup: "LOOKUP_FAILED", equipmentId: null });
    assert.match(String(result.message), /확인하기 전에는 같은 요청을 다시 보내지 마세요/);
    assert.equal(state.refreshCount, 0, "목록 조회도 실패하면 화면을 다시 그리지 않는다 (등록 창의 안내가 사라지지 않게)");
  });

  it("결과 불명 + 장비가 한 페이지를 넘으면 못 찾았다고 '없음'으로 단정하지 않는다 (LOOKUP_FAILED)", async () => {
    state.createError = new ApiError("HTTP", "x", { status: 502 });
    state.listTotalPages = 2;
    const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
    assert.equal(result.uncertain?.lookup, "LOOKUP_FAILED");
  });

  it("같은 이름 장비가 이미 있으면 409 CONFLICT (결과 불명 아님, 장비·후속 요청 없음)", async () => {
    state.equipments.push({ id: OTHER_EQUIPMENT, institutionId: ORG, name: "CT-2", modality: "CT", status: "OPERATIONAL" });
    const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input("CT-2"), LOGIN))) as Result;
    assert.equal(result.reason, "CONFLICT");
    assert.match(String(result.message), /같은 이름의 장비가 이미 등록되어 있습니다/);
    assert.equal(state.equipments.length, 1);
    assert.equal(followUps(), 0);
  });

  it("확실한 실패(400·403)는 결과 불명이 아니다", async () => {
    for (const status of [400, 403]) {
      state.createError = new ApiError("HTTP", "x", { status });
      state.calls = [];
      const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
      assert.notEqual(result.reason, "UNCERTAIN", String(status));
      assert.equal(count("GET", /\/equipments$/), 0, String(status));
    }
  });

  it("검사 유형 연결 일부 실패·운영시간 저장 실패는 기존 부분 성공 처리 그대로", async () => {
    state.linkError[EXAM_TYPE_2] = new ApiError("HTTP", "x", { status: 409 });
    state.hoursError = new ApiError("HTTP", "x", { status: 500 });
    const result = (await quiet(() => actions.createEquipmentWithExamTypesAction(input(), LOGIN))) as Result;
    assert.equal(result.ok, true);
    assert.equal(result.linkFailed, 1);
    assert.ok(result.hoursError);
    assert.equal(createPosts(), 1);
  });

  it("SESSION_CHANGED면 장비 POST·목록 조회 0회 (기존 차단 그대로)", async () => {
    state.loginSession = "loginSessionTagB";
    const result = (await actions.createEquipmentWithExamTypesAction(input(), LOGIN)) as Result;
    assert.equal(result.reason, "SESSION_CHANGED");
    assert.equal(state.calls.length, 0);
  });

  it("단독 장비 등록(createEquipmentAction)도 같은 결과 불명 처리", async () => {
    state.createError = new ApiError("HTTP", "x", { status: 503 });
    state.commitThenThrow = true;
    const result = (await quiet(() => actions.createEquipmentAction({ name: "CT-3", modality: "CT" }, LOGIN))) as Result;
    assert.equal(result.reason, "UNCERTAIN");
    assert.equal(result.uncertain?.lookup, "FOUND");
    assert.equal(createPosts(), 1);
  });

  it("화면: 결과 불명이면 등록 버튼을 잠그고(다시 보내지 않음) 닫을 때 목록 위에 안내를 남긴다", () => {
    const source = readFileSync("src/features/equipment/components/EquipmentApiWorkspace.tsx", "utf8").replace(/\r\n/g, "\n");
    assert.match(source, /if \(result\.reason === "UNCERTAIN"\) setUncertain\(result\.message\);/);
    assert.match(source, /if \(pendingRef\.current \|\| sessionChanged \|\| uncertain \|\| !hasOpenDay\(days\)/);
    assert.match(source, /disabled=\{pending \|\| sessionChanged \|\| uncertain !== null\}/);
    assert.match(source, /if \(uncertain\) \{\n\s*onDone\(\{ tone: "warning", message: uncertain \}\);/);
    // 응답 자체를 받지 못한 경우(브라우저 오류)도 등록 버튼을 잠근다
    assert.match(source, /setUncertain\(message\);/);
  });
});
