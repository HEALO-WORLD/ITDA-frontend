import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * 의뢰기관 재조정 (API 모드): 대상 조회 → 검사 유형 고정 검색 → 후보 확인 → 재예약 요청 → 진행 상태 확인.
 * Gateway 요청(apiRequestData)·users/me·Next 헤더/캐시는 가짜. 실제 POST 없음.
 * 실제 코드: rescheduleTarget·rescheduleActions(기존)·rescheduleProgressActions·검색 Route/URL.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const EXAM_ORG = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const REFERRAL = "88888888-8888-4888-8888-888888888888";
const OLD_RESERVATION = "aaaaaaaa-8888-4888-8888-888888888888";
const NEW_RESERVATION = "abababab-8888-4888-8888-888888888888";
const SLOT = "44444444-4444-4444-8444-444444444444";
const EQUIPMENT = "55555555-5555-4555-8555-555555555555";
const OLD_EQUIPMENT = "56666666-5555-4555-8555-555555555555";
const EXAM_TYPE = "66666666-6666-4666-8666-666666666666";
const OTHER_EXAM_TYPE = "67777777-6666-4666-8666-666666666666";

type Access = { ok: true; headers: HeadersInit; user: { userId: string; institutionId: string } } | { ok: false; reason: string; message: string };
const okAccess: Access = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: USER, institutionId: ORG } };

const referralDto = (overrides: Record<string, unknown> = {}) => ({
  id: REFERRAL,
  referringInstitutionId: ORG,
  referrerId: USER,
  examTypeId: EXAM_TYPE,
  currentReservationId: OLD_RESERVATION,
  referralStatus: "NEEDS_RESCHEDULE",
  patientName: "홍길동",
  ...overrides,
});
const reservationDto = (overrides: Record<string, unknown> = {}) => ({
  id: OLD_RESERVATION,
  referralId: REFERRAL,
  attemptNo: 1,
  slotId: "45444444-4444-4444-8444-444444444444",
  examInstitutionId: EXAM_ORG,
  equipmentId: OLD_EQUIPMENT,
  examDate: "2099-01-05T10:00:00",
  startTime: "2099-01-05T10:00:00",
  endTime: "2099-01-05T10:30:00",
  reservationStatus: "BLOCKED",
  failureReason: "EQUIPMENT_FAILURE",
  confirmedAt: null,
  endedAt: null,
  ...overrides,
});
const slotDto = (overrides: Record<string, unknown> = {}) => ({
  id: SLOT,
  equipmentId: EQUIPMENT,
  examTypeId: EXAM_TYPE,
  status: "AVAILABLE",
  startsAt: "2099-01-10T01:00:00Z",
  endsAt: "2099-01-10T01:30:00Z",
  ...overrides,
});
const equipmentDto = (id: string, overrides: Record<string, unknown> = {}) => ({ id, institutionId: EXAM_ORG, name: id === EQUIPMENT ? "CT-2" : "CT-1", modality: "CT", status: "OPERATIONAL", ...overrides });

type Call = { path: string; method: string; body?: unknown; query?: unknown };
/** 화면이 렌더링된 로그인 세션 구분 값 (공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts) */
const LOGIN = "loginSessionTagA";

const state = {
  access: okAccess as Access,
  referral: referralDto() as unknown,
  reservations: {} as Record<string, unknown>,
  slot: slotDto() as unknown,
  equipments: {} as Record<string, unknown>,
  examTypes: { contents: [{ id: EXAM_TYPE, name: "흉부 CT", modality: "CT" }], totalElements: 1, totalPages: 1, size: 100, number: 0 } as unknown,
  post: null as null | ((body: Record<string, unknown>) => unknown) | Error,
  calls: [] as Call[],
  order: [] as string[],
  refreshCount: 0,
  sameOrigin: true,
  /** 지금 쿠키의 로그인 세션 구분 값 (다른 탭에서 계정이 바뀌면 달라진다) */
  loginSession: LOGIN as string | null,
};

