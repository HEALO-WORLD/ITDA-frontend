import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * 의뢰기관 예약 취소 (API 모드): 표시 조건·2시간 경계·KST 해석 → Server Action(인증·대상 동일성·오류 코드·갱신).
 * Gateway 요청(apiRequestData)·users/me·Next 헤더/캐시는 가짜. 실제 PATCH·DB 변경 없음.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const REFERRAL = "88888888-8888-4888-8888-888888888888";
const RESERVATION = "aaaaaaaa-8888-4888-8888-888888888888";
const NEW_RESERVATION = "abababab-8888-4888-8888-888888888888";
const OTHER_REFERRAL = "99999999-8888-4888-8888-888888888888";

/** 2099-01-05 10:00 KST = 01:00 UTC */
const START = "2099-01-05T10:00:00";
const END = "2099-01-05T10:30:00";
const START_MS = Date.UTC(2099, 0, 5, 1, 0, 0);
const TWO_HOURS = 2 * 60 * 60 * 1000;

type Access = { ok: true; headers: HeadersInit; user: { userId: string; institutionId: string } } | { ok: false; reason: string; message: string };
const okAccess: Access = { ok: true, headers: { Authorization: "Bearer test" }, user: { userId: USER, institutionId: ORG } };

const referralDto = (overrides: Record<string, unknown> = {}) => ({
  id: REFERRAL,
  referringInstitutionId: ORG,
  referrerId: USER,
  examTypeId: "66666666-6666-4666-8666-666666666666",
  currentReservationId: RESERVATION,
  referralStatus: "CONFIRMED",
  patientName: "홍길동",
  ...overrides,
});
const reservationDto = (overrides: Record<string, unknown> = {}) => ({
  id: RESERVATION,
  referralId: REFERRAL,
  attemptNo: 1,
  slotId: "45444444-4444-4444-8444-444444444444",
  examInstitutionId: "22222222-2222-4222-8222-222222222222",
  equipmentId: "55555555-5555-4555-8555-555555555555",
  examDate: START,
  startTime: START,
  endTime: END,
  reservationStatus: "CONFIRMED",
  failureReason: null,
  confirmedAt: "2099-01-01T09:00:00",
  endedAt: null,
  ...overrides,
});
const TARGET = { attemptNo: 1, startTime: START, endTime: END };
/** 화면이 렌더링된 로그인 세션 구분 값 (공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts) */
const LOGIN = "loginSessionTagA";

const state = {
  access: okAccess as Access,
  referral: referralDto() as unknown,
  reservations: {} as Record<string, unknown>,
  cancel: null as unknown,
  /** 취소 PATCH를 이 Promise가 풀릴 때까지 붙잡는다 (중복 요청 확인용) */
  cancelGate: null as Promise<void> | null,
  calls: [] as { path: string; method: string; body?: unknown }[],
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
  state.reservations = { [RESERVATION]: reservationDto() };
  state.cancel = null;
  state.cancelGate = null;
  state.calls = [];
  state.order = [];
  state.refreshCount = 0;
  state.sameOrigin = true;
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "referrals,partnerships,equipment";
}

const httpError = (status: number, code: string | null = null) => new ApiError("HTTP", `HTTP ${status}`, { status, code });
const take = (value: unknown) => {
  if (value instanceof Error) throw value;
  return value;
};
const patches = () => state.calls.filter((call) => call.method === "PATCH");
const quiet = async <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

let rules: typeof import("@/features/referrals/reservationCancel");
let actions: typeof import("@/features/referrals/reservationCancelActions");
let remote: typeof import("@/features/referrals/remote");

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
        state.order.push(`users/me:${role}`);
        if (!state.access.ok) return state.access;
        return expected === state.loginSession ? state.access : changed;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({ reason: "FORBIDDEN", message: access.message, code: null }),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown } = {}) => {
        const method = options.method ?? "GET";
        state.calls.push({ path, method, body: options.body });
        state.order.push(`${method} ${path}`);
        const cancel = /^\/api\/v1\/referrals\/reservations\/(.+)\/cancel$/.exec(path);
        if (cancel && method === "PATCH") {
          if (state.cancelGate) await state.cancelGate;
          return take(state.cancel);
        }
        if (path === `/api/v1/referrals/${REFERRAL}`) return take(state.referral);
        const reservation = /^\/api\/v1\/referrals\/reservations\/([^/]+)$/.exec(path);
        if (reservation) return take(state.reservations[reservation[1]] ?? httpError(404, "RESERVATION_NOT_FOUND"));
        throw new Error(`unexpected request ${method} ${path}`);
      },
    },
  });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => state.sameOrigin } });

  rules = await import("@/features/referrals/reservationCancel");
  actions = await import("@/features/referrals/reservationCancelActions");
  remote = await import("@/features/referrals/remote");
});

