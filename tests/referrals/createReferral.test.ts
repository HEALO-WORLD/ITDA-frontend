import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * 의뢰 생성 + 첫 예약 접수 (API 모드) 단위 테스트. 실제 네트워크·DB 요청 없음.
 * - Gateway 요청(apiRequestData)·users/me(requireRoleAccess)·슬롯/장비/협약 remote는 가짜로 바꾼다
 * - referrals/remote.ts(DTO 검증·응답 확인·오류 분류)와 createServer.ts(서버 재확인 순서)는 실제 코드를 쓴다
 */

const REQ_ORG = "11111111-1111-4111-8111-111111111111";
const EXAM_ORG = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "33333333-3333-4333-8333-333333333333";
const SLOT = "44444444-4444-4444-8444-444444444444";
const EQUIPMENT = "55555555-5555-4555-8555-555555555555";
const EXAM_TYPE = "66666666-6666-4666-8666-666666666666";
const OTHER_EXAM_TYPE = "67777777-6666-4666-8666-666666666666";
const KEY = "77777777-7777-4777-8777-777777777777";
const REFERRAL = "88888888-8888-4888-8888-888888888888";
const RESERVATION = "aaaaaaaa-8888-4888-8888-888888888888";

type Access = { ok: true; headers: HeadersInit; user: { id: string; institutionId: string } } | { ok: false; reason: string; message: string };

const okAccess: Access = { ok: true, headers: { Authorization: "Bearer test" }, user: { id: USER, institutionId: REQ_ORG } };

const baseSlot = () => ({
  id: SLOT,
  equipmentId: EQUIPMENT,
  examTypeId: EXAM_TYPE,
  status: "AVAILABLE",
  // 서울 2099-01-10 10:00 ~ 10:30 (UTC로 받은 값)
  startsAt: "2099-01-10T01:00:00Z",
  endsAt: "2099-01-10T01:30:00Z",
});

const referralDto = (overrides: Record<string, unknown> = {}) => ({
  id: REFERRAL,
  referringInstitutionId: REQ_ORG,
  referrerId: USER,
  examTypeId: EXAM_TYPE,
  currentReservationId: RESERVATION,
  referralStatus: "PENDING",
  patientName: "홍길동",
  ...overrides,
});

const reservationDto = (overrides: Record<string, unknown> = {}) => ({
  id: RESERVATION,
  referralId: REFERRAL,
  attemptNo: 1,
  slotId: SLOT,
  examInstitutionId: EXAM_ORG,
  equipmentId: EQUIPMENT,
  examDate: "2099-01-10T10:00:00",
  startTime: "2099-01-10T10:00:00",
  endTime: "2099-01-10T10:30:00",
  confirmedAt: null,
  endedAt: null,
  reservationStatus: "REQUESTED",
  failureReason: null,
  ...overrides,
});

type Call = { path: string; method: string; body?: unknown; headers?: HeadersInit };

/** 화면이 렌더링된 로그인 세션 구분 값 (공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts) */
const LOGIN = "loginSessionTagA";

const state = {
  access: okAccess as Access,
  /** 지금 쿠키의 로그인 세션 구분 값 (다른 탭에서 계정이 바뀌면 달라진다) */
  loginSession: LOGIN as string | null,
  slot: baseSlot() as Record<string, unknown> | Error,
  equipment: { id: EQUIPMENT, institutionId: EXAM_ORG, status: "OPERATIONAL" } as Record<string, unknown> | Error,
  partnerships: [{ partnerInstitutionId: EXAM_ORG, partnerInstitutionType: "EXAM", status: "ACTIVE" }] as unknown[] | Error,
  /** POST /api/v1/referrals 결과 (함수면 본문을 받아 응답을 만든다) */
  post: ((body: Record<string, unknown>) => referralDto({ patientName: body.patientName })) as ((body: Record<string, unknown>) => unknown) | Error,
  referral: referralDto() as unknown,
  reservation: reservationDto() as unknown,
  calls: [] as Call[],
  order: [] as string[],
};