function reset() {
  state.access = okAccess;
  state.loginSession = LOGIN;
  state.referral = referralDto();
  state.reservations = { [OLD_RESERVATION]: reservationDto() };
  state.slot = slotDto();
  state.equipments = { [EQUIPMENT]: equipmentDto(EQUIPMENT), [OLD_EQUIPMENT]: equipmentDto(OLD_EQUIPMENT) };
  state.examTypes = { contents: [{ id: EXAM_TYPE, name: "흉부 CT", modality: "CT" }], totalElements: 1, totalPages: 1, size: 100, number: 0 };
  state.post = (body) => ({
    id: NEW_RESERVATION,
    referralId: REFERRAL,
    attemptNo: 2,
    ...(body as object),
    reservationStatus: "REQUESTED",
    failureReason: null,
    confirmedAt: null,
    endedAt: null,
  });
  state.calls = [];
  state.order = [];
  state.refreshCount = 0;
  state.sameOrigin = true;
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "referrals,slots,equipment,partnerships";
}

const httpError = (status: number, code: string | null = null) => new ApiError("HTTP", `HTTP ${status}`, { status, code });
const take = (value: unknown) => {
  if (value instanceof Error) throw value;
  return value;
};
const posts = () => state.calls.filter((call) => call.method === "POST");
const quiet = async <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

let target: typeof import("@/features/referrals/rescheduleTarget");
let actions: typeof import("@/features/referrals/rescheduleActions");
let progressActions: typeof import("@/features/referrals/rescheduleProgressActions");
let searchClient: typeof import("@/features/slots/apiSearchClient");
let searchRoute: typeof import("@/features/slots/searchRoute");

before(async () => {
  reset();
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        state.order.push(`users/me:${role}`);
        return state.access;
      },
      // 실제 함수와 같은 순서: 형식 확인 → 역할 확인 → 쿠키의 로그인 세션 비교
      requireRoleMutationAccess: async (role: string, expected: unknown) => {
        const changed = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
        if (expected !== null && typeof expected !== "string") return changed;
        state.order.push(`mutation users/me:${role}`);
        if (!state.access.ok) return state.access;
        return expected === state.loginSession ? state.access : changed;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown; query?: unknown } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ path, method, body: options.body, query: options.query });
        state.order.push(`${method} ${path}`);
        if (method === "POST" && path === `/api/v1/referrals/${REFERRAL}/reschedule`) {
          if (state.post instanceof Error) throw state.post;
          return state.post!(options.body as Record<string, unknown>);
        }
        if (path === `/api/v1/referrals/${REFERRAL}`) return take(state.referral);
        const reservation = /^\/api\/v1\/referrals\/reservations\/(.+)$/.exec(path);
        if (reservation) return take(state.reservations[reservation[1]] ?? httpError(404));
        if (path === `/api/v1/slots/${SLOT}`) return take(state.slot);
        const equipment = /^\/api\/v1\/equipments\/(.+)$/.exec(path);
        if (equipment) return take(state.equipments[equipment[1]] ?? httpError(404));
        if (path === "/api/v1/exam-types") return take(state.examTypes);
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => state.sameOrigin } });

  target = await import("@/features/referrals/rescheduleTarget");
  actions = await import("@/features/referrals/rescheduleActions");
  progressActions = await import("@/features/referrals/rescheduleProgressActions");
  searchClient = await import("@/features/slots/apiSearchClient");
  searchRoute = await import("@/features/slots/searchRoute");
});

beforeEach(reset);

// ── STEP 1 ──

describe("재조정 목록 → 슬롯 검색 이동", () => {
  it("의뢰 ID(예약 ID 아님)로 /referring/slots?rescheduleReferralId= 를 만든다", async () => {
    const { getRescheduleSearchHref } = await import("@/features/referrals/reschedule");
    assert.equal(getRescheduleSearchHref(REFERRAL), `/referring/slots?rescheduleReferralId=${REFERRAL}`);
  });
});

// ── STEP 2 ──

