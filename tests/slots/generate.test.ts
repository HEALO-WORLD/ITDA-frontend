import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";
import { addDays, getSeoulNow, getWeekday } from "@/lib/date/seoulDate";

/**
 * 검사기관 슬롯 생성: 통신 계층(remote) 검증·오류 구분 + 서버 처리(generateServer)의 인증·소속·요청 전 확인.
 * users/me(requireRoleAccess)와 Gateway(apiRequestData)는 가짜로 바꾼다 (실제 네트워크·DB 변경 없음).
 */

const OWN_INSTITUTION = "20000000-0000-0000-0000-000000000003";
const OTHER_INSTITUTION = "20000000-0000-0000-0000-000000000099";
const EQUIPMENT = "30000000-0000-0000-0000-000000000001";
const OTHER_EQUIPMENT = "30000000-0000-0000-0000-000000000099";
const EXAM_TYPE = "40000000-0000-0000-0000-000000000001";
const UNLINKED_EXAM_TYPE = "40000000-0000-0000-0000-000000000002";
const LINK_ID = "50000000-0000-0000-0000-000000000001";

const today = getSeoulNow().dateKey;
/** 다음 주 같은 요일 이후의 첫 월요일·일요일 (월~금 운영, 일요일 휴무) */
const nextWeekday = (target: number) => {
  let date = addDays(today, 7);
  while (getWeekday(date) !== target) date = addDays(date, 1);
  return date;
};
const MONDAY = nextWeekday(1);
const SUNDAY = nextWeekday(0);

type Access = { ok: true; headers: HeadersInit; user: { institutionId: string } } | { ok: false; reason: string; message: string };

/** 화면이 렌더링된 로그인 세션 구분 값 (공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts) */
const LOGIN = "loginSessionTagA";

const gateway = {
  access: null as unknown as Access,
  /** 지금 쿠키의 로그인 세션 구분 값 (다른 탭에서 계정이 바뀌면 달라진다) */
  loginSession: LOGIN as string | null,
  calls: [] as { method: string; path: string; body?: unknown }[],
  hours: [] as unknown[],
  durationMinutes: 30 as number | null,
  equipmentStatus: "OPERATIONAL",
  generate: null as null | ((body: { equipmentId: string; examTypeId: string; date: string }) => unknown),
  /** DB에 슬롯이 있는 날짜 (생성 성공 시 추가: 같은 기간 재요청 확인용) */
  slotDates: new Set<string>(),
  /** 슬롯 검색(기존 슬롯 확인) 실패 */
  searchFails: false,
};