beforeEach(reset);

describe("KST 시각 해석 (브라우저·서버 시간대와 무관)", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("시간대 표기 없는 LocalDateTime을 한국 시간으로 읽는다 (초·소수 초 생략 허용)", () => {
    for (const tz of ["UTC", "America/New_York", "Asia/Seoul"]) {
      process.env.TZ = tz;
      assert.equal(rules.parseSeoulLocalDateTimeMs(START), START_MS, tz);
      assert.equal(rules.parseSeoulLocalDateTimeMs("2099-01-05T10:00"), START_MS, tz);
      assert.equal(rules.parseSeoulLocalDateTimeMs("2099-01-05T10:00:00.250"), START_MS + 250, tz);
    }
  });

  it("UTC·오프셋이 붙었거나 형식이 다르면 해석하지 않는다 (추측하지 않음)", () => {
    for (const bad of [null, "", "2099-01-05", "2099-01-05T10:00:00Z", "2099-01-05T10:00:00+09:00", "2099-02-30T10:00:00", "garbage"]) {
      assert.equal(rules.parseSeoulLocalDateTimeMs(bad), null, String(bad));
    }
  });

  it("취소 마감은 검사 시작 2시간 전 (KST)", () => {
    assert.equal(rules.getReservationCancelDeadlineMs(START), START_MS - TWO_HOURS);
    assert.equal(rules.getReservationCancelDeadlineMs(null), null);
  });
});

describe("취소 버튼 표시 조건과 2시간 경계", () => {
  const reservation = { reservationStatus: "CONFIRMED" as const, startTime: START, endTime: END };
  const deadline = START_MS - TWO_HOURS;

  it("마감 1ms 전까지 표시, 마감 정각부터 숨김(마감 안내)", () => {
    assert.equal(rules.getReservationCancelAvailability("CONFIRMED", reservation, deadline - 1), "AVAILABLE");
    assert.equal(rules.getReservationCancelAvailability("CONFIRMED", reservation, deadline), "DEADLINE_PASSED");
    assert.equal(rules.getReservationCancelAvailability("CONFIRMED", reservation, START_MS + 1), "DEADLINE_PASSED");
  });

  it("의뢰·예약이 모두 CONFIRMED이고 예약·시각이 있어야 한다", () => {
    const now = deadline - 60_000;
    for (const status of ["PENDING", "FAILED", "CANCELED", "NEEDS_RESCHEDULE"] as const) {
      assert.equal(rules.getReservationCancelAvailability(status, reservation, now), "NOT_APPLICABLE", status);
    }
    for (const status of ["REQUESTED", "HELD", "FAILED", "BLOCKED", "CANCELED"] as const) {
      assert.equal(rules.getReservationCancelAvailability("CONFIRMED", { ...reservation, reservationStatus: status }, now), "NOT_APPLICABLE", status);
    }
    assert.equal(rules.getReservationCancelAvailability("CONFIRMED", null, now), "NOT_APPLICABLE");
    assert.equal(rules.getReservationCancelAvailability("CONFIRMED", { ...reservation, startTime: null }, now), "NOT_APPLICABLE");
    assert.equal(rules.getReservationCancelAvailability("CONFIRMED", { ...reservation, endTime: "bad" }, now), "NOT_APPLICABLE");
  });
});