describe("loadApiRescheduleTarget", () => {
  it("NEEDS_RESCHEDULE 의뢰: 검사 유형(의뢰 원본)·기존 예약·장비 이름", async () => {
    const result = await target.loadApiRescheduleTarget(REFERRAL);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.target, {
      referralId: REFERRAL,
      examTypeId: EXAM_TYPE,
      examTypeName: "흉부 CT",
      modality: "CT",
      currentReservation: {
        status: "BLOCKED",
        startTime: "2099-01-05T10:00:00",
        endTime: "2099-01-05T10:30:00",
        examInstitutionId: EXAM_ORG,
        equipmentName: "CT-1",
      },
    });
    assert.equal(state.order[0], "users/me:REFERRING");
    assert.equal(posts().length, 0);
    assert.equal(JSON.stringify(result).includes("홍길동"), false, "환자명은 담지 않는다");
  });

  it("상태가 NEEDS_RESCHEDULE가 아니면 NOT_RESCHEDULABLE", async () => {
    for (const status of ["PENDING", "CONFIRMED", "FAILED", "CANCELED"]) {
      state.referral = referralDto({ referralStatus: status });
      const result = await target.loadApiRescheduleTarget(REFERRAL);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "NOT_RESCHEDULABLE");
    }
  });

  it("401·403·404·네트워크·응답 오류를 구분한다 (Mock으로 대체하지 않음)", async () => {
    for (const [error, reason] of [
      [httpError(401), "UNAUTHORIZED"],
      [httpError(403, "ACCESS_DENIED"), "FORBIDDEN"],
      [httpError(404, "REFERRAL_NOT_FOUND"), "NOT_FOUND"],
      [new ApiError("TIMEOUT", "x"), "NETWORK"],
      [httpError(500), "ERROR"],
    ] as const) {
      reset();
      state.referral = error;
      const result = await quiet(() => target.loadApiRescheduleTarget(REFERRAL));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, reason);
    }
  });

  it("역할 확인 실패·잘못된 ID는 조회하지 않는다", async () => {
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "x" };
    const forbidden = await target.loadApiRescheduleTarget(REFERRAL);
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.reason, "FORBIDDEN");
    reset();
    const invalid = await target.loadApiRescheduleTarget("not-a-uuid");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, "INVALID");
    assert.equal(state.calls.length, 0);
  });

  it("기존 예약·장비·검사 유형 조회가 실패해도 대상은 돌려준다 (값만 비움)", async () => {
    state.reservations = {};
    state.examTypes = httpError(500);
    const result = await quiet(() => target.loadApiRescheduleTarget(REFERRAL));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.target.currentReservation, null);
      assert.equal(result.target.examTypeName, null);
      assert.equal(result.target.modality, null);
      assert.equal(result.target.examTypeId, EXAM_TYPE);
    }
  });
});

// ── STEP 3 ──

describe("검사 유형 고정 검색", () => {
  it("검색 URL에 examTypeId를 붙인다 (없으면 기존과 같다)", () => {
    const base = { startDate: "2099-01-01", endDateExclusive: "2099-01-31" };
    assert.equal(searchClient.buildSlotSearchUrl(base), "/referring/slots/search?startDate=2099-01-01&endDateExclusive=2099-01-31");
    assert.match(searchClient.buildSlotSearchUrl({ ...base, modality: "CT", examTypeId: EXAM_TYPE }), new RegExp(`modality=CT&examTypeId=${EXAM_TYPE}$`));
  });

  it("Route Handler가 examTypeId를 loader로 넘긴다", async () => {
    let received: Record<string, unknown> | null = null;
    const response = await searchRoute.handleSlotSearchGet(
      new Request(`http://localhost/referring/slots/search?startDate=2099-01-01&endDateExclusive=2099-01-31&examTypeId=${EXAM_TYPE}`),
      async (input) => {
        received = input as never;
        return { ok: true, slots: [], window: { startDate: "2099-01-01", endDateExclusive: "2099-01-31" }, requestCount: 1 } as never;
      },
    );
    assert.equal(response.status, 200);
    assert.equal(received!.examTypeId, EXAM_TYPE);
  });
});

// ── STEP 4·5 (기존 Server Function 재사용) ──