function reset() {
  state.access = okAccess;
  state.loginSession = LOGIN;
  state.slot = baseSlot();
  state.equipment = { id: EQUIPMENT, institutionId: EXAM_ORG, status: "OPERATIONAL" };
  state.partnerships = [{ partnerInstitutionId: EXAM_ORG, partnerInstitutionType: "EXAM", status: "ACTIVE" }];
  state.post = (body) => referralDto({ patientName: body.patientName });
  state.referral = referralDto();
  state.reservation = reservationDto();
  state.calls = [];
  state.order = [];
}

const httpError = (status: number, code: string | null = null) => new ApiError("HTTP", `HTTP ${status}`, { status, code });
const posts = () => state.calls.filter((call) => call.method === "POST");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

let remote: typeof import("@/features/referrals/remote");
let server: typeof import("@/features/referrals/createServer");
let tracker: typeof import("@/features/referrals/idempotency");

before(async () => {

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
        state.order.push(`users/me:${role}`);
        if (!state.access.ok) return state.access;
        return expected === state.loginSession ? state.access : changed;
      },
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown; headers?: HeadersInit } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ path, method, body: options.body, headers: options.headers });
        state.order.push(`${method} ${path}`);
        if (method === "POST" && path === "/api/v1/referrals") {
          if (state.post instanceof Error) throw state.post;
          return state.post(options.body as Record<string, unknown>);
        }
        if (path === `/api/v1/referrals/${REFERRAL}`) return state.referral;
        if (path === `/api/v1/referrals/reservations/${RESERVATION}`) return state.reservation;
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  mock.module("@/features/slots/remote", {
    namedExports: {
      isSlotApiId: uuid,
      fetchSlotDetail: async (id: string) => {
        state.order.push(`slot:${id}`);
        if (state.slot instanceof Error) throw state.slot;
        return state.slot;
      },
    },
  });
  mock.module("@/features/equipment/remote", {
    namedExports: {
      fetchEquipment: async (id: string) => {
        state.order.push(`equipment:${id}`);
        if (state.equipment instanceof Error) throw state.equipment;
        return state.equipment;
      },
    },
  });
  mock.module("@/features/partnerships/remote", {
    namedExports: {
      fetchMyPartnershipList: async (query: unknown) => {
        state.order.push(`partnerships:${JSON.stringify(query)}`);
        if (state.partnerships instanceof Error) throw state.partnerships;
        return state.partnerships;
      },
    },
  });

  remote = await import("@/features/referrals/remote");
  server = await import("@/features/referrals/createServer");
  tracker = await import("@/features/referrals/idempotency");
});

beforeEach(reset);

const validInput = (overrides: Record<string, unknown> = {}) => ({
  slotId: SLOT,
  examTypeId: EXAM_TYPE,
  patientName: "홍길동",
  idempotencyKey: KEY,
  ...overrides,
});

// ── 1. DTO 검증 ──

