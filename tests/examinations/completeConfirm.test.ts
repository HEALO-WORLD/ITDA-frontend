import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiError } from "@/lib/api/errors";

/**
 * 검사 완료 확인 창 (API 모드 검사 진행·결과 화면). 실제 네트워크·DB 요청 없음.
 * - Server Function(changeExaminationStatusAction)·remote.ts는 실제 코드를 쓰고, Gateway 요청(apiRequestData)·users/me·
 *   같은 출처 확인·next/headers·next/cache만 가짜로 바꾼다
 * - 화면은 서버 렌더링으로 첫 상태(버튼·창 닫힘)를 확인한다. 클릭 흐름(창 열기·취소·확정·연속 클릭·요청 중 닫기 막기)은
 *   DOM 테스트 도구가 없어 브라우저에서 실제 컴포넌트로 확인했다 (작업 보고 참고). 여기서는 그 흐름을 정하는 코드 연결을 함께 확인한다
 */

const EXAM = "e0000000-0000-4000-8000-000000000001";
const REFERRAL = "a0000000-0000-4000-8000-000000000001";
const TOKEN_HEADERS = { Authorization: "Bearer secret-test-token" };

type Call = { path: string; method?: string; body?: unknown; headers?: HeadersInit };

/** 화면이 렌더링된 로그인 세션 구분 값 (공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts) */
const LOGIN = "loginSessionTagA";
const OK_ACCESS = { ok: true, headers: TOKEN_HEADERS, user: { userId: "u", institutionId: "i" } };

const state = {
  /** 지금 쿠키의 로그인 세션 구분 값 (다른 탭에서 계정이 바뀌면 달라진다) */
  loginSession: LOGIN as string | null,
  access: OK_ACCESS as { ok: boolean; reason?: string; message?: string },
  calls: [] as Call[],
  response: null as unknown,
  error: null as unknown,
  refreshCount: 0,
};
const statusResponse = (previousStatus: string, currentStatus: string) => ({
  examinationId: EXAM,
  referralId: REFERRAL,
  previousStatus,
  currentStatus,
  updatedAt: "2026-11-09T10:00:00",
});

let actions: typeof import("@/features/examinations/actions");
let Actions: typeof import("@/features/examinations/components/ExaminationApiActions").default;
const originalConsoleError = console.error;

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => OK_ACCESS,
      // 실제 함수와 같은 순서: 형식 확인 → 역할 확인 → 쿠키의 로그인 세션 비교
      requireRoleMutationAccess: async (_role: string, expected: unknown) => {
        const changed = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
        if (expected !== null && typeof expected !== "string") return changed;
        if (!state.access.ok) return state.access;
        return expected === state.loginSession ? state.access : changed;
      },
    },
  });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => true } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown; headers?: HeadersInit } = {}) => {
        state.calls.push({ path, method: options.method, body: options.body, headers: options.headers });
        if (state.error) throw state.error;
        return state.response;
      },
    },
  });
  actions = await import("@/features/examinations/actions");
  Actions = (await import("@/features/examinations/components/ExaminationApiActions")).default;
});

beforeEach(() => {
  state.loginSession = LOGIN;
  state.access = OK_ACCESS;
  state.calls = [];
  state.response = statusResponse("IN_PROGRESS", "COMPLETED");
  state.error = null;
  state.refreshCount = 0;
  console.error = () => {};
});

afterEach(() => {
  console.error = originalConsoleError;
});

const examination = (progressStatus: "WAITING" | "IN_PROGRESS" | "COMPLETED", extra: Record<string, unknown> = {}) => ({
  examinationId: EXAM,
  progressStatus,
  reservationStatus: "CONFIRMED",
  resultRegistered: false,
  examDate: "2026-11-09T00:00:00",
  startTime: "2026-11-09T09:30:00",
  endTime: "2026-11-09T10:00:00",
  ...extra,
});
const render = (progressStatus: "WAITING" | "IN_PROGRESS" | "COMPLETED", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(Actions, {
      examination: examination(progressStatus, extra) as never,
      detail: { referralId: REFERRAL, examTypeName: "뇌 MRI", equipmentName: "MRI 1호기" },
    }),
  );