describe("후보 확인·재예약 요청 (requestRescheduleAction)", () => {
  it("정상: 후보 확인 통과 → POST 1회, 서버 재조회 값으로 본문 (서울 LocalDateTime), 접수(REQUESTED)는 확정이 아님", async () => {
    const check = await actions.checkRescheduleCandidateAction(REFERRAL, SLOT);
    assert.equal(check.ok, true);
    assert.equal(posts().length, 0, "후보 확인은 조회만");
    reset();
    const result = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.equal(result.ok, true);
    assert.deepEqual(posts()[0].body, {
      slotId: SLOT,
      examInstitutionId: EXAM_ORG,
      equipmentId: EQUIPMENT,
      examDate: "2099-01-10T10:00:00",
      startTime: "2099-01-10T10:00:00",
      endTime: "2099-01-10T10:30:00",
    });
    if (result.ok) {
      assert.equal(result.reservation.status, "REQUESTED");
      assert.match(result.message, /아직 확정되지 않았습니다/);
    }
    assert.equal(state.refreshCount, 1);
  });

  const rejected: [string, () => void, string][] = [
    ["예약 불가 슬롯(HELD)", () => (state.slot = slotDto({ status: "HELD" })), "SLOT_NOT_AVAILABLE"],
    ["사용 불가 슬롯(UNAVAILABLE)", () => (state.slot = slotDto({ status: "UNAVAILABLE" })), "SLOT_NOT_AVAILABLE"],
    ["장비 장애", () => (state.equipments[EQUIPMENT] = equipmentDto(EQUIPMENT, { status: "FAILED" })), "EQUIPMENT_NOT_OPERATIONAL"],
    ["장비 점검", () => (state.equipments[EQUIPMENT] = equipmentDto(EQUIPMENT, { status: "MAINTENANCE" })), "EQUIPMENT_NOT_OPERATIONAL"],
    ["다른 검사 유형", () => (state.slot = slotDto({ examTypeId: OTHER_EXAM_TYPE })), "EXAM_TYPE_MISMATCH"],
    ["이미 재예약됨(상태 변경)", () => (state.referral = referralDto({ referralStatus: "PENDING" })), "REFERRAL_NOT_RESCHEDULABLE"],
  ];
  for (const [label, arrange, failure] of rejected) {
    it(`${label} → 후보 확인 실패, POST 없음`, async () => {
      arrange();
      const check = await actions.checkRescheduleCandidateAction(REFERRAL, SLOT);
      assert.equal(check.ok, false);
      if (!check.ok) assert.ok(check.failures?.includes(failure as never), `${check.failures}`);
      const result = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "CANDIDATE_REJECTED");
      assert.equal(posts().length, 0);
    });
  }

  it("같은 의뢰 동시 요청: 두 번째는 조회·POST 없이 DUPLICATE_REQUEST", async () => {
    let release: () => void = () => {};
    const respond = state.post as (body: Record<string, unknown>) => unknown;
    state.post = (body) => new Promise((resolve) => (release = () => resolve(respond(body))));
    const first = actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await actions.requestRescheduleAction(REFERRAL.toUpperCase(), SLOT, LOGIN);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "DUPLICATE_REQUEST");
    release();
    assert.equal((await first).ok, true);
    assert.equal(posts().length, 1);
  });

  const postFailures: [string, unknown, string][] = [
    ["409 예약 충돌·상태 변경", httpError(409, "INVALID_REFERRAL_STATUS"), "CONFLICT"],
    ["404 작성자 아님", httpError(404, "REFERRAL_NOT_FOUND"), "NOT_FOUND"],
    ["403", httpError(403, "PARTNERSHIP_NOT_ACTIVE"), "FORBIDDEN"],
    ["네트워크", new ApiError("NETWORK", "x"), "NETWORK"],
    ["시간 초과", new ApiError("TIMEOUT", "x"), "NETWORK"],
  ];
  for (const [label, error, cause] of postFailures) {
    it(`POST ${label} → ${cause} (자동 재시도 없음)`, async () => {
      state.post = error as Error;
      const result = await quiet(() => actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "REQUEST_FAILED");
        assert.equal(result.request?.cause, cause);
      }
      assert.equal(posts().length, 1);
    });
  }

  it("POST 401 → UNAUTHORIZED", async () => {
    state.post = httpError(401);
    const result = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "UNAUTHORIZED");
  });

  it("검사기관·관리자 계정은 조회·POST 없이 차단 (REQUESTER만)", async () => {
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "x" };
    const result = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "FORBIDDEN_ROLE");
    assert.equal(state.calls.length, 0);
  });
});

// ── STEP 6 ──