const slotsFor = (body: { equipmentId: string; examTypeId: string; date: string }, count = 3) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${body.date.replace(/-/g, "")}-0000-4000-8000-00000000000${index + 1}`,
    equipmentId: body.equipmentId,
    examTypeId: body.examTypeId,
    startsAt: `${body.date}T${String(9 + index).padStart(2, "0")}:00:00+09:00`,
    endsAt: `${body.date}T${String(9 + index).padStart(2, "0")}:30:00+09:00`,
    status: "AVAILABLE",
  }));

function resetGateway() {
  gateway.loginSession = LOGIN;
  gateway.access = { ok: true, headers: { Authorization: "Bearer test" }, user: { institutionId: OWN_INSTITUTION } };
  gateway.calls = [];
  gateway.hours = [1, 2, 3, 4, 5].map((week, index) => ({ id: `70000000-0000-0000-0000-00000000000${index}`, equipmentId: EQUIPMENT, week, startTime: "09:00", endTime: "12:00" }));
  gateway.durationMinutes = 30;
  gateway.equipmentStatus = "OPERATIONAL";
  gateway.slotDates = new Set();
  gateway.searchFails = false;
  gateway.generate = (body) => slotsFor(body);
}

const page = <T>(contents: T[]) => ({ contents, totalElements: contents.length, totalPages: 1, size: 100, number: 0 });

async function fakeApiRequestData(path: string, options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}) {
  const method = options.method ?? "GET";
  gateway.calls.push({ method, path, body: options.body });
  const equipmentMatch = path.match(/^\/api\/v1\/equipments\/([^/]+)(\/.*)?$/);
  if (equipmentMatch) {
    const id = decodeURIComponent(equipmentMatch[1]);
    const institutionId = id === OTHER_EQUIPMENT ? OTHER_INSTITUTION : OWN_INSTITUTION;
    if (!equipmentMatch[2]) return { id, institutionId, name: "CT-1", modality: "CT", status: gateway.equipmentStatus };
    if (equipmentMatch[2] === "/exam-types") {
      return page([{ id: LINK_ID, equipmentId: id, examTypeId: EXAM_TYPE, examTypeName: "흉부 CT", modality: "CT", durationMinutes: gateway.durationMinutes }]);
    }
    if (equipmentMatch[2] === "/operating-hours") return gateway.hours;
  }
  if (path === "/api/v1/slots/generate" && method === "POST") {
    const body = options.body as { equipmentId: string; examTypeId: string; date: string };
    const created = gateway.generate!(body);
    gateway.slotDates.add(body.date);
    return created;
  }
  if (path === "/api/v1/slots" && method === "GET") {
    if (gateway.searchFails) throw new ApiError("HTTP", "x", { status: 500 } as never);
    const from = String(options.query?.from).slice(0, 10);
    const to = String(options.query?.to).slice(0, 10);
    const items = [...gateway.slotDates].filter((date) => date >= from && date < to).sort().flatMap((date) => slotsFor({ equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, date }));
    return { items, page: options.query?.page, size: options.query?.size, hasNext: false };
  }
  throw new ApiError("HTTP", "not found", { status: 404 });
}

let remote: typeof import("@/features/slots/remote");
let server: typeof import("@/features/slots/generateServer");

before(async () => {
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "slots,equipment";
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        gateway.calls.push({ method: "GET", path: `users/me:${role}` });
        return gateway.access;
      },
      // 실제 함수와 같은 순서: 형식 확인 → 역할 확인 → 쿠키의 로그인 세션 비교
      requireRoleMutationAccess: async (role: string, expected: unknown) => {
        const changed = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
        if (expected !== null && typeof expected !== "string") return changed;
        gateway.calls.push({ method: "GET", path: `users/me:${role}` });
        if (!gateway.access.ok) return gateway.access;
        return expected === gateway.loginSession ? gateway.access : changed;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/api/client", { namedExports: { apiRequestData: fakeApiRequestData } });
  remote = await import("@/features/slots/remote");
  server = await import("@/features/slots/generateServer");
});

beforeEach(resetGateway);

const gatewayDataCalls = () => gateway.calls.filter((call) => !call.path.startsWith("users/me"));
const posts = () => gateway.calls.filter((call) => call.method === "POST");
const input = (overrides: Record<string, unknown> = {}) => ({ equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, date: MONDAY, ...overrides });

describe("통신 계층 (slots/remote)", () => {
  it("요청 값 확인: 장비·검사 유형·날짜 미선택·형식 오류", () => {
    assert.equal(remote.validateSlotGenerateRequest({ examTypeId: EXAM_TYPE, date: MONDAY }).ok, false);
    const noExam = remote.validateSlotGenerateRequest({ equipmentId: EQUIPMENT, date: MONDAY });
    assert.equal(!noExam.ok && noExam.field, "examTypeId");
    const badDate = remote.validateSlotGenerateRequest({ equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, date: "2026-02-30" });
    assert.equal(!badDate.ok && badDate.field, "date");
    assert.deepEqual(remote.validateSlotGenerateRequest(input({ extra: "x" })), { ok: true, body: { equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, date: MONDAY } });
  });

  it("응답 DTO: 요청한 장비·검사 유형·서울 날짜·AVAILABLE·시작<종료·ID 중복 없음만 통과", () => {
    const body = { equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, date: MONDAY };
    const ok = slotsFor(body);
    assert.equal(remote.isSlotGenerateResponse(ok, body), true);
    const broken: unknown[] = [
      [],
      { items: ok },
      [{ ...ok[0], equipmentId: OTHER_EQUIPMENT }],
      [{ ...ok[0], examTypeId: UNLINKED_EXAM_TYPE }],
      [{ ...ok[0], startsAt: `${addDays(MONDAY, 1)}T09:00:00+09:00`, endsAt: `${addDays(MONDAY, 1)}T09:30:00+09:00` }],
      [{ ...ok[0], status: "BOOKED" }],
      [{ ...ok[0], endsAt: ok[0].startsAt }],
      [ok[0], ok[0]],
      [{ ...ok[0], id: "not-uuid" }],
    ];
    for (const data of broken) assert.equal(remote.isSlotGenerateResponse(data, body), false, JSON.stringify(data).slice(0, 80));
  });

  it("오류 구분: 400·401·403·404·409·5xx·NETWORK·TIMEOUT·PARSE", () => {
    const http = (status: number, code?: string) => new ApiError("HTTP", "x", { status, code } as never);
    const table: [unknown, string, RegExp][] = [
      [http(400, "SLOT_START_NOT_FUTURE"), "INVALID", /지난 날짜/],
      [http(400, "SLOT_GENERATION_EMPTY"), "INVALID", /미래 슬롯이 없습니다/],
      [http(401), "UNAUTHORIZED", /로그인/],
      [http(403, "FORBIDDEN"), "FORBIDDEN", /우리 기관 장비/],
      [http(404, "RESOURCE_NOT_FOUND"), "NOT_FOUND", /찾을 수 없습니다/],
      [http(409, "SLOT_TIME_OVERLAP"), "CONFLICT", /겹치는 슬롯/],
      [http(409, "REFERENCE_NOT_AVAILABLE"), "CONFLICT", /운영시간이 없거나/],
      [http(503, "REFERENCE_SERVICE_UNAVAILABLE"), "SERVER_ERROR", /일시적으로/],
      [http(500), "SERVER_ERROR", /서버 오류/],
      [new ApiError("NETWORK", "x"), "NETWORK", /연결할 수 없습니다/],
      [new ApiError("TIMEOUT", "x"), "TIMEOUT", /만들어졌을 수 있으니/],
      [new ApiError("PARSE", "슬롯 생성 결과를 확인할 수 없습니다."), "INVALID_RESPONSE", /확인할 수 없습니다/],
    ];
    for (const [error, reason, message] of table) {
      const failure = remote.getSlotGenerateFailure(error);
      assert.equal(failure.reason, reason);
      assert.match(failure.message, message);
    }
  });

  it("응답 형식이 다르면 PARSE로 던지고 Mock 슬롯으로 대신하지 않는다", async () => {
    gateway.generate = () => ({ unexpected: true });
    await assert.rejects(remote.generateSlots(input(), { headers: {} }), (error: unknown) => error instanceof ApiError && error.kind === "PARSE");
  });
});

describe("서버 처리 (generateServer.submitSlotGeneration)", () => {
  it("정상: 소속·검사 유형·운영 요일을 확인한 뒤 POST 1회, 서버가 준 슬롯 ID·시각만 돌려준다", async () => {
    const result = await server.submitSlotGeneration(input(), LOGIN);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.slots.length, 3);
    assert.equal(result.slots[0].id, `${MONDAY.replace(/-/g, "")}-0000-4000-8000-000000000001`);
    assert.equal(result.slots[0].startAt, `${MONDAY}T09:00`);
    assert.equal(result.slots[0].endAt, `${MONDAY}T09:30`);
    assert.equal(gateway.calls[0].path, "users/me:EXAMINING");
    assert.equal(posts().length, 1);
    // 요청 본문은 equipmentId·examTypeId·date만 (기관·사용자·역할 값 없음)
    assert.deepEqual(posts()[0].body, { equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, date: MONDAY });
  });

  it("검사기관이 아닌 계정(의뢰기관·관리자·확인 실패)은 Gateway 요청 없이 차단", async () => {
    for (const reason of ["FORBIDDEN_ROLE", "UNVERIFIED"]) {
      gateway.calls = [];
      gateway.access = { ok: false, reason, message: "권한 없음" };
      const result = await server.submitSlotGeneration(input(), LOGIN);
      assert.equal(!result.ok && result.reason, "FORBIDDEN");
      assert.deepEqual(gatewayDataCalls(), []);
    }
    gateway.calls = [];
    gateway.access = { ok: false, reason: "SIGNED_OUT", message: "로그인" };
    const signedOut = await server.submitSlotGeneration(input(), LOGIN);
    assert.equal(!signedOut.ok && signedOut.reason, "SIGNED_OUT");
    assert.deepEqual(gatewayDataCalls(), []);
  });

  it("다른 기관 장비는 POST하지 않고 FORBIDDEN", async () => {
    const result = await server.submitSlotGeneration(input({ equipmentId: OTHER_EQUIPMENT }), LOGIN);
    assert.equal(!result.ok && result.reason, "FORBIDDEN");
    assert.equal(posts().length, 0);
  });

  it("장비·검사 유형 미선택은 Gateway 요청 없이 INVALID", async () => {
    const noEquipment = await server.submitSlotGeneration(input({ equipmentId: "" }), LOGIN);
    assert.equal(!noEquipment.ok && noEquipment.field, "equipmentId");
    const noExamType = await server.submitSlotGeneration(input({ examTypeId: undefined }), LOGIN);
    assert.equal(!noExamType.ok && noExamType.field, "examTypeId");
    assert.deepEqual(gatewayDataCalls(), []);
  });

  it("장비에 연결되지 않은 검사 유형·소요 시간 미설정은 POST하지 않는다", async () => {
    const unlinked = await server.submitSlotGeneration(input({ examTypeId: UNLINKED_EXAM_TYPE }), LOGIN);
    assert.equal(!unlinked.ok && unlinked.field, "examTypeId");
    gateway.durationMinutes = null;
    const noDuration = await server.submitSlotGeneration(input(), LOGIN);
    assert.match(!noDuration.ok ? noDuration.message : "", /소요 시간/);
    assert.equal(posts().length, 0);
  });

  it("운영시간 미설정·운영하지 않는 요일은 POST하지 않는다", async () => {
    const closedDay = await server.submitSlotGeneration(input({ date: SUNDAY }), LOGIN);
    assert.equal(!closedDay.ok && closedDay.field, "date");
    assert.match(!closedDay.ok ? closedDay.message : "", /운영하지 않는 요일/);
    gateway.hours = [];
    const unset = await server.submitSlotGeneration(input(), LOGIN);
    assert.match(!unset.ok ? unset.message : "", /운영시간이 설정되지 않았습니다/);
    assert.equal(posts().length, 0);
  });

  it("지난 날짜는 Gateway 데이터 요청 없이 INVALID", async () => {
    const result = await server.submitSlotGeneration(input({ date: addDays(today, -1) }), LOGIN);
    assert.equal(!result.ok && result.field, "date");
    assert.deepEqual(gatewayDataCalls(), []);
  });

  it("점검·장애 장비는 POST하지 않는다", async () => {
    gateway.equipmentStatus = "MAINTENANCE";
    const result = await server.submitSlotGeneration(input(), LOGIN);
    assert.equal(!result.ok && result.reason, "CONFLICT");
    assert.equal(posts().length, 0);
  });

  it("이미 생성된 슬롯과 시간 중복(409 SLOT_TIME_OVERLAP) → CONFLICT", async () => {
    gateway.generate = () => {
      throw new ApiError("HTTP", "x", { status: 409, code: "SLOT_TIME_OVERLAP" } as never);
    };
    const result = await server.submitSlotGeneration(input(), LOGIN);
    assert.equal(!result.ok && result.reason, "CONFLICT");
    assert.match(!result.ok ? result.message : "", /겹치는 슬롯/);
  });

  it("서버 오류·네트워크 실패·응답 형식 오류를 구분한다", async () => {
    const cases: [() => unknown, string][] = [
      [() => { throw new ApiError("HTTP", "x", { status: 500 } as never); }, "SERVER_ERROR"],
      [() => { throw new ApiError("NETWORK", "x"); }, "NETWORK"],
      [() => { throw new ApiError("TIMEOUT", "x"); }, "TIMEOUT"],
      [() => [], "INVALID_RESPONSE"],
    ];
    for (const [generate, reason] of cases) {
      gateway.generate = generate as never;
      const result = await server.submitSlotGeneration(input(), LOGIN);
      assert.equal(!result.ok && result.reason, reason);
    }
  });

  it("Mock 모드면 아무 요청 없이 NOT_AVAILABLE (Mock 생성으로 대신하지 않는다)", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    try {
      const result = await server.submitSlotGeneration(input(), LOGIN);
      assert.equal(!result.ok && result.reason, "NOT_AVAILABLE");
      assert.deepEqual(gateway.calls, []);
    } finally {
      process.env.NEXT_PUBLIC_API_MODE = "api";
    }
  });

  it("생성 결과 재확인: 우리 기관 장비만, 그날 하루 equipmentId·examTypeId로 검색", async () => {
    gateway.slotDates.add(MONDAY);
    const result = await server.loadGeneratedSlots(EQUIPMENT, EXAM_TYPE, MONDAY);
    assert.equal(result.ok && result.slots.length, 3);
    const search = gateway.calls.find((call) => call.path === "/api/v1/slots");
    assert.ok(search);
    gateway.calls = [];
    const other = await server.loadGeneratedSlots(OTHER_EQUIPMENT, EXAM_TYPE, MONDAY);
    assert.equal(!other.ok && other.reason, "FORBIDDEN");
    assert.equal(gateway.calls.some((call) => call.path === "/api/v1/slots"), false);
  });
});

describe("기간 계산 (generationRange)", () => {
  let range: typeof import("@/features/slots/generationRange");
  before(async () => {
    range = await import("@/features/slots/generationRange");
  });

  it("오늘 이전·시작>종료·15일 이상을 막고, 같은 날·14일은 허용한다", () => {
    const check = (start: string, end: string) => range.validateGenerationRange(start, end, today, 366);
    assert.equal(check(MONDAY, MONDAY), null);
    assert.equal(check(MONDAY, addDays(MONDAY, 13)), null);
    assert.equal(check(MONDAY, addDays(MONDAY, 14))?.field, "endDate");
    assert.match(check(MONDAY, addDays(MONDAY, 14))?.message ?? "", /최대 14일/);
    assert.equal(check(addDays(MONDAY, 1), MONDAY)?.field, "endDate");
    assert.equal(check(addDays(today, -1), today)?.field, "startDate");
    assert.equal(check("2026-02-30", MONDAY)?.field, "startDate");
  });

  it("운영 요일로 생성 대상·휴무 제외를 나눈다 (월~금 운영, 7일)", () => {
    const dates = range.listRangeDates(MONDAY, addDays(MONDAY, 6));
    const { targets, skipped } = range.splitOperatingDates(dates, new Set([1, 2, 3, 4, 5]));
    assert.equal(dates.length, 7);
    assert.equal(targets.length, 5);
    assert.deepEqual(skipped, [addDays(MONDAY, 5), addDays(MONDAY, 6)]);
  });
});

describe("기간 생성 (generateServer.submitSlotRangeGeneration)", () => {
  const rangeInput = (startDate: string, endDate: string, overrides: Record<string, unknown> = {}) => ({ equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, startDate, endDate, ...overrides });
  const postedDates = () => posts().map((call) => (call.body as { date: string }).date);
  const statuses = (result: Awaited<ReturnType<typeof server.submitSlotRangeGeneration>>) => (result.ok ? result.days.map((day) => day.status) : []);

  it("1. 하루만 선택하면 POST 1회", async () => {
    const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY), LOGIN);
    assert.deepEqual(statuses(result), ["SUCCESS"]);
    assert.deepEqual(postedDates(), [MONDAY]);
    assert.equal(result.ok && result.summary.createdSlots, 3);
  });

  it("2. 월~금 5일: 날짜별로 순서대로 5회", async () => {
    const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 4)), LOGIN);
    assert.deepEqual(postedDates(), [0, 1, 2, 3, 4].map((n) => addDays(MONDAY, n)));
    assert.equal(result.ok && result.summary.success, 5);
    assert.equal(result.ok && result.summary.createdSlots, 15);
  });

  it("3. 주말 포함 7일: 휴무일은 요청하지 않고 SKIPPED", async () => {
    const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 6)), LOGIN);
    assert.deepEqual(statuses(result), ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SKIPPED", "SKIPPED"]);
    assert.equal(posts().length, 5);
    assert.equal(result.ok && result.summary.skipped, 2);
  });

  it("4·5. 14일은 허용(운영일 10회), 15일은 요청 없이 차단", async () => {
    const ok = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 13)), LOGIN);
    assert.equal(ok.ok && ok.days.length, 14);
    assert.equal(posts().length, 10);
    gateway.calls = [];
    const tooLong = await server.submitSlotRangeGeneration(rangeInput(addDays(MONDAY, 14), addDays(MONDAY, 28)), LOGIN);
    assert.equal(!tooLong.ok && tooLong.field, "endDate");
    assert.deepEqual(gatewayDataCalls(), []);
  });

  it("6. 시작일이 종료일보다 늦으면 요청 없이 오류", async () => {
    const result = await server.submitSlotRangeGeneration(rangeInput(addDays(MONDAY, 2), MONDAY), LOGIN);
    assert.equal(!result.ok && result.field, "endDate");
    assert.deepEqual(gatewayDataCalls(), []);
  });

  it("7·8. 409와 부분 성공: 날짜별로 구분하고 집계가 맞다", async () => {
    gateway.generate = (body) => {
      if (body.date === addDays(MONDAY, 2)) throw new ApiError("HTTP", "x", { status: 409, code: "SLOT_TIME_OVERLAP" } as never);
      if (body.date === addDays(MONDAY, 3)) throw new ApiError("HTTP", "x", { status: 400, code: "SLOT_GENERATION_EMPTY" } as never);
      return slotsFor(body);
    };
    const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 6)), LOGIN);
    assert.deepEqual(statuses(result), ["SUCCESS", "SUCCESS", "CONFLICT", "FAILED", "SUCCESS", "SKIPPED", "SKIPPED"]);
    assert.ok(result.ok);
    assert.deepEqual(
      { success: result.summary.success, createdSlots: result.summary.createdSlots, conflict: result.summary.conflict, failed: result.summary.failed, skipped: result.summary.skipped },
      { success: 3, createdSlots: 9, conflict: 1, failed: 1, skipped: 2 },
    );
    assert.equal(result.stoppedReason, null);
  });

  it("부분 성공 뒤 같은 기간 재요청: 이미 슬롯이 있는 날짜는 서버 조회로 걸러 POST하지 않는다", async () => {
    gateway.slotDates.add(MONDAY);
    gateway.slotDates.add(addDays(MONDAY, 1));
    const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 2)), LOGIN);
    assert.deepEqual(statuses(result), ["CONFLICT", "CONFLICT", "SUCCESS"]);
    assert.deepEqual(postedDates(), [addDays(MONDAY, 2)]);
  });

  it("9. 중간 401·403이면 남은 날짜는 요청하지 않고 NOT_PROCESSED", async () => {
    for (const status of [401, 403]) {
      resetGateway();
      gateway.generate = (body) => {
        if (body.date === addDays(MONDAY, 1)) throw new ApiError("HTTP", "x", { status, code: status === 403 ? "FORBIDDEN" : undefined } as never);
        return slotsFor(body);
      };
      const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 4)), LOGIN);
      assert.deepEqual(statuses(result), ["SUCCESS", "FAILED", "NOT_PROCESSED", "NOT_PROCESSED", "NOT_PROCESSED"]);
      assert.equal(posts().length, 2);
      assert.ok(result.ok && result.stoppedReason);
    }
  });

  it("10. 타임아웃·네트워크: 그 날짜는 UNKNOWN, 같은 POST를 다시 보내지 않고 멈춘다", async () => {
    for (const kind of ["TIMEOUT", "NETWORK"] as const) {
      resetGateway();
      gateway.generate = (body) => {
        if (body.date === MONDAY) throw new ApiError(kind, "x");
        return slotsFor(body);
      };
      const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 2)), LOGIN);
      assert.deepEqual(statuses(result), ["UNKNOWN", "NOT_PROCESSED", "NOT_PROCESSED"]);
      assert.equal(posts().length, 1);
      assert.equal(result.ok && result.summary.unknown, 1);
    }
  });

  it("기존 슬롯 확인에 실패하면 아무 날짜도 POST하지 않는다", async () => {
    gateway.searchFails = true;
    const result = await server.submitSlotRangeGeneration(rangeInput(MONDAY, addDays(MONDAY, 2)), LOGIN);
    assert.equal(result.ok, false);
    assert.equal(posts().length, 0);
  });

  it("12·13·14. 잘못된 ID·다른 기관 장비·운영시간/소요 시간 미설정은 POST하지 않는다", async () => {
    const badId = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY, { equipmentId: "not-uuid" }), LOGIN);
    assert.equal(!badId.ok && badId.field, "equipmentId");
    const badExam = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY, { examTypeId: "x" }), LOGIN);
    assert.equal(!badExam.ok && badExam.field, "examTypeId");
    const other = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY, { equipmentId: OTHER_EQUIPMENT }), LOGIN);
    assert.equal(!other.ok && other.reason, "FORBIDDEN");
    gateway.hours = [];
    const noHours = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY), LOGIN);
    assert.match(!noHours.ok ? noHours.message : "", /운영시간/);
    resetGateway();
    gateway.durationMinutes = null;
    const noDuration = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY), LOGIN);
    assert.match(!noDuration.ok ? noDuration.message : "", /소요 시간/);
    assert.equal(posts().length, 0);
  });

  it("검사기관이 아닌 계정·장애 장비·운영일 없는 기간은 POST하지 않는다", async () => {
    gateway.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "x" };
    const forbidden = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY), LOGIN);
    assert.equal(!forbidden.ok && forbidden.reason, "FORBIDDEN");
    assert.deepEqual(gatewayDataCalls(), []);
    resetGateway();
    gateway.equipmentStatus = "FAILED";
    const failedEquipment = await server.submitSlotRangeGeneration(rangeInput(MONDAY, MONDAY), LOGIN);
    assert.equal(!failedEquipment.ok && failedEquipment.reason, "CONFLICT");
    resetGateway();
    const weekendOnly = await server.submitSlotRangeGeneration(rangeInput(addDays(MONDAY, 5), addDays(MONDAY, 6)), LOGIN);
    assert.match(!weekendOnly.ok ? weekendOnly.message : "", /운영하는 날이 없습니다/);
    assert.equal(posts().length, 0);
  });
});

describe("슬롯 생성: 로그인 세션 정합성 (STEP 3-2-2B-5)", () => {
  const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };
  const range = { equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, startDate: MONDAY, endDate: addDays(MONDAY, 4) };

  it("하루 생성: 다른 탭에서 계정이 바뀌면 SESSION_CHANGED, 장비·검사 유형·운영시간 확인과 생성 POST 0회", async () => {
    gateway.loginSession = "loginSessionTagB";
    assert.deepEqual(await server.submitSlotGeneration(input(), LOGIN), SESSION_CHANGED);
    assert.deepEqual(gatewayDataCalls(), [], "사전 조회도 하지 않음");
    assert.equal(posts().length, 0);
  });

  it("기간 생성: 다른 탭에서 계정이 바뀌면 SESSION_CHANGED, 사전 조회(장비·운영시간·기존 슬롯)와 날짜별 POST 0회", async () => {
    gateway.loginSession = "loginSessionTagB";
    assert.deepEqual(await server.submitSlotRangeGeneration(range, LOGIN), SESSION_CHANGED);
    assert.deepEqual(gatewayDataCalls(), []);
    assert.equal(posts().length, 0);
  });

  it("렌더링 세션 인자를 빠뜨리면(undefined) 두 경로 모두 거부한다", async () => {
    assert.equal(((await server.submitSlotGeneration(input())) as { reason: string }).reason, "SESSION_CHANGED");
    assert.equal(((await server.submitSlotRangeGeneration(range)) as { reason: string }).reason, "SESSION_CHANGED");
    assert.equal(posts().length, 0);
  });

  it("세션이 같으면 기존 흐름 그대로 (기간 생성: 운영일 5일 POST 5회)", async () => {
    const result = await server.submitSlotRangeGeneration(range, LOGIN);
    assert.equal(result.ok, true);
    assert.equal(posts().length, 5);
  });

  it("기존 인증·권한 실패는 그대로 구분 (SESSION_CHANGED로 덮지 않음)", async () => {
    gateway.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
    assert.equal(((await server.submitSlotRangeGeneration(range, LOGIN)) as { reason: string }).reason, "FORBIDDEN");
    gateway.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
    assert.equal(((await server.submitSlotGeneration(input(), LOGIN)) as { reason: string }).reason, "UNAUTHORIZED");
    gateway.access = { ok: false, reason: "SIGNED_OUT", message: "로그인" };
    assert.equal(((await server.submitSlotGeneration(input(), LOGIN)) as { reason: string }).reason, "SIGNED_OUT");
    assert.equal(posts().length, 0);
  });
});