describe("예약 취소 API 함수와 오류 안내", () => {
  it("PATCH .../cancel을 본문 없이 보내고 data: null을 성공으로 본다", async () => {
    await remote.cancelReservation(RESERVATION, { headers: { Authorization: "Bearer test" } });
    assert.deepEqual(state.calls, [{ path: `/api/v1/referrals/reservations/${RESERVATION}/cancel`, method: "PATCH", body: undefined }]);
  });

  it("409 오류 코드별 안내 (서버 메시지 본문은 쓰지 않는다)", () => {
    const expected: Record<string, RegExp> = {
      RESERVATION_CANCEL_DEADLINE_PASSED: /2시간 전이 지나/,
      EXAMINATION_CANCEL_NOT_ALLOWED: /검사가 이미 진행 중이거나 끝나/,
      INVALID_RESERVATION_STATUS: /확정된 예약이 아니어서/,
      INVALID_REFERRAL_STATUS: /의뢰 상태가 바뀌어/,
    };
    for (const [code, pattern] of Object.entries(expected)) {
      assert.match(remote.getReservationCancelErrorMessage(httpError(409, code)), pattern, code);
    }
    assert.match(remote.getReservationCancelErrorMessage(httpError(409, "UNKNOWN_CODE")), /예약 상태가 바뀌어/);
    assert.match(remote.getReservationCancelErrorMessage(new ApiError("NETWORK", "x")), /이미 처리되었을 수 있으니/);
  });
});

describe("cancelReservationAction: 인증·인가", () => {
  it("다른 출처·Mock 모드·로그아웃·다른 역할은 아무 요청도 보내지 않는다", async () => {
    state.sameOrigin = false;
    assert.equal((await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN)).ok, false);
    assert.deepEqual(state.order, []);

    reset();
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const mockMode = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!mockMode.ok && mockMode.reason, "NOT_AVAILABLE");
    assert.deepEqual(state.order, []);

    for (const [reason, expected] of [
      ["SIGNED_OUT", "SIGNED_OUT"],
      ["UNAUTHORIZED", "UNAUTHORIZED"],
      ["FORBIDDEN_ROLE", "FORBIDDEN"],
      ["UNVERIFIED", "FORBIDDEN"],
    ] as const) {
      reset();
      state.access = { ok: false, reason, message: "거부" };
      const result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
      assert.equal(!result.ok && result.reason, expected, reason);
      assert.deepEqual(state.order, ["users/me:REFERRING"], reason);
    }
  });

  it("역할 확인 뒤에만 조회하고, 형식이 틀린 입력은 조회하지 않는다", async () => {
    for (const [referralId, target] of [
      ["not-uuid", TARGET],
      [REFERRAL, null],
      [REFERRAL, { ...TARGET, attemptNo: 0 }],
      [REFERRAL, { ...TARGET, startTime: "2099-01-05T10:00:00Z" }],
    ] as const) {
      reset();
      const result = await actions.cancelReservationAction(referralId, target, LOGIN);
      assert.equal(!result.ok && result.reason, "INVALID_INPUT");
      assert.deepEqual(state.order, ["users/me:REFERRING"]);
    }
  });

  it("Gateway 403(다른 기관 의뢰 등)은 취소 요청 없이 거부 안내", async () => {
    state.referral = httpError(403, "ACCESS_DENIED");
    const result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    assert.equal(!result.ok && result.reason, "FORBIDDEN");
    assert.equal(patches().length, 0);
  });

  it("다른 기관 의뢰(404)는 취소 요청 없이 안내하고 목록을 다시 그린다", async () => {
    state.referral = httpError(404, "REFERRAL_NOT_FOUND");
    const result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    assert.equal(!result.ok && result.reason, "NOT_FOUND");
    assert.equal(patches().length, 0);
    assert.equal(state.refreshCount, 1);
  });
});

