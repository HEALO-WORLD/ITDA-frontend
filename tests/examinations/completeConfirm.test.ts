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

const state = {
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
      requireRoleAccess: async () => ({ ok: true, headers: TOKEN_HEADERS, user: { userId: "u", institutionId: "i" } }),
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
  state.calls = [];
  state.response = statusResponse("IN_PROGRESS", "COMPLETED");
  state.error = null;
  state.refreshCount = 0;
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "examinations";
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
    assert.match(modal, /disabled=\{pending \|\| confirmError\?\.reason === "CONFLICT"\}/);
  });

  it("창에 목록 값으로 의뢰 번호·검사 유형·장비·예정 일시·현재/변경 상태를 보여 준다 (추가 조회 없음)", () => {
    for (const label of ["의뢰 번호", "검사 유형", "검사 장비", "검사 예정 일시", "현재 상태", "변경 상태"]) assert.ok(source.includes(`>${label}</dt>`), label);
    assert.equal(/fetch|loadExamination|apiRequest/.test(source.slice(source.indexOf("export default function"), source.indexOf("const fieldLabelClass"))), false);
  });
});

describe("Server Function: 검사 완료 확정 요청", () => {
  it("PATCH /api/v1/examinations/{id}/status { status: COMPLETED }를 정확히 1회 보내고, 성공하면 목록을 서버 값으로 다시 불러온다", async () => {
    const result = await actions.changeExaminationStatusAction(EXAM, "COMPLETED");
    assert.deepEqual(result, { ok: true, message: "검사를 완료 처리했습니다." });
    assert.deepEqual(state.calls, [{ path: `/api/v1/examinations/${EXAM}/status`, method: "PATCH", body: { status: "COMPLETED" }, headers: TOKEN_HEADERS }]);
    assert.equal(state.refreshCount, 1);
  });

  it("409(다른 화면에서 먼저 처리 등)는 CONFLICT + 서버 재조회(refresh) — 기존 정책 그대로", async () => {
    state.error = new ApiError("HTTP", "x", { status: 409, code: "INVALID_EXAMINATION_STATUS_TRANSITION" });
    const result = await actions.changeExaminationStatusAction(EXAM, "COMPLETED");
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "CONFLICT");
    assert.equal(state.refreshCount, 1);
  });

  it("그 밖의 실패(500·네트워크)는 화면 데이터를 그대로 둔다 (refresh 없음 → 기존 상태 유지)", async () => {
    for (const error of [new ApiError("HTTP", "x", { status: 500 }), new ApiError("NETWORK", "x")]) {
      state.error = error;
      state.refreshCount = 0;
      const result = await actions.changeExaminationStatusAction(EXAM, "COMPLETED");
      assert.equal(result.ok, false);
      assert.equal(state.refreshCount, 0);
    }
  });

  it("검사 시작(IN_PROGRESS) 요청은 그대로 동작한다", async () => {
    state.response = statusResponse("SCHEDULED", "IN_PROGRESS");
    const result = await actions.changeExaminationStatusAction(EXAM, "IN_PROGRESS");
    assert.deepEqual(result, { ok: true, message: "검사를 시작했습니다." });
    assert.deepEqual(state.calls[0].body, { status: "IN_PROGRESS" });
  });

  it("결과 등록 Server Function은 그대로 동작한다", async () => {
    state.response = { resultId: "f0000000-0000-4000-8000-000000000001", examinationId: EXAM, registeredAt: "2026-11-09T11:00:00" };
    const result = await actions.registerExaminationResultAction(EXAM, { summary: "정상", notes: "" });
    assert.equal(result.ok, true);
    assert.equal(state.calls[0].method, "POST");
    assert.equal(state.calls[0].path, `/api/v1/examinations/${EXAM}/results`);
  });
});

describe("Mock 화면 회귀", () => {
  it("Mock 검사 화면(ExaminationBoard·ExaminationTable)은 API 확인 창·Server Function을 쓰지 않는다", () => {
    for (const file of ["ExaminationBoard.tsx", "ExaminationTable.tsx"]) {
      const source = readFileSync(new URL(`../../src/features/examinations/components/${file}`, import.meta.url), "utf8");
      assert.equal(source.includes("ExaminationApiActions"), false, file);
      assert.equal(source.includes("changeExaminationStatusAction"), false, file);
    }
  });
});
