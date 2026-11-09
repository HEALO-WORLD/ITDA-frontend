import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ApiError } from "@/lib/api/errors";

/**
 * 확정 예약 관리(검사기관, API 모드) '오늘 검사 예정' 집계. 실제 네트워크 요청 없음.
 * - users/me(requireRoleAccess)·Gateway 요청(apiRequestData)만 가짜로 바꾸고 server.ts·referrals/remote.ts(조건 검증·응답 검증)는 실제 코드를 쓴다
 * - 화면(ExaminingReservationsSection)은 실제 로더로 그린다: 목록 요청과 집계 요청을 경로가 아닌 쿼리로 구분한다
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const EQUIPMENT = "55555555-5555-4555-8555-555555555555";
const TOKEN_HEADERS = { Authorization: "Bearer secret-test-token" };
/** 2026-11-09 KST 정오 (UTC 03:00) */
const NOON_KST = new Date("2026-11-09T03:00:00Z");

type Access =
  | { ok: true; headers: HeadersInit; user: { userId: string; institutionId: string } }
  | { ok: false; reason: "SIGNED_OUT" | "UNAUTHORIZED" | "UNVERIFIED" | "FORBIDDEN_ROLE"; message: string };
type Call = { path: string; query?: Record<string, unknown>; headers?: HeadersInit };

const okAccess: Access = { ok: true, headers: TOKEN_HEADERS, user: { userId: USER, institutionId: ORG } };
const reservation = (n: number, status: string, startTime: string) => ({
  id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
  referralId: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`,
  slotId: `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`,
  examInstitutionId: ORG,
  equipmentId: EQUIPMENT,
  attemptNo: 1,
  reservationStatus: status,
  failureReason: status === "FAILED" ? "HOLD_EXPIRED" : status === "BLOCKED" ? "EQUIPMENT_FAILURE" : null,
  examDate: startTime,
  startTime,
  endTime: startTime.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, "0")}`),
  confirmedAt: status === "CONFIRMED" ? "2026-11-01T10:00:00" : null,
  endedAt: null,
  createdAt: "2026-11-01T09:00:00",
  updatedAt: "2026-11-01T10:00:00",
});
const page = (contents: unknown[], totalElements: number, number = 0, size = 10) => ({ contents, totalElements, totalPages: Math.ceil(totalElements / size), size, number });

/**
 * 가짜 백엔드: 예약 목록 API의 실제 검색 의미(상태·검사일 양끝 포함·기관 범위)대로 거르고 totalElements는 전체 일치 건수
 * (ReservationRepositoryCustomImpl.search와 같다: 행은 page·size만큼, 건수는 같은 조건으로 따로 센다)
 */
let rows: ReturnType<typeof reservation>[] = [];
function backend(query: Record<string, unknown> = {}) {
  const matched = rows.filter(
    (row) =>
      (!query.status || row.reservationStatus === query.status) &&
      (!query.equipmentId || row.equipmentId === query.equipmentId) &&
      (!query.examDateFrom || row.examDate >= String(query.examDateFrom)) &&
      (!query.examDateTo || row.examDate <= String(query.examDateTo)),
  );
  const size = Number(query.size ?? 10);
  const number = Number(query.page ?? 0);
  return page(matched.slice(number * size, number * size + size), matched.length, number, size);
}

const state = {
  access: okAccess as Access,
  countError: null as unknown,
  listError: null as unknown,
  calls: [] as Call[],
  /** connection() 호출 순서 기록 (현재 시각을 읽기 전에 요청 시점을 기다리는지) */
  connections: 0,
};
const isCountCall = (call: Call) => call.query?.status === "CONFIRMED" && typeof call.query.examDateFrom === "string" && call.query.examDateFrom === call.query.examDateTo?.toString().replace("23:59:59", "00:00:00");
const countCalls = () => state.calls.filter(isCountCall);

let server: typeof import("@/features/reservations/server");
let Section: typeof import("@/features/reservations/components/ExaminingReservationsSection").default;
const originalConsoleError = console.error;

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => state.access,
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { query?: Record<string, unknown>; headers?: HeadersInit } = {}) => {
        const call: Call = { path, query: options.query, headers: options.headers };
        state.calls.push(call);
        if (path === "/api/v1/referrals/reservations") {
          if (isCountCall(call) && state.countError) throw state.countError;
          if (!isCountCall(call) && state.listError) throw state.listError;
          return backend(options.query);
        }
        if (path.startsWith("/api/v1/institutions/")) return page([], 0, 0, 100);
        throw new Error(`unexpected request ${path}`);
      },
    },
  });
  const realServer = await import("next/server");
  mock.module("next/server", {
    namedExports: {
      ...realServer,
      connection: async () => {
        state.connections++;
      },
    },
  });
  mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
      usePathname: () => "/examining/reservations",
      useSearchParams: () => new URLSearchParams(),
      unstable_rethrow: () => {},
    },
  });
  server = await import("@/features/reservations/server");
  Section = (await import("@/features/reservations/components/ExaminingReservationsSection")).default;
});