describe("cancelReservationAction: 취소 대상 예약 동일성", () => {
  it("확인한 예약이 지금도 확정된 현재 예약이면 그 예약 ID로만 취소한다", async () => {
    const result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.deepEqual(result, { ok: true, message: "예약을 취소했습니다." });
    assert.deepEqual(state.order, [
      "users/me:REFERRING",
      `GET /api/v1/referrals/${REFERRAL}`,
      `GET /api/v1/referrals/reservations/${RESERVATION}`,
      `PATCH /api/v1/referrals/reservations/${RESERVATION}/cancel`,
    ]);
    assert.equal(state.refreshCount, 1);
  });

  it("초 생략 등 표기만 다른 같은 시각은 같은 예약으로 본다", async () => {
    const result = await actions.cancelReservationAction(REFERRAL, { attemptNo: 1, startTime: "2099-01-05T10:00", endTime: "2099-01-05T10:30:00.000" }, LOGIN);
    assert.equal(result.ok, true);
  });

  const staleCases: [string, () => void][] = [
    ["대화상자를 연 뒤 재조정되어 현재 예약이 새 예약으로 바뀜", () => {
      state.referral = referralDto({ currentReservationId: NEW_RESERVATION });
      state.reservations[NEW_RESERVATION] = reservationDto({ id: NEW_RESERVATION, attemptNo: 2, startTime: "2099-01-06T10:00:00", endTime: "2099-01-06T10:30:00" });
    }],
    ["새 예약이 같은 시각이어도 시도 번호가 다르면 다른 예약", () => {
      state.referral = referralDto({ currentReservationId: NEW_RESERVATION });
      state.reservations[NEW_RESERVATION] = reservationDto({ id: NEW_RESERVATION, attemptNo: 2 });
    }],
    ["검사 시각이 다름", () => {
      state.reservations[RESERVATION] = reservationDto({ startTime: "2099-01-05T11:00:00", endTime: "2099-01-05T11:30:00" });
    }],
    ["예약이 이미 취소됨", () => {
      state.reservations[RESERVATION] = reservationDto({ reservationStatus: "CANCELED" });
    }],
    ["의뢰가 재조정 필요로 바뀜", () => {
      state.referral = referralDto({ referralStatus: "NEEDS_RESCHEDULE" });
    }],
    ["현재 예약이 없어짐", () => {
      state.referral = referralDto({ currentReservationId: null });
    }],
    ["현재 예약을 찾을 수 없음(404)", () => {
      state.reservations = {};
    }],
    ["예약이 다른 의뢰의 것", () => {
      state.reservations[RESERVATION] = reservationDto({ referralId: OTHER_REFERRAL });
    }],
  ];
  for (const [name, arrange] of staleCases) {
    it(`${name} → 취소 API를 부르지 않고 STALE (목록 다시 그림)`, async () => {
      arrange();
      const result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
      assert.equal(!result.ok && result.reason, "STALE", name);
      assert.equal(patches().length, 0, name);
      assert.equal(state.refreshCount, 1, name);
    });
  }

  it("의뢰·예약 조회 실패(5xx·네트워크)는 취소하지 않고 조회 실패 안내", async () => {
    state.reservations[RESERVATION] = httpError(500);
    const result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    assert.equal(!result.ok && result.reason, "LOOKUP_FAILED");
    assert.equal(patches().length, 0);
  });
});