describe("화면: 검사 완료 버튼과 확인 창 (첫 렌더링)", () => {
  it("진행 중이면 [검사 완료] 버튼은 확인 창을 여는 버튼이고, 창 내용·요청은 아직 없다", () => {
    const html = render("IN_PROGRESS");
    assert.match(html, /<button type="button" aria-busy="false" aria-haspopup="dialog"[^>]*>검사 완료<\/button>/);
    // 공통 Modal은 열려 있을 때만 내용을 그린다: 버튼을 누르기 전에는 확인 창 제목·확정 버튼이 없다
    assert.equal(html.includes("검사 완료 확정"), false, "확인 창은 닫혀 있다");
    assert.equal(html.includes("검사를 완료하시겠습니까?"), false, "확인 창 내용은 아직 그리지 않는다");
    assert.equal(state.calls.length, 0, "렌더링만으로 요청하지 않는다");
  });

  it("대기 중이면 [검사 시작]은 기존처럼 바로 요청하는 버튼이다 (확인 창 없음)", () => {
    const html = render("WAITING");
    assert.match(html, />검사 시작<\/button>/);
    assert.doesNotMatch(html, /aria-haspopup="dialog"[^>]*>검사 시작/);
    const blocked = render("WAITING", { reservationStatus: "BLOCKED" });
    assert.match(blocked, /<button[^>]*disabled=""[^>]*>검사 시작<\/button>/);
    assert.match(blocked, /예약이 확정된 검사만 시작할 수 있습니다/);
  });

  it("완료 + 결과 없음이면 [결과 등록]만, 결과까지 있으면 버튼 없음 (기존 조건 그대로)", () => {
    const pending = render("COMPLETED");
    assert.match(pending, />결과 등록<\/button>/);
    assert.equal(pending.includes(">검사 완료</button>"), false);
    const done = render("COMPLETED", { resultRegistered: true });
    assert.equal(/>(검사 시작|검사 완료|결과 등록)<\/button>/.test(done), false);
  });
});