describe("CreateReferralRequest DTO 검증", () => {
  const reservation = {
    slotId: SLOT,
    examInstitutionId: EXAM_ORG,
    equipmentId: EQUIPMENT,
    examDate: "2099-01-10T10:00:00",
    startTime: "2099-01-10T10:00:00",
    endTime: "2099-01-10T10:30:00",
  };
  const dto = (overrides: Record<string, unknown> = {}) => ({
    referringInstitutionId: REQ_ORG,
    examTypeId: EXAM_TYPE,
    patientName: "  홍길동 ",
    idempotencyKey: KEY,
    reservation,
    ...overrides,
  });

  it("백엔드 필드만 담고 환자명 앞뒤 공백을 지운다 (의뢰 목적 필드 없음)", () => {
    const result = remote.validateCreateReferralRequest({ ...dto(), purpose: "x", reservation: { ...reservation, extra: 1 } } as never);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(Object.keys(result.body).sort(), ["examTypeId", "idempotencyKey", "patientName", "referringInstitutionId", "reservation"]);
    assert.deepEqual(Object.keys(result.body.reservation).sort(), ["endTime", "equipmentId", "examDate", "examInstitutionId", "slotId", "startTime"]);
    assert.equal(result.body.patientName, "홍길동");
  });

  it("환자명: 빈 값·21자·제어 문자는 거절, 20자는 허용", () => {
    assert.match(remote.validatePatientName("   ") ?? "", /입력/);
    assert.match(remote.validatePatientName(undefined) ?? "", /입력/);
    assert.match(remote.validatePatientName("가".repeat(21)) ?? "", /20자/);
    assert.equal(remote.validatePatientName("가".repeat(20)), null);
    assert.match(remote.validatePatientName("홍\u0000길동") ?? "", /사용할 수 없는/);
  });

  it("UUID·LocalDateTime 형식과 시작 < 종료를 확인한다", () => {
    assert.deepEqual(pick(remote.validateCreateReferralRequest(dto({ referringInstitutionId: "x" }))), "referringInstitutionId");
    assert.deepEqual(pick(remote.validateCreateReferralRequest(dto({ examTypeId: 1 }))), "examTypeId");
    assert.deepEqual(pick(remote.validateCreateReferralRequest(dto({ idempotencyKey: "abc" }))), "idempotencyKey");
    assert.deepEqual(pick(remote.validateCreateReferralRequest(dto({ reservation: { ...reservation, startTime: "2099-01-10T10:00:00+09:00" } }))), "reservation.startTime");
    assert.deepEqual(pick(remote.validateCreateReferralRequest(dto({ reservation: { ...reservation, endTime: "2099-01-10T09:00:00" } }))), "reservation.endTime");
  });

  it("검증에 걸리면 POST하지 않는다 (CONFIG → NOT_SENT)", async () => {
    await assert.rejects(remote.createReferral(dto({ patientName: "" })), (error: unknown) => {
      assert.equal(remote.getCreateReferralFailure(error).reason, "NOT_SENT");
      return true;
    });
    assert.equal(posts().length, 0);
  });

  it("응답의 기관·검사 유형·환자명이 요청과 다르면 PARSE (결과 불명)", async () => {
    for (const override of [{ referringInstitutionId: OTHER_ORG }, { examTypeId: OTHER_EXAM_TYPE }, { patientName: "김철수" }, { id: "bad" }]) {
      state.post = () => referralDto(override);
      await assert.rejects(remote.createReferral(dto()), (error: unknown) => {
        const failure = remote.getCreateReferralFailure(error);
        assert.equal(failure.reason, "INVALID_RESPONSE");
        assert.equal(remote.CREATE_REFERRAL_UNCERTAIN.has(failure.reason), true);
        return true;
      });
    }
  });
});

function pick(result: { ok: boolean; field?: string }) {
  return result.ok ? null : result.field;
}

// ── 2. 멱등 키 ──

describe("멱등 키 (createIdempotencyTracker)", () => {
  const content = { slotId: SLOT, examTypeId: EXAM_TYPE, patientName: "홍길동" };
  const seq = () => {
    let n = 0;
    return () => `key-${++n}`;
  };

  it("같은 내용이면 같은 키 (대소문자·환자명 앞뒤 공백 차이는 같은 내용)", () => {
    const t = tracker.createIdempotencyTracker(seq());
    const first = t.keyFor(content);
    assert.equal(t.keyFor(content), first);
    assert.equal(t.keyFor({ ...content, slotId: SLOT.toUpperCase(), patientName: " 홍길동 " }), first);
  });

  it("내용이 바뀌면 새 키", () => {
    const t = tracker.createIdempotencyTracker(seq());
    const first = t.keyFor(content);
    assert.notEqual(t.keyFor({ ...content, patientName: "김철수" }), first);
  });

  it("결과 불명(lock) 뒤에는 바뀐 내용으로 새 키를 만들지 않고, 같은 내용은 같은 키", () => {
    const t = tracker.createIdempotencyTracker(seq());
    const first = t.keyFor(content);
    t.lock();
    assert.equal(t.isLocked, true);
    assert.equal(t.keyFor({ ...content, patientName: "김철수" }), null);
    assert.equal(t.keyFor(content), first);
  });
});