describe("cancelReservationAction: 409 등 취소 실패", () => {
  for (const code of ["EXAMINATION_CANCEL_NOT_ALLOWED", "RESERVATION_CANCEL_DEADLINE_PASSED", "INVALID_RESERVATION_STATUS", "INVALID_REFERRAL_STATUS"]) {
    it(`409 ${code} → 코드별 안내 + 목록 다시 그림`, async () => {
      state.cancel = httpError(409, code);
      const result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
      assert.equal(!result.ok && result.reason, "CONFLICT");
      assert.equal(!result.ok && result.code, code);
      assert.equal(!result.ok && result.message, remote.RESERVATION_CANCEL_ERROR_MESSAGES[code]);
      assert.equal(state.refreshCount, 1);
    });
  }

  it("401은 공통 로그인 안내, 네트워크 오류는 '결과 확인 불가' + 다시 그림", async () => {
    state.cancel = httpError(401, "TOKEN_EXPIRED");
    let result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!result.ok && result.reason, "UNAUTHORIZED");
    assert.match(!result.ok ? result.message : "", /다시 로그인/);

    reset();
    state.cancel = new ApiError("NETWORK", "연결 실패");
    result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    assert.equal(!result.ok && result.reason, "UNKNOWN_RESULT");
    assert.equal(state.refreshCount, 1);
  });

  it("5xx·타임아웃·네트워크는 실패로 단정하지 않고 결과 불명 + 목록 다시 그림 (4xx는 그대로 실패)", async () => {
    const unknown = [httpError(500), httpError(502), httpError(503, "SERVICE_UNAVAILABLE"), httpError(504), new ApiError("TIMEOUT", "t"), new ApiError("NETWORK", "n")];
    for (const error of unknown) {
      reset();
      state.cancel = error;
      const result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
      const label = `${error.kind} ${error.status ?? ""}`;
      assert.equal(!result.ok && result.reason, "UNKNOWN_RESULT", label);
      assert.match(!result.ok ? result.message : "", /결과를 확인하지 못했습니다/, label);
      assert.doesNotMatch(!result.ok ? result.message : "", /취소하지 못했습니다|취소했습니다/, label);
      assert.equal(state.refreshCount, 1, label);
      assert.equal(patches().length, 1, `${label}: 자동 재요청 없음`);
    }
    reset();
    state.cancel = httpError(400);
    const result = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    assert.equal(!result.ok && result.reason, "ERROR");
  });

  it("결과에 예약 ID·토큰·환자 이름을 담지 않는다", async () => {
    const results = [await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN)];
    reset();
    state.cancel = httpError(409, "INVALID_RESERVATION_STATUS");
    results.push(await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN)));
    for (const result of results) {
      const text = JSON.stringify(result);
      assert.doesNotMatch(text, new RegExp(`${RESERVATION}|Bearer|홍길동`));
    }
  });
});

describe("cancelReservationAction: 중복 제출 방지와 실패 후 복구", () => {
  it("같은 의뢰의 취소가 처리 중이면 두 번째 호출은 조회·취소하지 않는다", async () => {
    let release!: () => void;
    state.cancelGate = new Promise((resolve) => (release = resolve));
    const first = actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!second.ok && second.reason, "DUPLICATE_REQUEST");
    release();
    assert.equal((await first).ok, true);
    assert.equal(patches().length, 1);
  });

  it("실패 뒤에는 처리 중 표시가 풀려 다시 시도할 수 있다", async () => {
    state.cancel = httpError(500);
    assert.equal((await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN))).ok, false);
    state.cancel = null;
    assert.equal((await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN)).ok, true);
    assert.equal(patches().length, 2);
  });
});