describe("화면: 확인 흐름을 정하는 코드 연결", () => {
  const source = readFileSync(new URL("../../src/features/examinations/components/ExaminationApiActions.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("[검사 완료]는 창만 열고(openConfirm), 요청은 [검사 완료 확정](confirmComplete)에서만 한다", () => {
    assert.match(source, /onClick=\{next === "COMPLETED" \? openConfirm : changeStatus\}/);
    const open = source.slice(source.indexOf("const openConfirm"), source.indexOf("const confirmComplete"));
    assert.equal(open.includes("changeExaminationStatusAction"), false);
    assert.match(open, /setConfirmError\(null\)/, "다시 열면 이전 오류를 지운다");
  });

  it("확정: 요청 중 재요청 막기(ref), 실패는 창 유지 + 창 안 안내, 성공만 창 닫기", () => {
    const confirm = source.slice(source.indexOf("const confirmComplete"), source.indexOf("const changeStatus"));
    assert.match(confirm, /pendingRef\.current \|\|/);
    assert.equal((confirm.match(/changeExaminationStatusAction\(/g) ?? []).length, 1);
    assert.match(confirm, /if \(result\.ok\) \{\s*setConfirmOpen\(false\);/);
    assert.match(confirm, /\} else \{\s*setConfirmError\(result\);/);
  });

  it("요청 중에는 확정·취소 버튼과 Esc·닫기 버튼(preventClose)을 막고, 409 뒤에는 다시 확정하지 못한다", () => {
    const modal = source.slice(source.indexOf('title="검사를 완료하시겠습니까?"'), source.indexOf("open={registerOpen}"));
    assert.match(modal, /preventClose=\{pending\}/);
    assert.match(modal, /closeOnBackdrop=\{false\}/);
    assert.match(modal, /disabled=\{pending\} className=\{secondaryClass\}/);
    // STEP 3-2-2B-3: 다른 탭 계정 변경(SESSION_CHANGED) 뒤에도 다시 확정하지 못한다
    assert.match(modal, /disabled=\{pending \|\| sessionChanged \|\| confirmError\?\.reason === "CONFLICT"\}/);
  });

  it("창에 목록 값으로 의뢰 번호·검사 유형·장비·예정 일시·현재/변경 상태를 보여 준다 (추가 조회 없음)", () => {
    for (const label of ["의뢰 번호", "검사 유형", "검사 장비", "검사 예정 일시", "현재 상태", "변경 상태"]) assert.ok(source.includes(`>${label}</dt>`), label);
    assert.equal(/fetch|loadExamination|apiRequest/.test(source.slice(source.indexOf("export default function"), source.indexOf("const fieldLabelClass"))), false);
  });
});

describe("Server Function: 검사 완료 확정 요청", () => {
  it("PATCH /api/v1/examinations/{id}/status { status: COMPLETED }를 정확히 1회 보내고, 성공하면 목록을 서버 값으로 다시 불러온다", async () => {
    const result = await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN);
    assert.deepEqual(result, { ok: true, message: "검사를 완료 처리했습니다." });
    assert.deepEqual(state.calls, [{ path: `/api/v1/examinations/${EXAM}/status`, method: "PATCH", body: { status: "COMPLETED" }, headers: TOKEN_HEADERS }]);
    assert.equal(state.refreshCount, 1);
  });

  it("409(다른 화면에서 먼저 처리 등)는 CONFLICT + 서버 재조회(refresh) — 기존 정책 그대로", async () => {
    state.error = new ApiError("HTTP", "x", { status: 409, code: "INVALID_EXAMINATION_STATUS_TRANSITION" });
    const result = await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "CONFLICT");
    assert.equal(state.refreshCount, 1);
  });

  it("그 밖의 실패(500·네트워크)는 화면 데이터를 그대로 둔다 (refresh 없음 → 기존 상태 유지)", async () => {
    for (const error of [new ApiError("HTTP", "x", { status: 500 }), new ApiError("NETWORK", "x")]) {
      state.error = error;
      state.refreshCount = 0;
      const result = await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN);
      assert.equal(result.ok, false);
      assert.equal(state.refreshCount, 0);
    }
  });

  it("검사 시작(IN_PROGRESS) 요청은 그대로 동작한다", async () => {
    state.response = statusResponse("SCHEDULED", "IN_PROGRESS");
    const result = await actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN);
    assert.deepEqual(result, { ok: true, message: "검사를 시작했습니다." });
    assert.deepEqual(state.calls[0].body, { status: "IN_PROGRESS" });
  });

  it("결과 등록 Server Function은 그대로 동작한다", async () => {
    state.response = { resultId: "f0000000-0000-4000-8000-000000000001", examinationId: EXAM, registeredAt: "2026-11-09T11:00:00" };
    const result = await actions.registerExaminationResultAction(EXAM, { summary: "정상", notes: "" }, LOGIN);
    assert.equal(result.ok, true);
    assert.equal(state.calls[0].method, "POST");
    assert.equal(state.calls[0].path, `/api/v1/examinations/${EXAM}/results`);
  });
});


