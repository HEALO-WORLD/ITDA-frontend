import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ApiError } from "@/lib/api/errors";

/**
 * 검사 진행 중 장비 장애의 "수동 확인 필요" 표시 테스트 (검사기관·관리자 장애 상세). 실제 네트워크 요청 없음.
 * - Gateway 요청(apiRequestData)·users/me(requireRoleAccess)·Next 헤더/캐시/내비게이션은 가짜로 바꾼다
 * - remote(응답 형식 검증)·server(pickReferral)·admin/incidents(관리자 매핑)·두 모달의 영향 의뢰 카드는 실제 코드를 쓴다
 * - manualReviewRequired는 백엔드가 판단한 값을 그대로 쓰는지만 본다 (화면에서 조건을 다시 계산하지 않는다)
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const INCIDENT = "77777777-7777-4777-8777-777777777777";
const REFERRAL = "22222222-2222-4222-8222-222222222222";
const RESERVATION = "aaaaaaaa-8888-4888-8888-888888888888";
const TASK = "bbbbbbbb-9999-4999-8999-999999999999";

const NOTICE = "장비 장애 발생 당시 검사가 진행 중이어서 자동 재조정 대상에서 제외되었습니다.";
const NOTICE_MEANING = "‘처리 완료’는 자동 장애 처리 작업이 끝났다는 뜻이며, 검사 완료나 담당자의 확인 완료를 뜻하지 않습니다.";

type Access = { ok: true; headers: HeadersInit; user: { userId: string; institutionId: string } };
const okAccess: Access = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: USER, institutionId: ORG } };

// 백엔드 IncidentReferralResponse 항목 (overrides로 필드를 바꾸거나, undefined를 넣어 필드를 뺀다)
function referralJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: TASK,
    incidentId: INCIDENT,
    referralId: REFERRAL,
    reservationId: RESERVATION,
    processingStatus: "SUCCEEDED",
    retryCount: 0,
    nextRetryAt: null,
    lockedUntil: null,
    lastError: null,
    resultCode: "SKIPPED_IN_PROGRESS",
    processedAt: "2026-11-09T14:05:12",
    manualReviewRequired: true,
    ...overrides,
  };
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }
  return item;
}

const pageOf = (...contents: Record<string, unknown>[]) => ({
  contents,
  totalElements: contents.length,
  totalPages: contents.length === 0 ? 0 : 1,
  size: 10,
  number: 0,
});

const state = { referralPage: pageOf(referralJson()) as unknown };

function reset() {
  state.referralPage = pageOf(referralJson());
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "incidents,equipment";
}

let remote: typeof import("@/features/incidents/remote");
let server: typeof import("@/features/incidents/server");
let adminIncidents: typeof import("@/features/admin/incidents");
let ExaminingItem: typeof import("@/features/incidents/components/IncidentApiDetailModal").AffectedItem;
let AdminItem: typeof import("@/features/admin/components/AdminIncidentDetailModal").AffectedItem;

before(async () => {
  reset();
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => okAccess,
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({ reason: access.reason, message: access.message, code: null }),
      clearAccessTokenCookie: async () => {},
      getAuthState: async () => ({ ok: false }),
      getExaminationAuthorizationHeaders: async () => ({}),
      setAccessTokenCookie: async () => {},
      verifyAccessToken: async () => null,
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string) => {
        if (path === `/api/v1/equipment-incidents/${INCIDENT}/referrals`) return state.referralPage;
        throw new Error(`unexpected request ${path}`);
      },
    },
  });
  mock.module("next/cache", { namedExports: { refresh: () => {} } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } });
  mock.module("next/navigation", {
    namedExports: {
      unstable_rethrow: () => {},
      useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
      useSearchParams: () => new URLSearchParams(),
      usePathname: () => "/",
    },
  });

  remote = await import("@/features/incidents/remote");
  server = await import("@/features/incidents/server");
  adminIncidents = await import("@/features/admin/incidents");
  ExaminingItem = (await import("@/features/incidents/components/IncidentApiDetailModal")).AffectedItem;
  AdminItem = (await import("@/features/admin/components/AdminIncidentDetailModal")).AffectedItem;
});

beforeEach(reset);

const fetchFirst = async () => (await remote.fetchIncidentReferralPage(INCIDENT)).contents[0];

async function examiningItems() {
  const result = await server.loadIncidentReferralPage(INCIDENT, 0);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.items;
}

async function adminItems() {
  const result = await adminIncidents.loadAdminIncidentReferrals(INCIDENT, 0);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.referrals;
}

// ── 1. 응답 형식 검증 (remote) ──

describe("영향 의뢰 응답의 manualReviewRequired 형식 검증", () => {
  it("true·false를 그대로 받는다", async () => {
    assert.equal((await fetchFirst()).manualReviewRequired, true);

    state.referralPage = pageOf(referralJson({ manualReviewRequired: false }));
    assert.equal((await fetchFirst()).manualReviewRequired, false);
  });

  it("필드가 없는 이전 백엔드 응답도 정상 응답으로 받는다", async () => {
    state.referralPage = pageOf(referralJson({ manualReviewRequired: undefined }));

    const item = await fetchFirst();
    assert.equal("manualReviewRequired" in item, false);
    assert.equal(item.resultCode, "SKIPPED_IN_PROGRESS");
  });

  it("boolean이 아닌 값(null·문자열·숫자)은 형식 오류로 거부한다", async () => {
    for (const bad of [null, "true", 1]) {
      state.referralPage = pageOf(referralJson({ manualReviewRequired: bad }));
      await assert.rejects(fetchFirst(), (error: unknown) => error instanceof ApiError && error.kind === "PARSE", String(bad));
    }
  });
});

// ── 2. 화면 데이터 매핑 (검사기관 pickReferral·관리자 매핑) ──

describe("화면으로 넘기는 영향 의뢰 데이터", () => {
  it("검사기관: pickReferral이 manualReviewRequired를 빠뜨리지 않고 넘긴다", async () => {
    state.referralPage = pageOf(referralJson(), referralJson({ id: "cccccccc-9999-4999-8999-999999999999", manualReviewRequired: false }));

    const items = await examiningItems();
    assert.deepEqual(items.map((item) => item.manualReviewRequired), [true, false]);
    // 화면에 쓰지 않는 lastError는 여전히 넘기지 않는다
    assert.equal("lastError" in items[0], false);
  });

  it("검사기관: 필드가 없으면 false로 채워 undefined를 넘기지 않는다", async () => {
    state.referralPage = pageOf(referralJson({ manualReviewRequired: undefined }));

    const [item] = await examiningItems();
    assert.equal(item.manualReviewRequired, false);
  });

  it("관리자: manualReviewRequired와 lastError를 함께 유지하고, 필드가 없으면 false로 채운다", async () => {
    state.referralPage = pageOf(referralJson({ lastError: "[RETRYABLE] 가상 오류" }));
    const [withValue] = await adminItems();
    assert.equal(withValue.manualReviewRequired, true);
    assert.equal(withValue.lastError, "[RETRYABLE] 가상 오류");

    state.referralPage = pageOf(referralJson({ manualReviewRequired: undefined }));
    const [missing] = await adminItems();
    assert.equal(missing.manualReviewRequired, false);
  });

  it("관리자: 형식이 잘못된 값이면 일부만 보여주지 않고 전체 실패로 처리한다", async () => {
    state.referralPage = pageOf(referralJson({ manualReviewRequired: "yes" }));

    const result = await adminIncidents.loadAdminIncidentReferrals(INCIDENT, 0);
    assert.equal(result.ok, false);
  });
});

// ── 3. 영향 의뢰 카드 (검사기관·관리자) ──

type ExaminingItemProps = Parameters<typeof ExaminingItem>[0]["item"];
type AdminItemProps = Parameters<typeof AdminItem>[0]["item"];

const examiningItem = (overrides: Partial<ExaminingItemProps> = {}): ExaminingItemProps => ({
  id: TASK,
  incidentId: INCIDENT,
  referralId: REFERRAL,
  reservationId: RESERVATION,
  processingStatus: "SUCCEEDED",
  retryCount: 0,
  nextRetryAt: null,
  lockedUntil: null,
  resultCode: "SKIPPED_IN_PROGRESS",
  processedAt: "2026-11-09T14:05:12",
  manualReviewRequired: true,
  ...overrides,
});

const renderExamining = (item: ExaminingItemProps) => renderToStaticMarkup(createElement("ul", null, createElement(ExaminingItem, { item })));
const renderAdmin = (item: AdminItemProps) => renderToStaticMarkup(createElement("ul", null, createElement(AdminItem, { item })));

describe("검사기관 장애 상세: 영향 의뢰 카드", () => {
  it("true면 '처리 완료'와 '수동 확인 필요' 배지를 함께 보여주고 안내를 붙인다", () => {
    const html = renderExamining(examiningItem());

    assert.match(html, /처리 완료/);
    assert.match(html, /수동 확인 필요/);
    assert.ok(html.includes(NOTICE));
    assert.ok(html.includes(NOTICE_MEANING));
    assert.match(html, /role="note"/);
  });

  it("false면 배지와 안내를 보여주지 않고 기존 처리 상태 배지만 남는다", () => {
    const html = renderExamining(examiningItem({ manualReviewRequired: false, resultCode: "RESCHEDULE_REQUIRED" }));

    assert.match(html, /처리 완료/);
    assert.doesNotMatch(html, /수동 확인 필요/);
    assert.ok(!html.includes(NOTICE));
  });

  it("값이 없으면(이전 데이터) 배지를 보여주지 않는다", () => {
    const item = examiningItem();
    delete (item as Partial<ExaminingItemProps>).manualReviewRequired;

    const html = renderExamining(item);
    assert.doesNotMatch(html, /수동 확인 필요/);
    assert.ok(!html.includes(NOTICE));
  });

  it("다른 처리 상태(대기·처리 중·실패)는 기존 배지 그대로 보여준다", () => {
    for (const [status, label] of [["PENDING", "대기"], ["PROCESSING", "처리 중"], ["FAILED", "실패"]] as const) {
      const html = renderExamining(examiningItem({ processingStatus: status, resultCode: null, manualReviewRequired: false }));
      assert.match(html, new RegExp(label), status);
      assert.doesNotMatch(html, /수동 확인 필요/, status);
    }
  });
});

describe("관리자 장애 상세: 영향 의뢰 카드", () => {
  const adminItem = (overrides: Partial<AdminItemProps> = {}): AdminItemProps => ({ ...examiningItem(), lastError: null, ...overrides });

  it("true면 '처리 완료'와 '수동 확인 필요' 배지, 안내를 보여준다", () => {
    const html = renderAdmin(adminItem());

    assert.match(html, /처리 완료/);
    assert.match(html, /수동 확인 필요/);
    assert.ok(html.includes(NOTICE));
    assert.ok(html.includes(NOTICE_MEANING));
  });

  it("false면 배지와 안내가 없고 기존 결과 코드·의뢰 상세 링크·마지막 오류는 그대로다", () => {
    const html = renderAdmin(adminItem({ manualReviewRequired: false, processingStatus: "FAILED", resultCode: null, lastError: "[RETRYABLE] 가상 오류" }));

    assert.match(html, /실패/);
    assert.doesNotMatch(html, /수동 확인 필요/);
    assert.ok(!html.includes(NOTICE));
    assert.match(html, /의뢰 상세/);
    assert.match(html, /마지막 오류 \(관리자 전용\)/);
  });
});