// ── 3. 오류 분류 ──

describe("getCreateReferralFailure", () => {
  const cases: [unknown, string, boolean][] = [
    [httpError(400, "VALIDATION_FAILED"), "INVALID_REQUEST", false],
    [httpError(401, "TOKEN_EXPIRED"), "UNAUTHORIZED", false],
    [httpError(403, "PARTNERSHIP_NOT_ACTIVE"), "PARTNERSHIP_NOT_ACTIVE", false],
    [httpError(403, "REFERRAL_FORBIDDEN"), "FORBIDDEN", false],
    [httpError(403, null), "FORBIDDEN", false],
    [httpError(409, "REFERRAL_IDEMPOTENCY_CONFLICT"), "IDEMPOTENCY_CONFLICT", false],
    [httpError(409, "SLOT_ALREADY_HELD"), "CONFLICT", false],
    [httpError(500), "SERVER_ERROR", true],
    [httpError(503, "INSTITUTION_SERVICE_UNAVAILABLE"), "SERVER_ERROR", true],
    [new ApiError("NETWORK", "fetch failed"), "NETWORK", true],
    [new ApiError("ABORTED", "aborted"), "NETWORK", true],
    [new ApiError("TIMEOUT", "timeout"), "TIMEOUT", true],
    [new ApiError("PARSE", "bad json"), "INVALID_RESPONSE", true],
    [new Error("unknown"), "SERVER_ERROR", true],
  ];
  for (const [error, reason, uncertain] of cases) {
    const label = error instanceof ApiError ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "일반 Error";
    it(`${label} → ${reason}${uncertain ? " (결과 불명)" : ""}`, () => {
      const failure = remote.getCreateReferralFailure(error);
      assert.equal(failure.reason, reason);
      assert.equal(remote.CREATE_REFERRAL_UNCERTAIN.has(failure.reason), uncertain);
      assert.ok(failure.message.length > 0);
    });
  }
});

// ── 4. 서버 재확인 → POST ──

