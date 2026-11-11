import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSlotSearchUrl,
  countApiSlotsByDate,
  createLatestGuard,
  fetchApiSlotSearch,
  filterApiSearchResults,
  getCriteriaSearchWindow,
  getMonthSearchWindow,
  parseSlotSearchResponse,
  SLOT_SEARCH_FAILURE_MESSAGES,
} from "@/features/slots/apiSearchClient";
import type { ApiExamSlot } from "@/features/slots/apiSlots";
import type { SlotSearchCriteria } from "@/features/slots/types";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function slot(overrides: Partial<ApiExamSlot> = {}): ApiExamSlot {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    organizationId: ORG_A,
    organizationName: "A 영상센터",
    equipmentId: "bbbbbbbb-0000-4000-8000-000000000001",
    equipmentName: "CT-1",
    examType: "CT",
    examTypeId: "cccccccc-0000-4000-8000-000000000001",
    examTypeName: "흉부 CT",
    status: "AVAILABLE",
    isAvailable: true,
    startsAt: "2026-11-10T09:00:00+09:00",
    endsAt: "2026-11-10T09:30:00+09:00",
    startAt: "2026-11-10T09:00",
    endAt: "2026-11-10T09:30",
    ...overrides,
  };
}

const CRITERIA: SlotSearchCriteria = { examType: "", date: "", organizationId: "", timeOfDay: "", availableOnly: false };
const WINDOW = { startDate: "2026-11-05", endDateExclusive: "2026-12-06" };

describe("검색 기간 (서울 날짜)", () => {
  it("날짜를 고르면 그 날짜 하루만 조회한다", () => {
    assert.deepEqual(getCriteriaSearchWindow("2026-11-20", "2026-11-05"), { startDate: "2026-11-20", endDateExclusive: "2026-11-21" });
  });

  it("날짜가 없으면 오늘부터 31일로 제한한다", () => {
    assert.deepEqual(getCriteriaSearchWindow("", "2026-11-05"), { startDate: "2026-11-05", endDateExclusive: "2026-12-06" });
  });

  it("월말·연말을 넘어가는 날짜도 서울 날짜로 계산한다", () => {
    assert.deepEqual(getCriteriaSearchWindow("2026-12-31", "2026-11-05"), { startDate: "2026-12-31", endDateExclusive: "2027-01-01" });
  });

  it("달력: 이번 달은 오늘부터, 다음 달은 1일부터 다음 달 1일까지 (31일 이하)", () => {
    assert.deepEqual(getMonthSearchWindow(2026, 11, "2026-11-05"), { startDate: "2026-11-05", endDateExclusive: "2026-12-01" });
    assert.deepEqual(getMonthSearchWindow(2026, 12, "2026-11-05"), { startDate: "2026-12-01", endDateExclusive: "2027-01-01" });
    assert.deepEqual(getMonthSearchWindow(2027, 2, "2026-11-05"), { startDate: "2027-02-01", endDateExclusive: "2027-03-01" });
  });

  it("달력: 다 지난 달은 조회하지 않는다", () => {
    assert.equal(getMonthSearchWindow(2026, 10, "2026-11-05"), null);
    // 이번 달 마지막 날이면 그날 하루만
    assert.deepEqual(getMonthSearchWindow(2026, 11, "2026-11-30"), { startDate: "2026-11-30", endDateExclusive: "2026-12-01" });
  });

  it("요청 URL에는 기간·검사기관·검사 종류만 들어간다 (사용자·역할·토큰 없음)", () => {
    const url = buildSlotSearchUrl({ ...WINDOW, institutionId: ORG_A, modality: "MRI" });
    const parsed = new URL(url, "http://localhost");
    assert.equal(parsed.pathname, "/referring/slots/search");
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ["endDateExclusive", "institutionId", "modality", "startDate"]);
    assert.equal(buildSlotSearchUrl(WINDOW).includes("institutionId"), false);
  });
});