describe("loadRescheduleProgressAction (접수 뒤 확정 재조회)", () => {
  it("접수 직후(PENDING·REQUESTED)는 처리 중, CONFIRMED·CONFIRMED만 확정", async () => {
    state.referral = referralDto({ referralStatus: "PENDING", currentReservationId: NEW_RESERVATION });
    state.reservations = { [NEW_RESERVATION]: reservationDto({ id: NEW_RESERVATION, attemptNo: 2, reservationStatus: "REQUESTED", failureReason: null }) };
    const processing = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(processing.ok, true);
    if (processing.ok) assert.equal(processing.stage, "PROCESSING");

    state.referral = referralDto({ referralStatus: "CONFIRMED", currentReservationId: NEW_RESERVATION });
    state.reservations = { [NEW_RESERVATION]: reservationDto({ id: NEW_RESERVATION, reservationStatus: "CONFIRMED", failureReason: null, confirmedAt: "2099-01-01T09:00:00" }) };
    const confirmed = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) assert.equal(confirmed.stage, "CONFIRMED");
    assert.equal(posts().length, 0);
    assert.equal(state.refreshCount, 0);
  });

  it("비동기 실패(SLOT_CONFLICT)·재조정 필요로 되돌아감을 구분한다", async () => {
    state.referral = referralDto({ referralStatus: "PENDING", currentReservationId: NEW_RESERVATION });
    state.reservations = { [NEW_RESERVATION]: reservationDto({ id: NEW_RESERVATION, reservationStatus: "FAILED", failureReason: "SLOT_CONFLICT" }) };
    const failed = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(failed.ok, true);
    if (failed.ok) {
      assert.equal(failed.stage, "FAILED");
      assert.match(failed.message, /먼저 이 슬롯/);
    }
    reset();
    state.reservations = { [OLD_RESERVATION]: reservationDto({ reservationStatus: "BLOCKED", failureReason: null }) };
    // 요청이 접수되지 않았으면 의뢰는 그대로 NEEDS_RESCHEDULE (기존 BLOCKED 예약을 재예약 실패로 보이지 않는다)
    const needs = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(needs.ok, true);
    if (needs.ok) assert.equal(needs.stage, "NEEDS_RESCHEDULE");
  });

  it("다른 출처·권한·404·만료를 구분하고, 다른 의뢰의 예약은 쓰지 않는다", async () => {
    state.sameOrigin = false;
    assert.equal((await progressActions.loadRescheduleProgressAction(REFERRAL)).ok, false);
    assert.equal(state.calls.length, 0);
    reset();
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "x" };
    const forbidden = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(forbidden.ok, false);
    assert.equal(state.calls.length, 0);
    for (const [error, reason] of [[httpError(404), "NOT_FOUND"], [httpError(401), "UNAUTHORIZED"], [httpError(403), "FORBIDDEN"]] as const) {
      reset();
      state.referral = error;
      const result = await quiet(() => progressActions.loadRescheduleProgressAction(REFERRAL));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, reason);
    }
    reset();
    state.reservations = { [OLD_RESERVATION]: reservationDto({ referralId: "99999999-9999-4999-8999-999999999999" }) };
    const mismatched = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(mismatched.ok, true);
    if (mismatched.ok) assert.equal(mismatched.reservation, null);
  });
});

describe("requestRescheduleAction: 로그인 세션 정합성 (STEP 3-2-2B-1)", () => {
  it("화면을 그린 뒤 다른 탭에서 계정이 바뀌면 SESSION_CHANGED: 조회·재예약 POST 0회, 목록 다시 그리지 않음", async () => {
    state.loginSession = "loginSessionTagB";
    const result = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.deepEqual(result, { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." });
    assert.equal(posts().length, 0);
    assert.equal(state.calls.length, 0, "의뢰·슬롯·장비 조회도 하지 않음");
    assert.equal(state.refreshCount, 0);
  });

  it("렌더링 세션 인자를 빠뜨리면(undefined) 거부한다", async () => {
    const result = await actions.requestRescheduleAction(REFERRAL, SLOT);
    assert.equal(!result.ok && result.reason, "SESSION_CHANGED");
    assert.equal(posts().length, 0);
  });

  it("세션이 같으면 기존 흐름 그대로 POST 1회, 확인 단계(checkRescheduleCandidateAction)는 기존 역할 확인만", async () => {
    const check = await actions.checkRescheduleCandidateAction(REFERRAL, SLOT);
    assert.equal(check.ok, true);
    assert.equal(state.order[0], "users/me:REFERRING", "확인 단계는 세션 비교 없이 기존 역할 확인");
    reset();
    const result = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.equal(result.ok, true);
    assert.equal(state.order[0], "mutation users/me:REFERRING");
    assert.equal(posts().length, 1);
  });

  it("기존 인증·권한 실패는 그대로 구분 (SESSION_CHANGED로 덮지 않음)", async () => {
    state.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
    const unauthorized = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.equal(!unauthorized.ok && unauthorized.reason, "UNAUTHORIZED");
    reset();
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
    const forbidden = await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    assert.equal(!forbidden.ok && forbidden.reason, "FORBIDDEN_ROLE");
    assert.equal(posts().length, 0);
  });

  it("SESSION_CHANGED 뒤 처리 중 표시가 남지 않는다 (같은 세션에서는 다시 요청 가능)", async () => {
    state.loginSession = "loginSessionTagB";
    await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN);
    state.loginSession = LOGIN;
    assert.equal((await actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN)).ok, true);
    assert.equal(posts().length, 1);
  });
});