describe("submitCreateReferral", () => {
  it("성공: users/me → 슬롯 → 장비 → 협약 → POST 1회, 서버 값으로 본문을 만든다", async () => {
    const result = await server.submitCreateReferral(validInput({ patientName: " 홍길동 " }), LOGIN);
    assert.equal(result.ok, true);
    assert.deepEqual(state.order, [
      "users/me:REFERRING",
      `slot:${SLOT}`,
      `equipment:${EQUIPMENT}`,
      'partnerships:{"status":"ACTIVE"}',
      "POST /api/v1/referrals",
    ]);
    const [call] = posts();
    assert.deepEqual(call.body, {
      referringInstitutionId: REQ_ORG,
      examTypeId: EXAM_TYPE,
      patientName: "홍길동",
      idempotencyKey: KEY,
      reservation: {
        slotId: SLOT,
        examInstitutionId: EXAM_ORG,
        equipmentId: EQUIPMENT,
        examDate: "2099-01-10T10:00:00",
        startTime: "2099-01-10T10:00:00",
        endTime: "2099-01-10T10:30:00",
      },
    });
    // 토큰은 Authorization만, X- 헤더는 만들지 않는다
    assert.deepEqual(call.headers, { Authorization: "Bearer test" });
    if (result.ok) {
      assert.equal(result.referral.id, REFERRAL);
      assert.match(result.message, /확정되지 않았습니다/);
      assert.equal(JSON.stringify(result).includes("Bearer"), false);
    }
  });

  it("서울 시각 변환: +09:00·Z·다른 오프셋 모두 같은 서울 LocalDateTime", async () => {
    for (const [startsAt, endsAt] of [
      ["2099-01-10T10:00:00+09:00", "2099-01-10T10:30:00+09:00"],
      ["2099-01-10T01:00:00Z", "2099-01-10T01:30:00Z"],
      ["2099-01-09T20:00:00-05:00", "2099-01-09T20:30:00-05:00"],
    ]) {
      reset();
      state.slot = { ...baseSlot(), startsAt, endsAt };
      const result = await server.submitCreateReferral(validInput(), LOGIN);
      assert.equal(result.ok, true, startsAt);
      const body = posts()[0].body as { reservation: { startTime: string; endTime: string; examDate: string } };
      assert.equal(body.reservation.startTime, "2099-01-10T10:00:00");
      assert.equal(body.reservation.examDate, "2099-01-10T10:00:00");
      assert.equal(body.reservation.endTime, "2099-01-10T10:30:00");
    }
  });

  it("인증·인가 실패면 Gateway 데이터 요청 전에 멈춘다", async () => {
    for (const [reason, expected] of [["SIGNED_OUT", "SIGNED_OUT"], ["UNAUTHORIZED", "UNAUTHORIZED"], ["FORBIDDEN", "FORBIDDEN"]] as const) {
      reset();
      state.access = { ok: false, reason, message: "x" };
      const result = await server.submitCreateReferral(validInput(), LOGIN);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, expected);
      assert.deepEqual(state.order, ["users/me:REFERRING"]);
    }
  });

  it("입력 오류는 조회·POST 없이 거절한다", async () => {
    for (const input of [validInput({ slotId: "x" }), validInput({ examTypeId: 1 }), validInput({ patientName: "" }), validInput({ idempotencyKey: "k" }), null]) {
      reset();
      const result = await server.submitCreateReferral(input, LOGIN);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "INVALID_INPUT");
      assert.deepEqual(state.order, ["users/me:REFERRING"]);
    }
  });

  const rejectCases: [string, () => void, string][] = [
    ["슬롯이 HELD", () => (state.slot = { ...baseSlot(), status: "HELD" }), "SLOT_NOT_AVAILABLE"],
    ["슬롯이 UNAVAILABLE", () => (state.slot = { ...baseSlot(), status: "UNAVAILABLE" }), "SLOT_NOT_AVAILABLE"],
    ["슬롯 검사 유형이 화면과 다름", () => (state.slot = { ...baseSlot(), examTypeId: OTHER_EXAM_TYPE }), "SLOT_CHANGED"],
    ["지난 슬롯", () => (state.slot = { ...baseSlot(), startsAt: "2000-01-01T01:00:00Z", endsAt: "2000-01-01T01:30:00Z" }), "SLOT_CHANGED"],
    ["시작·종료 서울 날짜가 다름", () => (state.slot = { ...baseSlot(), startsAt: "2099-01-10T14:30:00Z", endsAt: "2099-01-10T15:30:00Z" }), "SLOT_CHANGED"],
    ["슬롯 404", () => (state.slot = httpError(404, "SLOT_NOT_FOUND")), "SLOT_CHANGED"],
    ["슬롯 조회 403", () => (state.slot = httpError(403)), "FORBIDDEN"],
    ["슬롯 조회 연결 실패", () => (state.slot = new ApiError("NETWORK", "x")), "LOOKUP_FAILED"],
    ["장비가 다른 ID", () => (state.equipment = { id: OTHER_ORG, institutionId: EXAM_ORG, status: "OPERATIONAL" }), "SLOT_CHANGED"],
    ["장비 점검 중", () => (state.equipment = { id: EQUIPMENT, institutionId: EXAM_ORG, status: "MAINTENANCE" }), "SLOT_CHANGED"],
    ["협약 없음 (다른 기관만 ACTIVE)", () => (state.partnerships = [{ partnerInstitutionId: OTHER_ORG, partnerInstitutionType: "EXAM", status: "ACTIVE" }]), "PARTNERSHIP_NOT_ACTIVE"],
    ["협약 상대가 의뢰기관 유형", () => (state.partnerships = [{ partnerInstitutionId: EXAM_ORG, partnerInstitutionType: "REQUEST", status: "ACTIVE" }]), "PARTNERSHIP_NOT_ACTIVE"],
    ["협약 조회 401", () => (state.partnerships = httpError(401)), "UNAUTHORIZED"],
  ];
  for (const [label, arrange, reason] of rejectCases) {
    it(`${label} → ${reason}, POST 없음`, async () => {
      arrange();
      const result = await server.submitCreateReferral(validInput(), LOGIN);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, reason);
        assert.equal(result.uncertain, undefined);
      }
      assert.equal(posts().length, 0);
    });
  }

  const postFailures: [string, unknown, string, boolean][] = [
    ["400", httpError(400, "VALIDATION_FAILED"), "INVALID_REQUEST", false],
    ["401", httpError(401), "UNAUTHORIZED", false],
    ["403 협약", httpError(403, "PARTNERSHIP_NOT_ACTIVE"), "PARTNERSHIP_NOT_ACTIVE", false],
    ["403 기관 불일치", httpError(403, "REFERRAL_FORBIDDEN"), "FORBIDDEN", false],
    ["409 멱등 키", httpError(409, "REFERRAL_IDEMPOTENCY_CONFLICT"), "IDEMPOTENCY_CONFLICT", false],
    ["409 기타 충돌", httpError(409, "INVALID_RESERVATION_STATUS"), "CONFLICT", false],
    ["500", httpError(500), "SERVER_ERROR", true],
    ["503", httpError(503, "INSTITUTION_SERVICE_UNAVAILABLE"), "SERVER_ERROR", true],
    ["NETWORK", new ApiError("NETWORK", "x"), "NETWORK", true],
    ["TIMEOUT", new ApiError("TIMEOUT", "x"), "TIMEOUT", true],
    ["PARSE", new ApiError("PARSE", "x"), "INVALID_RESPONSE", true],
  ];
  for (const [label, error, reason, uncertain] of postFailures) {
    it(`POST ${label} → ${reason}${uncertain ? " (같은 키로만 다시 확인)" : ""}`, async () => {
      state.post = error as Error;
      const originalError = console.error;
      console.error = () => {};
      try {
        const result = await server.submitCreateReferral(validInput(), LOGIN);
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.reason, reason);
          assert.equal(result.uncertain === true, uncertain);
        }
        assert.equal(posts().length, 1);
      } finally {
        console.error = originalError;
      }
    });
  }

  it("같은 멱등 키 요청이 처리 중이면 두 번째는 POST하지 않는다 (IN_PROGRESS, 결과 불명)", async () => {
    let release: (value: unknown) => void = () => {};
    state.post = (body) => new Promise((resolve) => (release = () => resolve(referralDto({ patientName: body.patientName }))));
    const first = server.submitCreateReferral(validInput(), LOGIN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await server.submitCreateReferral(validInput({ idempotencyKey: KEY.toUpperCase() }), LOGIN);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.reason, "IN_PROGRESS");
      assert.equal(second.uncertain, true);
    }
    release(null);
    assert.equal((await first).ok, true);
    assert.equal(posts().length, 1);
    state.post = (body) => referralDto({ patientName: body.patientName });
    // 처리가 끝나면 같은 키로 다시 보낼 수 있다
    assert.equal((await server.submitCreateReferral(validInput(), LOGIN)).ok, true);
    assert.equal(posts().length, 2);
  });

  it("결과 불명 뒤 다시 확인(confirmExisting): 슬롯이 HELD·BOOKED여도 같은 키로 POST해 기존 의뢰를 받는다", async () => {
    for (const status of ["HELD", "BOOKED"]) {
      reset();
      state.slot = { ...baseSlot(), status };
      const result = await server.submitCreateReferral(validInput({ confirmExisting: true }), LOGIN);
      assert.equal(result.ok, true, status);
      assert.equal((posts()[0].body as { idempotencyKey: string }).idempotencyKey, KEY);
    }
    reset();
    state.slot = { ...baseSlot(), status: "UNAVAILABLE" };
    const blocked = await server.submitCreateReferral(validInput({ confirmExisting: true }), LOGIN);
    assert.equal(blocked.ok, false);
    assert.equal(posts().length, 0);
    // confirmExisting는 true일 때만 (문자열 등은 무시)
    reset();
    state.slot = { ...baseSlot(), status: "HELD" };
    const notConfirm = await server.submitCreateReferral(validInput({ confirmExisting: "true" }), LOGIN);
    assert.equal(notConfirm.ok, false);
    assert.equal(posts().length, 0);
  });

});