describe("응답 해석", () => {
  const success = (slots: unknown[], window = WINDOW) => ({ ok: true, slots, window, requestCount: 5 });

  it("정상 응답: 슬롯·장비·검사 유형 UUID를 그대로 보존한다", () => {
    const original = slot();
    const result = parseSlotSearchResponse(200, success([original]), WINDOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.slots[0].id, original.id);
    assert.equal(result.slots[0].equipmentId, original.equipmentId);
    assert.equal(result.slots[0].examTypeId, original.examTypeId);
    assert.equal(result.requestCount, 5);
  });

  it("빈 목록은 성공(결과 없음)이다", () => {
    const result = parseSlotSearchResponse(200, success([]), WINDOW);
    assert.deepEqual(result.ok && result.slots, []);
  });

  it("형식이 다르거나, 요청 기간 밖 슬롯·AVAILABLE이 아닌 슬롯이 있으면 일부만 보여 주지 않고 PARSE", () => {
    const cases: unknown[] = [
      success([{ ...slot(), id: "not-uuid" }]),
      success([slot({ startAt: "2026-12-06T09:00" })]),
      success([{ ...slot(), status: "BOOKED" }]),
      success([slot()], { startDate: "2026-11-06", endDateExclusive: "2026-12-06" }),
      { ok: true, slots: "x", window: WINDOW, requestCount: 1 },
      "<!doctype html>",
      null,
    ];
    for (const body of cases) {
      const result = parseSlotSearchResponse(200, body, WINDOW);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, "PARSE");
    }
  });

  it("서버 실패 구분 → 화면 구분 (400·401·403·5xx·TIMEOUT·NETWORK·PARSE·조회 제한)", () => {
    const table: [number, string, string][] = [
      [400, "INVALID_INPUT", "INVALID_REQUEST"],
      [400, "INVALID_REQUEST", "INVALID_REQUEST"],
      [401, "SIGNED_OUT", "UNAUTHORIZED"],
      [401, "UNAUTHORIZED", "UNAUTHORIZED"],
      [403, "FORBIDDEN", "FORBIDDEN"],
      [502, "SERVER_ERROR", "SERVER_ERROR"],
      [409, "CONFLICT", "SERVER_ERROR"],
      [504, "TIMEOUT", "TIMEOUT"],
      [502, "NETWORK", "NETWORK"],
      [502, "INVALID_RESPONSE", "PARSE"],
      [502, "METADATA_MISSING", "PARSE"],
      [422, "TOO_MANY_RESULTS", "TOO_MANY_RESULTS"],
      [503, "NOT_AVAILABLE", "NOT_AVAILABLE"],
    ];
    for (const [status, serverReason, expected] of table) {
      const result = parseSlotSearchResponse(status, { ok: false, reason: serverReason, message: "서버 안내" }, WINDOW);
      assert.equal(!result.ok && result.reason, expected, `${status} ${serverReason}`);
    }
  });

  it("검색 조건 오류·조회 제한은 서버 안내를, 그 밖은 화면 문구를 쓴다 (서버 원문 노출 최소화)", () => {
    const invalid = parseSlotSearchResponse(400, { ok: false, reason: "INVALID_INPUT", message: "지난 날짜는 검색할 수 없습니다." }, WINDOW);
    assert.equal(!invalid.ok && invalid.message, "지난 날짜는 검색할 수 없습니다.");
    const server = parseSlotSearchResponse(502, { ok: false, reason: "SERVER_ERROR", message: "내부 오류 상세" }, WINDOW);
    assert.equal(!server.ok && server.message, SLOT_SEARCH_FAILURE_MESSAGES.SERVER_ERROR);
  });

  it("본문을 해석할 수 없으면 HTTP 상태로 구분한다", () => {
    assert.equal(parseSlotSearchResponse(401, null, WINDOW).ok === false && (parseSlotSearchResponse(401, null, WINDOW) as { reason: string }).reason, "UNAUTHORIZED");
    const byStatus = (status: number) => {
      const result = parseSlotSearchResponse(status, null, WINDOW);
      return result.ok ? "OK" : result.reason;
    };
    assert.equal(byStatus(403), "FORBIDDEN");
    assert.equal(byStatus(500), "SERVER_ERROR");
    assert.equal(byStatus(504), "TIMEOUT");
    assert.equal(byStatus(400), "INVALID_REQUEST");
  });
});