beforeEach(() => {
  state.access = okAccess;
  state.countError = null;
  state.listError = null;
  state.calls = [];
  state.connections = 0;
  rows = [];
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "reservations,referrals";
  console.error = () => {};
});

afterEach(() => {
  console.error = originalConsoleError;
});

describe("loadTodayConfirmedReservationCount: 조건과 건수", () => {
  it("기존 목록 API에 오늘(KST)·CONFIRMED 조건만 넣어 1회 요청하고, 기관 ID·목록 검색 조건은 보내지 않는다", async () => {
    await server.loadTodayConfirmedReservationCount(NOON_KST);
    assert.deepEqual(state.calls, [
      {
        path: "/api/v1/referrals/reservations",
        query: { status: "CONFIRMED", examDateFrom: "2026-11-09T00:00:00", examDateTo: "2026-11-09T23:59:59", page: 0, size: 10 },
        headers: TOKEN_HEADERS,
      },
    ]);
  });

  it("오늘 CONFIRMED만 센다: REQUESTED·HELD·FAILED·BLOCKED·CANCELED와 다른 날짜는 제외", async () => {
    rows = [
      reservation(1, "CONFIRMED", "2026-11-09T09:00:00"),
      reservation(2, "CONFIRMED", "2026-11-09T23:30:00"),
      reservation(3, "FAILED", "2026-11-09T10:00:00"),
      reservation(4, "BLOCKED", "2026-11-09T11:00:00"),
      reservation(5, "REQUESTED", "2026-11-09T12:00:00"),
      reservation(6, "HELD", "2026-11-09T13:00:00"),
      reservation(7, "CANCELED", "2026-11-09T14:00:00"),
      reservation(8, "CONFIRMED", "2026-11-08T23:59:00"),
      reservation(9, "CONFIRMED", "2026-11-10T00:00:00"),
    ];
    assert.deepEqual(await server.loadTodayConfirmedReservationCount(NOON_KST), { ok: true, count: 2, date: "2026-11-09" });
  });

  it("10건을 넘어도 받은 행(최대 10)이 아니라 totalElements로 센다", async () => {
    rows = Array.from({ length: 23 }, (_, i) => reservation(i + 1, "CONFIRMED", `2026-11-09T${String(8 + (i % 10)).padStart(2, "0")}:${String(i).padStart(2, "0")}:00`));
    const result = await server.loadTodayConfirmedReservationCount(NOON_KST);
    assert.deepEqual(result, { ok: true, count: 23, date: "2026-11-09" });
  });

  it("오늘은 Asia/Seoul 기준이다 (UTC 14:59:59 = KST 23:59:59 → 그날, UTC 15:00 = KST 다음 날 00:00)", async () => {
    await server.loadTodayConfirmedReservationCount(new Date("2026-11-09T14:59:59Z"));
    await server.loadTodayConfirmedReservationCount(new Date("2026-11-09T15:00:00Z"));
    await server.loadTodayConfirmedReservationCount(new Date("2026-11-08T15:00:00Z"));
    assert.deepEqual(
      state.calls.map((call) => [call.query?.examDateFrom, call.query?.examDateTo]),
      [
        ["2026-11-09T00:00:00", "2026-11-09T23:59:59"],
        ["2026-11-10T00:00:00", "2026-11-10T23:59:59"],
        ["2026-11-09T00:00:00", "2026-11-09T23:59:59"],
      ],
    );
  });

  it("현재 시각은 권한 확인 후 connection()을 기다린 뒤 읽는다 (프리렌더 중 new Date() 금지), 권한이 없으면 기다리지 않는다", async () => {
    await server.loadTodayConfirmedReservationCount();
    assert.equal(state.connections, 1);
    const source = (await import("node:fs")).readFileSync(new URL("../../src/features/reservations/server.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("export async function loadTodayConfirmedReservationCount"));
    assert.ok(body.indexOf("await connection()") < body.indexOf("new Date()"), "connection() 다음에 현재 시각");
    assert.doesNotMatch(source, /loadTodayConfirmedReservationCount\([^)]*=\s*new Date\(\)/, "기본값 new Date() 없음");
    state.access = { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
    await server.loadTodayConfirmedReservationCount();
    assert.equal(state.connections, 1);
  });

  it("실제 0건은 성공 0건이다", async () => {
    rows = [reservation(1, "FAILED", "2026-11-09T09:00:00")];
    assert.deepEqual(await server.loadTodayConfirmedReservationCount(NOON_KST), { ok: true, count: 0, date: "2026-11-09" });
  });
});

describe("loadTodayConfirmedReservationCount: 권한·실패 (0건으로 바꾸지 않는다)", () => {
  it("로그인하지 않았거나 검사기관이 아니면 요청하지 않고 실패", async () => {
    for (const access of [
      { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." },
      { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" },
    ] as const) {
      state.access = access;
      const result = await server.loadTodayConfirmedReservationCount(NOON_KST);
      assert.equal(result.ok, false);
    }
    assert.equal(state.calls.length, 0);
  });

  it("401·403·500·네트워크·응답 형식 오류는 실패 결과 (count 없음)", async () => {
    for (const [error, reason] of [
      [new ApiError("HTTP", "x", { status: 401 }), "UNAUTHORIZED"],
      [new ApiError("HTTP", "x", { status: 403 }), "FORBIDDEN"],
      [new ApiError("HTTP", "x", { status: 500 }), "ERROR"],
      [new ApiError("NETWORK", "x"), "NETWORK"],
      [new ApiError("TIMEOUT", "x"), "NETWORK"],
      [new ApiError("PARSE", "x"), "ERROR"],
    ] as const) {
      state.countError = error;
      const result = await server.loadTodayConfirmedReservationCount(NOON_KST);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, reason);
      assert.equal("count" in result, false);
    }
  });
});

describe("화면: 오늘 검사 예정", () => {
  const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Section({ searchParams: Promise.resolve(params) }));
  const summaryOf = (html: string) => html.slice(html.indexOf('aria-label="오늘 검사 예정 요약"'), html.indexOf('aria-labelledby="exam-resv-list-title"'));
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const seedToday = () => {
    const d = today();
    rows = [
      ...Array.from({ length: 12 }, (_, i) => reservation(i + 1, "CONFIRMED", `${d}T${String(8 + (i % 10)).padStart(2, "0")}:00:00`)),
      reservation(50, "FAILED", `${d}T09:00:00`),
      reservation(51, "BLOCKED", `${d}T10:00:00`),
      reservation(52, "CONFIRMED", "2000-01-01T09:00:00"),
    ];
  };

  it("'오늘 검사 예정 N건' 하나만 보이고 기존 5개 항목(오늘 예약·확정·처리 중·재조정 필요·취소)은 없다", async () => {
    seedToday();
    const summary = summaryOf(await render());
    assert.match(summary, /오늘 검사 예정/);
    assert.match(summary, />12건</);
    assert.match(summary, new RegExp(`${today()} · 검사기관 전체 확정 예약 기준`));
    for (const removed of ["오늘 예약", "처리 중", "재조정 필요", "취소", "현재 페이지 기준"]) assert.equal(summary.includes(removed), false, removed);
  });

  it("페이지·장비·상태·기간 조건을 바꿔도 집계는 같고, 집계 요청은 목록 조건을 받지 않는다", async () => {
    seedToday();
    const base = summaryOf(await render());
    const variants: Record<string, string>[] = [{ page: "2" }, { equipmentId: EQUIPMENT }, { status: "FAILED" }, { status: "CANCELED", size: "30" }, { examDateFrom: "2000-01-01", examDateTo: "2000-01-01" }];
    for (const params of variants) {
      state.calls = [];
      assert.equal(summaryOf(await render(params)), base, JSON.stringify(params));
      const count = countCalls();
      assert.equal(count.length, 1);
      assert.deepEqual(Object.keys(count[0].query ?? {}).sort(), ["examDateFrom", "examDateTo", "page", "size", "status"]);
    }
  });

  it("목록은 기존대로 화면 조건으로 조회한다 (상태 필터·페이지·건수)", async () => {
    seedToday();
    const html = await render({ status: "FAILED" });
    const list = state.calls.find((call) => call.path === "/api/v1/referrals/reservations" && !isCountCall(call));
    assert.deepEqual(list?.query, { status: "FAILED", page: 0, size: 10, sort: "createdAt,desc" });
    assert.match(html, /총 <span[^>]*>1<\/span>건의 예약/);
  });

  it("집계만 실패하면 0건이 아니라 '집계 확인 불가'를 보이고 목록은 그대로 보인다", async () => {
    seedToday();
    state.countError = new ApiError("HTTP", "x", { status: 500 });
    const html = await render();
    const summary = summaryOf(html);
    assert.match(summary, /집계 확인 불가/);
    assert.doesNotMatch(summary, /\d+건/);
    assert.match(summary, /예약 목록은 그대로 확인할 수 있습니다/);
    assert.match(html, /예약 목록/);
    assert.match(html, /총 <span[^>]*>15<\/span>건의 예약/);
  });

  it("실제 0건은 '0건'으로 보인다 ('집계 확인 불가'가 아니다)", async () => {
    rows = [reservation(1, "FAILED", `${today()}T09:00:00`)];
    const summary = summaryOf(await render());
    assert.match(summary, />0건</);
    assert.doesNotMatch(summary, /집계 확인 불가/);
  });

  it("목록이 실패하면(권한 오류 등) 기존 실패 안내 하나만 보이고 집계 영역은 없다", async () => {
    state.listError = new ApiError("HTTP", "x", { status: 403 });
    const html = await render();
    assert.equal(html.includes("오늘 검사 예정"), false);
    assert.match(html, /검사기관 담당자만 조회할 수 있습니다/);
  });
});