// ── 5. 접수 뒤 상태 확인 ──

describe("toReferralProgress", () => {
  const cases: [string, unknown, string][] = [
    ["PENDING", null, "PROCESSING"],
    ["PENDING", { status: "REQUESTED", failureReason: null }, "PROCESSING"],
    ["PENDING", { status: "HELD", failureReason: null }, "PROCESSING"],
    ["CONFIRMED", { status: "CONFIRMED", failureReason: null }, "CONFIRMED"],
    ["PENDING", { status: "FAILED", failureReason: "SLOT_CONFLICT" }, "FAILED"],
    ["FAILED", { status: "FAILED", failureReason: "HOLD_EXPIRED" }, "FAILED"],
    ["FAILED", null, "FAILED"],
    ["PENDING", { status: "BLOCKED", failureReason: null }, "FAILED"],
    ["CANCELED", null, "OTHER"],
    ["NEEDS_RESCHEDULE", null, "OTHER"],
  ];
  for (const [referralStatus, reservation, stage] of cases) {
    it(`${referralStatus} + ${reservation ? (reservation as { status: string }).status : "예약 없음"} → ${stage}`, () => {
      const result = server.toReferralProgress(referralStatus as never, reservation as never);
      assert.equal(result.stage, stage);
      assert.ok(result.message.length > 0);
      assert.equal(result.message.includes("  "), false);
    });
  }
  it("201 직후(PENDING·REQUESTED)는 확정으로 표시하지 않는다", () => {
    assert.notEqual(server.toReferralProgress("PENDING", { status: "REQUESTED", failureReason: null }).stage, "CONFIRMED");
  });
  it("실패 사유 문구를 보여 준다", () => {
    assert.equal(server.toReferralProgress("PENDING", { status: "FAILED", failureReason: "SLOT_CONFLICT" }).message, "선택한 슬롯을 예약할 수 없습니다. 다른 시간대를 선택해 다시 시도해 주세요.");
  });
});

