import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

/**
 * 검사기관 장비 장애 화면(API 모드)의 현황 집계 연결 (IncidentApiSection + IncidentApiSummary). 실제 네트워크 요청 없음.
 * server.ts의 세 로더만 가짜로 바꿔 화면(Server Component)을 그대로 그린다. 로더 자체는 summaryLoader.test.ts에서 확인한다.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const EQUIPMENT = "55555555-5555-4555-8555-555555555555";
const INCIDENT = "77777777-7777-4777-8777-777777777777";

type Failure = { ok: false; reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NETWORK" | "ERROR"; message: string; code: string | null };

const incident = {
  incidentId: INCIDENT,
  equipmentId: EQUIPMENT,
  institutionId: ORG,
  reason: "장비 점검",
  status: "OCCURRED",
  occurredAt: "2026-11-09T09:00:00",
  startAt: "2026-11-09T09:00:00",
  endAt: "2026-11-09T18:00:00",
  createdAt: "2026-11-09T09:01:00",
};
const okList = (overrides: Record<string, unknown> = {}) => ({ ok: true, items: [incident], totalElements: 37, totalPages: 4, page: 0, ...overrides });
const okSummary = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  summary: {
    institutionId: ORG,
    asOf: "2026-11-09T10:30:20.123456",
    activeDowntimeEquipmentCount: 2,
    affectedReferralCount: 15,
    needsRescheduleReferralCount: 3,
    ...overrides,
  },
});

const state = {
  list: okList() as unknown,
  summary: okSummary() as unknown,
  listCalls: [] as unknown[][],
  summaryCalls: [] as unknown[][],
};

let Section: typeof import("@/features/incidents/components/IncidentApiSection").default;

before(async () => {
  mock.module("@/features/incidents/server", {
    namedExports: {
      INCIDENT_API_PAGE_SIZE: 10,
      loadIncidentPage: async (...args: unknown[]) => {
        state.listCalls.push(args);
        return state.list;
      },
      loadIncidentEquipmentLookup: async () => ({ [EQUIPMENT]: { name: "MRI-1", modality: "MRI" } }),
      loadIncidentSummary: async (...args: unknown[]) => {
        state.summaryCalls.push(args);
        return state.summary;
      },
      loadIncidentDetail: async () => ({ ok: false, reason: "ERROR", message: "x", code: null }),
      loadIncidentReferralPage: async () => ({ ok: false, reason: "ERROR", message: "x", code: null }),
    },
  });
  mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
      usePathname: () => "/examining/incidents",
      useSearchParams: () => new URLSearchParams(),
      unstable_rethrow: () => {},
    },
  });
  Section = (await import("@/features/incidents/components/IncidentApiSection")).default;
});

beforeEach(() => {
  state.list = okList();
  state.summary = okSummary();
  state.listCalls = [];
  state.summaryCalls = [];
});

const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Section({ searchParams: Promise.resolve(params) }));
/** 현황 영역 HTML만 (목록과 섞이지 않게) */
const summaryHtml = (html: string) => {
  const start = html.indexOf('aria-labelledby="incident-summary-title"');
  return html.slice(start, html.indexOf('aria-labelledby="incident-api-list-title"'));
};
/** 라벨 칸 다음 값 (dt → dd) */
const valueOf = (html: string, label: string) => {
  const at = html.indexOf(`${label}`);
  const dd = html.indexOf("<dd", at);
  return html.slice(dd, html.indexOf("</dd>", dd)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

describe("현황 집계 표시 (성공)", () => {
  it("세 수치를 각 카드에 기준 문구와 함께 표시한다", async () => {
    const html = summaryHtml(await render());
    assert.equal(valueOf(html, "현재 중단 장비"), "2대 등록된 중단 시간 기준");
    assert.equal(valueOf(html, "누적 영향 의뢰"), "15건 누적 기준");
    assert.equal(valueOf(html, "재조정 필요 의뢰"), "3건 현재 상태 기준");
    assert.match(html, /검사기관 전체 기준/);
  });

  it("재조정 필요가 있으면 색과 함께 '조치 필요' 글자로 구분하고, 0건이면 붙이지 않는다", async () => {
    assert.match(summaryHtml(await render()), /조치 필요/);
    state.summary = okSummary({ needsRescheduleReferralCount: 0 });
    assert.doesNotMatch(summaryHtml(await render()), /조치 필요/);
  });

  it("모든 수치가 0이어도 숫자 0으로 표시한다 ('확인 불가'가 아니다)", async () => {
    state.summary = okSummary({ activeDowntimeEquipmentCount: 0, affectedReferralCount: 0, needsRescheduleReferralCount: 0 });
    const html = summaryHtml(await render());
    assert.equal(valueOf(html, "현재 중단 장비"), "0대 등록된 중단 시간 기준");
    assert.equal(valueOf(html, "누적 영향 의뢰"), "0건 누적 기준");
    assert.equal(valueOf(html, "재조정 필요 의뢰"), "0건 현재 상태 기준");
    assert.doesNotMatch(html, /확인 불가/);
  });

  it("기준 시각은 서버 문자열을 시간대 변환 없이 표시한다 (원본은 dateTime·title에 그대로)", async () => {
    const html = summaryHtml(await render());
    assert.match(html, /<time dateTime="2026-11-09T10:30:20.123456" title="2026-11-09T10:30:20.123456"[^>]*>2026-11-09 10:30:20<\/time>/);
    for (const [asOf, shown] of [
      ["2026-11-09T23:59:59", "2026-11-09 23:59:59"],
      ["2026-11-09T00:05", "2026-11-09 00:05"],
      ["2026-12-31T23:59:59.999999999", "2026-12-31 23:59:59"],
    ]) {
      state.summary = okSummary({ asOf });
      assert.match(summaryHtml(await render()), new RegExp(`>${shown}</time>`), asOf);
    }
  });

  it("복구 완료 건수 칸·이전 준비 중 안내를 두지 않는다 (추론하지 않는다)", async () => {
    const html = await render();
    for (const absent of ["복구 완료", "조회 준비 중", "상세에서 확인", "집계 API가 서버에 아직 없어"]) assert.equal(html.includes(absent), false, absent);
  });
});

describe("현황 집계 실패", () => {
  it("집계만 실패하면 세 수치는 '확인 불가'(0 아님), 짧은 안내를 보이고 장애 목록은 그대로 보인다", async () => {
    state.summary = { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다.", code: null } satisfies Failure;
    const html = await render();
    const summary = summaryHtml(html);
    assert.equal(summary.match(/확인 불가/g)?.length, 3);
    assert.doesNotMatch(summary, /\d+(대|건)/, "숫자를 보이지 않는다");
    assert.match(summary, /장비 장애 현황을 불러오지 못해 집계를 표시하지 않습니다/);
    assert.doesNotMatch(summary, /기준 시각/);
    // 목록은 정상 (건수·행·페이지)
    assert.match(html, /장비 장애 목록/);
    assert.match(html, /37건/);
    assert.match(html, /MRI-1/);
    assert.match(html, /장애 목록 페이지/);
  });

  it("집계 실패 안내에 서버 내부 메시지를 그대로 보이지 않는다", async () => {
    state.summary = { ok: false, reason: "ERROR", message: "INTERNAL stack trace", code: "SOMETHING" } satisfies Failure;
    assert.equal((await render()).includes("INTERNAL stack trace"), false);
  });

  it("목록이 실패하면(로그인·권한 오류 포함) 목록 실패 안내 하나만 보이고 집계 영역은 그리지 않는다", async () => {
    for (const [reason, message] of [
      ["SIGNED_OUT", "로그인이 필요합니다."],
      ["UNAUTHORIZED", "만료"],
      ["FORBIDDEN", "권한 없음"],
    ] as const) {
      const failure: Failure = { ok: false, reason, message, code: null };
      state.list = failure;
      state.summary = failure;
      const html = await render();
      assert.equal(html.includes("incident-summary-title"), false, reason);
      assert.equal((html.match(/role="(alert|status)"/g) ?? []).length, 1, `${reason}: 안내는 하나`);
    }
  });

  it("목록 실패 + 집계 성공이어도 기존 목록 실패 안내를 유지한다", async () => {
    state.list = { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다.", code: null } satisfies Failure;
    const html = await render();
    assert.match(html, /장비 장애 정보를 불러오지 못했습니다/);
    assert.equal(html.includes("incident-summary-title"), false);
  });
});

describe("집계는 목록 필터·페이지와 독립", () => {
  it("장비 필터·페이지는 목록 로더에만 넘기고 집계 로더는 인자 없이 한 번 부른다", async () => {
    await render({ page: "3", equipmentId: EQUIPMENT });
    assert.deepEqual(state.listCalls, [[2, EQUIPMENT]]);
    assert.deepEqual(state.summaryCalls, [[]]);
  });

  it("필터·페이지를 바꿔도 집계 수치는 같고, 목록 건수(totalElements)로 대신하지 않는다", async () => {
    const all = summaryHtml(await render());
    state.list = okList({ totalElements: 1, totalPages: 1, page: 0 });
    const filtered = summaryHtml(await render({ equipmentId: EQUIPMENT, page: "1" }));
    assert.equal(filtered, all);
    assert.equal(all.includes("37건"), false);
  });

  it("기존 장비 필터·페이지 이동은 그대로다 (필터 안내·필터 해제·페이지 링크에 장비 조건 유지)", async () => {
    state.list = okList({ page: 1 });
    const html = await render({ page: "2", equipmentId: EQUIPMENT });
    assert.match(html, new RegExp(`장비 <code[^>]*>${EQUIPMENT}</code>의 장애만 표시합니다`));
    assert.match(html, /장비 필터 해제/);
    assert.match(html, new RegExp(`href="[^"]*equipmentId=${EQUIPMENT}[^"]*page=|href="[^"]*page=[^"]*equipmentId=${EQUIPMENT}`));
  });
});