describe("fetchApiSlotSearch", () => {
  it("같은 출처·캐시 없음으로 GET하고, 인증 헤더를 직접 만들지 않는다", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return Response.json({ ok: true, slots: [slot()], window: WINDOW, requestCount: 4 });
    }) as unknown as typeof fetch;
    const result = await fetchApiSlotSearch(WINDOW, { fetchImpl });
    assert.equal(result.ok, true);
    assert.ok(captured);
    const { url, init } = captured as { url: string; init: RequestInit };
    assert.ok(url.startsWith("/referring/slots/search?"));
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    const headers = new Headers(init.headers);
    for (const name of ["authorization", "x-user-id", "x-institution-id", "x-role"]) assert.equal(headers.has(name), false);
  });

  it("연결 실패는 NETWORK", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const result = await fetchApiSlotSearch(WINDOW, { fetchImpl });
    assert.equal(!result.ok && result.reason, "NETWORK");
  });

  it("제한 시간을 넘기면 TIMEOUT", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const result = await fetchApiSlotSearch(WINDOW, { fetchImpl, timeoutMs: 20 });
    assert.equal(!result.ok && result.reason, "TIMEOUT");
  });

  it("호출한 쪽이 취소하면 ABORTED (화면은 안내하지 않는다)", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const pending = fetchApiSlotSearch(WINDOW, { fetchImpl, signal: controller.signal });
    controller.abort();
    const result = await pending;
    assert.equal(!result.ok && result.reason, "ABORTED");
  });

  it("HTML 오류 페이지처럼 JSON이 아닌 응답은 상태로 구분한다", async () => {
    const fetchImpl = (async () => new Response("<html>", { status: 500 })) as unknown as typeof fetch;
    const result = await fetchApiSlotSearch(WINDOW, { fetchImpl });
    assert.equal(!result.ok && result.reason, "SERVER_ERROR");
  });
});

describe("받은 결과 거르기·달력 수", () => {
  const am = slot({ id: "aaaaaaaa-0000-4000-8000-000000000001", startAt: "2026-11-10T11:59" });
  const pm = slot({ id: "aaaaaaaa-0000-4000-8000-000000000002", startAt: "2026-11-10T12:00" });
  const mri = slot({ id: "aaaaaaaa-0000-4000-8000-000000000003", startAt: "2026-11-11T09:00", examType: "MRI", organizationId: ORG_B });
  const past = slot({ id: "aaaaaaaa-0000-4000-8000-000000000004", startAt: "2026-11-05T08:00" });
  const all = [am, pm, mri, past];
  const NOW = "2026-11-05T10:00";

  it("시간대: 12:00 전은 오전, 12:00부터 오후", () => {
    assert.deepEqual(filterApiSearchResults(all, { ...CRITERIA, timeOfDay: "AM" }, NOW).map((s) => s.id), [am.id, mri.id]);
    assert.deepEqual(filterApiSearchResults(all, { ...CRITERIA, timeOfDay: "PM" }, NOW).map((s) => s.id), [pm.id]);
  });

  it("검사 종류·검사기관(UUID 대소문자 무시)·날짜 조건", () => {
    assert.deepEqual(filterApiSearchResults(all, { ...CRITERIA, examType: "MRI" }, NOW).map((s) => s.id), [mri.id]);
    assert.deepEqual(filterApiSearchResults(all, { ...CRITERIA, organizationId: ORG_B.toUpperCase() }, NOW).map((s) => s.id), [mri.id]);
    assert.deepEqual(filterApiSearchResults(all, { ...CRITERIA, date: "2026-11-10" }, NOW).map((s) => s.id), [am.id, pm.id]);
  });

  it("이미 시작한 슬롯은 보이지 않는다", () => {
    assert.equal(filterApiSearchResults(all, CRITERIA, NOW).some((s) => s.id === past.id), false);
  });

  it("달력 수: 조건에 맞는 예약 가능 슬롯만 날짜별로 센다 (없는 날짜 = 예약 가능한 슬롯 없음)", () => {
    assert.deepEqual(countApiSlotsByDate(all, CRITERIA, NOW), { "2026-11-10": 2, "2026-11-11": 1 });
    assert.deepEqual(countApiSlotsByDate(all, { ...CRITERIA, timeOfDay: "PM" }, NOW), { "2026-11-10": 1 });
    assert.deepEqual(countApiSlotsByDate(all, { ...CRITERIA, examType: "MRI", timeOfDay: "PM" }, NOW), {});
  });
});

describe("오래된 응답 무시 (createLatestGuard)", () => {
  it("새 요청을 시작하면 이전 요청은 취소되고 결과를 반영하지 않는다", async () => {
    const guard = createLatestGuard();
    const applied: string[] = [];
    const run = async (label: string, delay: number) => {
      const { signal, isLatest } = guard.start();
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (isLatest()) applied.push(label);
      return signal.aborted;
    };
    const first = run("첫 검색(느림)", 30);
    const second = run("두 번째 검색(빠름)", 5);
    const [firstAborted, secondAborted] = await Promise.all([first, second]);
    assert.deepEqual(applied, ["두 번째 검색(빠름)"]);
    assert.equal(firstAborted, true);
    assert.equal(secondAborted, false);
  });

  it("초기화(cancel) 뒤 도착한 응답은 반영하지 않는다", () => {
    const guard = createLatestGuard();
    const { signal, isLatest } = guard.start();
    guard.cancel();
    assert.equal(isLatest(), false);
    assert.equal(signal.aborted, true);
  });
});