describe("loadReferralProgress", () => {
  it("의뢰 단건 → 현재 예약 단건 (GET 2회)", async () => {
    state.referral = referralDto({ referralStatus: "CONFIRMED" });
    state.reservation = reservationDto({ reservationStatus: "CONFIRMED", confirmedAt: "2099-01-01T09:00:00" });
    const result = await server.loadReferralProgress(REFERRAL);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.stage, "CONFIRMED");
      assert.equal(result.reservation?.id, RESERVATION);
    }
    assert.deepEqual(
      state.calls.map((call) => `${call.method} ${call.path}`),
      [`GET /api/v1/referrals/${REFERRAL}`, `GET /api/v1/referrals/reservations/${RESERVATION}`],
    );
  });

  it("현재 예약이 없으면 의뢰만 조회한다", async () => {
    state.referral = referralDto({ currentReservationId: null });
    const result = await server.loadReferralProgress(REFERRAL);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.stage, "PROCESSING");
    assert.equal(state.calls.length, 1);
  });

  it("예약 실패를 FAILED로 보여 준다", async () => {
    state.reservation = reservationDto({ reservationStatus: "FAILED", failureReason: "SLOT_CONFLICT" });
    const result = await server.loadReferralProgress(REFERRAL);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.stage, "FAILED");
  });

  it("잘못된 ID는 요청하지 않고, 인가 실패는 조회 전에 멈춘다", async () => {
    const invalid = await server.loadReferralProgress("abc");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, "INVALID_INPUT");
    assert.equal(state.calls.length, 0);
    state.access = { ok: false, reason: "FORBIDDEN", message: "x" };
    const forbidden = await server.loadReferralProgress(REFERRAL);
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.reason, "FORBIDDEN");
    assert.equal(state.calls.length, 0);
  });

  it("다른 기관 의뢰(404)·만료(401)·응답 형식 오류를 구분한다", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      for (const [value, reason] of [[httpError(404, "REFERRAL_NOT_FOUND"), "NOT_FOUND"], [httpError(401), "UNAUTHORIZED"], [{ id: REFERRAL }, "ERROR"]] as const) {
        reset();
        state.referral = value;
        // apiRequestData 가짜는 값을 돌려주므로 Error는 던지게 바꾼다
        if (value instanceof Error) state.referral = undefined;
        const result = value instanceof Error ? await withReferralError(value) : await server.loadReferralProgress(REFERRAL);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, reason);
      }
    } finally {
      console.error = originalError;
    }
  });
});