describe("5xx 결과 불명 뒤 최신 상세로 판단 (classifyCancelRecheck)", () => {
  const ok = (overrides: Record<string, unknown> = {}) => ({
    referralStatus: "CONFIRMED" as const,
    reservation: { state: "ok" as const, attemptNo: 1, reservationStatus: "CONFIRMED" as const, startTime: START, endTime: END, ...overrides },
  });

  it("A. 확인한 그 예약이 CANCELED → 취소 완료", () => {
    assert.equal(rules.classifyCancelRecheck(TARGET, { ...ok({ reservationStatus: "CANCELED" }), referralStatus: "CANCELED" }), "CANCELED");
  });

  it("B. 같은 예약(시도 번호·시작·종료)이 아직 확정 → 수동 재시도만 가능", () => {
    assert.equal(rules.classifyCancelRecheck(TARGET, ok()), "SAME_CONFIRMED");
    assert.equal(rules.classifyCancelRecheck(TARGET, ok({ startTime: "2099-01-05T10:00" })), "SAME_CONFIRMED");
  });

  it("C. 예약 시도·시각·상태가 바뀌었거나 현재 예약이 없으면 변경 (재시도 차단)", () => {
    const changed = [
      ok({ attemptNo: 2 }),
      ok({ startTime: "2099-01-05T11:00:00", endTime: "2099-01-05T11:30:00" }),
      ok({ endTime: "2099-01-05T10:40:00" }),
      ok({ reservationStatus: "BLOCKED" }),
      { ...ok(), referralStatus: "NEEDS_RESCHEDULE" as const },
      { ...ok({ attemptNo: 2, reservationStatus: "CANCELED" }), referralStatus: "CANCELED" as const },
      { referralStatus: "CONFIRMED" as const, reservation: { state: "none" as const } },
      { referralStatus: "CONFIRMED" as const, reservation: { state: "missing" as const } },
    ];
    for (const detail of changed) assert.equal(rules.classifyCancelRecheck(TARGET, detail), "CHANGED", JSON.stringify(detail));
  });

  it("D. 상세·예약 재조회 실패 → 판단하지 않음", () => {
    assert.equal(rules.classifyCancelRecheck(TARGET, null), "LOOKUP_FAILED");
    assert.equal(rules.classifyCancelRecheck(TARGET, { referralStatus: "CONFIRMED", reservation: { state: "error" } }), "LOOKUP_FAILED");
  });

  it("500 뒤 실제로는 취소됐는데 같은 확인으로 다시 보내도 PATCH를 보내지 않는다 (서버 재확인)", async () => {
    state.cancel = httpError(500);
    const first = await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    assert.equal(!first.ok && first.reason, "UNKNOWN_RESULT");
    // 백엔드는 커밋까지 끝났다
    state.referral = referralDto({ referralStatus: "CANCELED" });
    state.reservations[RESERVATION] = reservationDto({ reservationStatus: "CANCELED" });
    state.cancel = null;
    const again = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!again.ok && again.reason, "STALE");
    assert.equal(patches().length, 1);
  });

  it("500 뒤 재조정으로 예약 시도가 바뀌면 이전 확인으로는 새 예약을 취소하지 않는다", async () => {
    state.cancel = httpError(500);
    await quiet(() => actions.cancelReservationAction(REFERRAL, TARGET, LOGIN));
    state.referral = referralDto({ currentReservationId: NEW_RESERVATION });
    state.reservations[NEW_RESERVATION] = reservationDto({ id: NEW_RESERVATION, attemptNo: 2 });
    state.cancel = null;
    const again = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!again.ok && again.reason, "STALE");
    assert.deepEqual(patches().map((call) => call.path), [`/api/v1/referrals/reservations/${RESERVATION}/cancel`]);
  });
});

describe("cancelReservationAction: 로그인 세션 정합성 (STEP 3-2-2A)", () => {
  it("화면을 그린 뒤 다른 탭에서 계정이 바뀌면 SESSION_CHANGED: 조회·취소 요청 0회, 목록 다시 그리지 않음", async () => {
    state.loginSession = "loginSessionTagB";
    const result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.deepEqual(result, {
      ok: false,
      reason: "SESSION_CHANGED",
      message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요.",
      code: "SESSION_CHANGED",
    });
    assert.equal(state.calls.length, 0, "의뢰·예약 조회도 하지 않음");
    assert.equal(patches().length, 0);
    assert.equal(state.refreshCount, 0);
  });

  it("렌더링 세션 인자를 빠뜨리면(undefined) 거부한다", async () => {
    const result = await actions.cancelReservationAction(REFERRAL, TARGET);
    assert.equal(!result.ok && result.reason, "SESSION_CHANGED");
    assert.equal(patches().length, 0);
  });

  it("세션이 같으면 기존 흐름 그대로 취소 (렌더링 세션 값을 그대로 공통 함수에 넘김)", async () => {
    const result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(result.ok, true);
    assert.equal(patches().length, 1);
  });

  it("기존 인증 실패는 그대로 구분 (SESSION_CHANGED로 덮지 않음)", async () => {
    state.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
    const result = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!result.ok && result.reason, "UNAUTHORIZED");
    reset();
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
    const forbidden = await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    assert.equal(!forbidden.ok && forbidden.reason, "FORBIDDEN");
  });

  it("SESSION_CHANGED 뒤에도 처리 중 표시가 남지 않는다 (같은 세션에서는 다시 취소 가능)", async () => {
    state.loginSession = "loginSessionTagB";
    await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN);
    state.loginSession = LOGIN;
    assert.equal((await actions.cancelReservationAction(REFERRAL, TARGET, LOGIN)).ok, true);
    assert.equal(patches().length, 1);
  });
});