// ── P1-A: 재예약 POST 결과 불명 (5xx·응답 없음·응답 형식 오류) ──

describe("requestRescheduleAction: 결과 불명 처리 (P1-A)", () => {
  const unknownFailures: [string, unknown][] = [
    ["500", httpError(500, "INTERNAL_SERVER_ERROR")],
    ["502", httpError(502)],
    ["503", httpError(503)],
    ["504", httpError(504)],
    ["NETWORK", new ApiError("NETWORK", "x")],
    ["TIMEOUT", new ApiError("TIMEOUT", "x")],
    ["PARSE(응답 형식 오류)", new ApiError("PARSE", "x")],
  ];
  for (const [label, error] of unknownFailures) {
    it(`POST ${label} → 결과 불명(uncertain): POST 1회(자동 재전송 없음), 목록 다시 그리기, 결과 불명 안내`, async () => {
      state.post = error as Error;
      const result = await quiet(() => actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "REQUEST_FAILED");
        assert.equal(result.request?.uncertain, true, label);
        assert.match(result.message, /확인하지 못했습니다/);
      }
      assert.equal(posts().length, 1);
      assert.equal(state.refreshCount, 1);
    });
  }

  it("확실한 실패(400·403·404·409)는 결과 불명이 아니다 (409·404만 목록 다시 그리기, 기존 처리 그대로)", async () => {
    for (const [status, refreshes] of [[400, 0], [403, 0], [404, 1], [409, 1]] as const) {
      reset();
      state.post = httpError(status);
      const result = await quiet(() => actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.request?.uncertain, false, String(status));
      assert.equal(state.refreshCount, refreshes, String(status));
      assert.equal(posts().length, 1);
    }
  });

  it("실제로는 접수됐지만 응답이 유실(500): 다시 보내지 않고 재조회하면 처리 중(요청한 슬롯) → 화면은 접수로 확인", async () => {
    state.post = () => {
      // 서버는 커밋했다: 의뢰 PENDING, 현재 예약 = 새 예약(요청한 슬롯, REQUESTED). 응답 단계에서 500
      state.referral = referralDto({ referralStatus: "PENDING", currentReservationId: NEW_RESERVATION });
      state.reservations[NEW_RESERVATION] = reservationDto({ id: NEW_RESERVATION, slotId: SLOT, reservationStatus: "REQUESTED", failureReason: null });
      throw httpError(500);
    };
    const result = await quiet(() => actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN));
    assert.equal(!result.ok && result.request?.uncertain, true);
    const progress = await progressActions.loadRescheduleProgressAction(REFERRAL);
    assert.equal(progress.ok, true);
    if (progress.ok) {
      assert.equal(progress.stage, "PROCESSING", "REQUESTED는 확정이 아니다");
      assert.equal(progress.reservation?.slotId, SLOT);
    }
    assert.equal(posts().length, 1, "재조회는 GET만");
  });

  it("결과 불명 뒤 재조회도 실패하면(503) 상태 확인 실패로 돌려준다 (화면은 결과 불명 유지)", async () => {
    state.post = new ApiError("TIMEOUT", "x");
    await quiet(() => actions.requestRescheduleAction(REFERRAL, SLOT, LOGIN));
    state.referral = httpError(503);
    const progress = await quiet(() => progressActions.loadRescheduleProgressAction(REFERRAL));
    assert.deepEqual(progress, { ok: false, reason: "ERROR", message: "상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." });
    assert.equal(posts().length, 1);
  });
});