describe("Server Function: 로그인 세션 정합성 (STEP 3-2-2B-3)", () => {
  const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
  const RESULT = { summary: "정상", notes: "" };

  it("다른 탭에서 계정이 바뀌면 상태 변경(시작·완료)·결과 등록 모두 SESSION_CHANGED, 백엔드 요청 0회, 목록 다시 그리지 않음", async () => {
    state.loginSession = "loginSessionTagB";
    assert.deepEqual(await actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS", LOGIN), SESSION_CHANGED);
    assert.deepEqual(await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN), SESSION_CHANGED);
    assert.deepEqual(await actions.registerExaminationResultAction(EXAM, RESULT, LOGIN), SESSION_CHANGED);
    assert.equal(state.calls.length, 0, "PATCH .../status·POST .../results 모두 0회");
    assert.equal(state.refreshCount, 0);
  });

  it("렌더링 세션 인자를 빠뜨리면(undefined) 두 Action 모두 거부한다", async () => {
    assert.equal(((await actions.changeExaminationStatusAction(EXAM, "COMPLETED")) as { reason: string }).reason, "SESSION_CHANGED");
    assert.equal(((await actions.registerExaminationResultAction(EXAM, RESULT)) as { reason: string }).reason, "SESSION_CHANGED");
    assert.equal(state.calls.length, 0);
  });

  it("기존 입력 검증·인증·권한 실패는 그대로 구분 (SESSION_CHANGED로 덮지 않음)", async () => {
    assert.equal(((await actions.changeExaminationStatusAction(EXAM, "WAITING", LOGIN)) as { reason: string }).reason, "INVALID", "상태 전이 대상 검증");
    assert.equal(((await actions.registerExaminationResultAction(EXAM, { summary: " " }, LOGIN)) as { reason: string }).reason, "INVALID", "결과 요약 검증");
    state.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
    assert.equal(((await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN)) as { reason: string }).reason, "UNAUTHORIZED");
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
    assert.equal(((await actions.registerExaminationResultAction(EXAM, RESULT, LOGIN)) as { reason: string }).reason, "FORBIDDEN");
    state.access = { ok: false, reason: "SIGNED_OUT", message: "로그인 필요" };
    assert.equal(((await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN)) as { reason: string }).reason, "SIGNED_OUT");
    assert.equal(state.calls.length, 0);
  });

  it("같은 세션의 백엔드 오류 처리 유지: 400·401·403·404·409·5xx", async () => {
    // 5xx는 서버가 이미 반영했을 수 있어 결과 불명(UNCERTAIN)으로 바뀌었다 (P2: 변경 요청을 다시 보내지 않고 조회로 확인. 여기서는 조회도 같은 오류라 확인 실패)
    const cases: [number, string][] = [[400, "INVALID"], [401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [500, "UNCERTAIN"]];
    for (const [status, reason] of cases) {
      state.error = new ApiError("HTTP", "x", { status });
      const change = await actions.changeExaminationStatusAction(EXAM, "COMPLETED", LOGIN);
      const register = await actions.registerExaminationResultAction(EXAM, RESULT, LOGIN);
      assert.equal((change as { reason: string }).reason, reason, `상태 변경 ${status}`);
      assert.equal((register as { reason: string }).reason, reason, `결과 등록 ${status}`);
    }
  });

  it("화면은 렌더링 시점 로그인 세션을 세 변경 경로(시작·완료 확정·결과 등록)에 보내고, SESSION_CHANGED면 변경 버튼을 잠근다", () => {
    const source = readFileSync(new URL("../../src/features/examinations/components/ExaminationApiActions.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.match(source, /const renderedLoginSession = useRenderedLoginSession\(\);/);
    assert.match(source, /changeExaminationStatusAction\(examination\.examinationId, "COMPLETED", renderedLoginSession\)/);
    assert.match(source, /changeExaminationStatusAction\(examination\.examinationId, next, renderedLoginSession\)/);
    assert.match(source, /registerExaminationResultAction\(examinationId, \{ summary, notes \}, loginSession\)/);
    assert.match(source, /loginSession=\{renderedLoginSession\}/);
    assert.match(source, /disabled=\{pending \|\| startBlocked \|\| sessionChanged\}/);
    assert.match(source, /disabled=\{sessionChanged\}/);
    assert.match(source, /disabled=\{isSubmitting \|\| sessionLocked\}/);
    assert.doesNotMatch(source, /\/auth\/session/);
  });
});