/** 의뢰 단건 GET이 error를 던지게 하고 상태를 조회한다 */
async function withReferralError(error: Error) {
  const descriptor = Object.getOwnPropertyDescriptor(state, "referral")!;
  Object.defineProperty(state, "referral", {
    configurable: true,
    get() {
      throw error;
    },
  });
  try {
    return await server.loadReferralProgress(REFERRAL);
  } finally {
    Object.defineProperty(state, "referral", descriptor);
  }
}

describe("submitCreateReferral: 로그인 세션 정합성 (STEP 3-2-2B-2)", () => {
  it("화면을 그린 뒤 다른 탭에서 계정이 바뀌면 SESSION_CHANGED: 슬롯·장비·협약 재확인과 POST 0회", async () => {
    state.loginSession = "loginSessionTagB";
    const result = await server.submitCreateReferral(validInput(), LOGIN);
    assert.deepEqual(result, { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." });
    assert.equal(posts().length, 0);
    assert.equal(state.calls.length, 0, "조회도 하지 않음");
  });

  it("결과 불명 뒤 같은 키 재확인(confirmExisting)도 계정이 바뀌었으면 보내지 않는다", async () => {
    state.loginSession = "loginSessionTagB";
    const result = await server.submitCreateReferral(validInput({ confirmExisting: true }), LOGIN);
    assert.equal(!result.ok && result.reason, "SESSION_CHANGED");
    assert.equal(!result.ok && result.uncertain, undefined, "결과 불명이 아니므로 같은 키 재확인을 유도하지 않음");
    assert.equal(posts().length, 0);
  });

  it("렌더링 세션 인자를 빠뜨리면(undefined) 거부한다", async () => {
    const result = await server.submitCreateReferral(validInput());
    assert.equal(!result.ok && result.reason, "SESSION_CHANGED");
    assert.equal(posts().length, 0);
  });

  it("세션이 같으면 기존 흐름 그대로 POST 1회, 멱등 키는 그대로 전달", async () => {
    const result = await server.submitCreateReferral(validInput(), LOGIN);
    assert.equal(result.ok, true);
    assert.equal(posts().length, 1);
    assert.equal((posts()[0].body as { idempotencyKey: string }).idempotencyKey, KEY);
  });

  it("기존 인증·권한 실패는 그대로 구분 (SESSION_CHANGED로 덮지 않음)", async () => {
    state.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
    const unauthorized = await server.submitCreateReferral(validInput(), LOGIN);
    assert.equal(!unauthorized.ok && unauthorized.reason, "UNAUTHORIZED");
    reset();
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
    const forbidden = await server.submitCreateReferral(validInput(), LOGIN);
    assert.equal(!forbidden.ok && forbidden.reason, "FORBIDDEN");
    assert.equal(posts().length, 0);
  });

  it("SESSION_CHANGED 뒤 같은 키의 처리 중 표시가 남지 않는다 (같은 세션에서는 다시 요청 가능)", async () => {
    state.loginSession = "loginSessionTagB";
    await server.submitCreateReferral(validInput(), LOGIN);
    state.loginSession = LOGIN;
    assert.equal((await server.submitCreateReferral(validInput(), LOGIN)).ok, true);
    assert.equal(posts().length, 1);
  });
});
