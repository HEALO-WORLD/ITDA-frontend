import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

import { addDays, getSeoulNow } from "@/lib/date/seoulDate";

/**
 * loadApiSlotSearch: 인증·인가를 Gateway 데이터 요청 전에 하는지, 기관 범위를 서버가 정하는지 확인한다.
 * users/me(requireRoleAccess)와 Gateway 요청(apiRequestData·목록 remote)은 가짜로 바꾼다 (실제 네트워크 없음).
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_OTHER = "99999999-9999-4999-8999-999999999999";
const EQUIPMENT = "bbbbbbbb-0000-4000-8000-000000000001";
const EXAM_TYPE = "cccccccc-0000-4000-8000-000000000001";

type Access = { ok: true; headers: HeadersInit; user: unknown } | { ok: false; reason: string; message: string };

const state = {
  access: { ok: true, headers: { Authorization: "Bearer test" }, user: {} } as Access,
  gatewayCalls: [] as string[],
  slotQueries: [] as Record<string, unknown>[],
};

const page = <T>(contents: T[]) => ({ contents, totalElements: contents.length, totalPages: 1, size: 100, number: 0 });

let loadApiSlotSearch: typeof import("@/features/slots/server").loadApiSlotSearch;

before(async () => {

  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        state.gatewayCalls.push(`users/me:${role}`);
        return state.access;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/features/partnerships/remote", {
    namedExports: {
      fetchMyPartnershipList: async (query: unknown) => {
        state.gatewayCalls.push(`partnerships:${JSON.stringify(query)}`);
        return [
          { partnershipId: "p1", partnerInstitutionId: ORG_A, partnerInstitutionName: "A 영상센터", partnerInstitutionType: "EXAM", status: "ACTIVE", requestedAt: "", approvedAt: null, terminatedAt: null },
        ];
      },
    },
  });
  mock.module("@/features/equipment/remote", {
    namedExports: {
      EQUIPMENT_PAGE_MAX_SIZE: 100,
      fetchEquipmentPage: async (institutionId: string) => {
        state.gatewayCalls.push(`equipments:${institutionId}`);
        // 장비 상태는 EquipmentStatusDto (OPERATIONAL·MAINTENANCE·FAILED)
        return page([{ id: EQUIPMENT, institutionId, name: "CT-1", modality: "CT", status: "OPERATIONAL" }]);
      },
      // server.ts가 import하는 장비별 지원 검사 유형 조회 (검색 선택지용). loadApiSlotSearch는 부르지 않아야 한다
      fetchEquipmentExamTypePage: async (equipmentId: string) => {
        state.gatewayCalls.push(`equipment-exam-types:${equipmentId}`);
        return page([]);
      },
    },
  });
  mock.module("@/features/referrals/remote", {
    namedExports: {
      EXAM_TYPE_MAX_PAGE_SIZE: 100,
      fetchExamTypePage: async () => {
        state.gatewayCalls.push("exam-types");
        return page([{ id: EXAM_TYPE, name: "흉부 CT", modality: "CT" }]);
      },
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { query: Record<string, unknown> }) => {
        state.gatewayCalls.push(`slots:${path}`);
        state.slotQueries.push(options.query);
        const from = String(options.query.from).slice(0, 10);
        return {
          items: [
            { id: "aaaaaaaa-0000-4000-8000-000000000001", equipmentId: EQUIPMENT, examTypeId: EXAM_TYPE, startsAt: `${from}T09:00:00+09:00`, endsAt: `${from}T09:30:00+09:00`, status: "AVAILABLE" },
          ],
          page: options.query.page,
          size: options.query.size,
          hasNext: false,
        };
      },
    },
  });
  ({ loadApiSlotSearch } = await import("@/features/slots/server"));
});

after(() => mock.reset());

beforeEach(() => {
  state.access = { ok: true, headers: { Authorization: "Bearer test" }, user: {} };
  state.gatewayCalls = [];
  state.slotQueries = [];
});

const today = getSeoulNow().dateKey;
const tomorrow = addDays(today, 1);
const input = (overrides: Record<string, unknown> = {}) => ({ startDate: tomorrow, endDateExclusive: addDays(tomorrow, 1), ...overrides });

describe("loadApiSlotSearch 인증·인가", () => {
  it("로그인하지 않았으면 Gateway 데이터 요청 없이 SIGNED_OUT", async () => {
    state.access = { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
    const result = await loadApiSlotSearch(input());
    assert.equal(!result.ok && result.reason, "SIGNED_OUT");
    assert.deepEqual(state.gatewayCalls, ["users/me:REFERRING"]);
  });

  it("토큰 만료(users/me 401)면 데이터 요청 없이 UNAUTHORIZED", async () => {
    state.access = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
    const result = await loadApiSlotSearch(input());
    assert.equal(!result.ok && result.reason, "UNAUTHORIZED");
    assert.deepEqual(state.gatewayCalls, ["users/me:REFERRING"]);
  });

  it("검사기관(EXAMINER)·관리자 계정이면 데이터 요청 없이 FORBIDDEN", async () => {
    state.access = { ok: false, reason: "FORBIDDEN_ROLE", message: "권한 없음" };
    const result = await loadApiSlotSearch(input());
    assert.equal(!result.ok && result.reason, "FORBIDDEN");
    assert.deepEqual(state.gatewayCalls, ["users/me:REFERRING"]);
  });

  it("검색 기간 검사는 인증 뒤에 하고, 지난 날짜·1년 넘는 미래·31일 초과는 요청하지 않는다", async () => {
    for (const bad of [
      input({ startDate: addDays(today, -3), endDateExclusive: addDays(today, -2) }),
      input({ startDate: addDays(today, 400), endDateExclusive: addDays(today, 401) }),
      input({ startDate: tomorrow, endDateExclusive: addDays(tomorrow, 32) }),
      input({ startDate: "2026-13-01", endDateExclusive: "2026-13-02" }),
    ]) {
      state.gatewayCalls = [];
      const result = await loadApiSlotSearch(bad as never);
      assert.equal(!result.ok && result.reason, "INVALID_INPUT");
      assert.deepEqual(state.gatewayCalls, ["users/me:REFERRING"]);
    }
  });

  it("협약 기관이 아닌 검사기관 UUID는 슬롯을 조회하지 않고 거부한다 (타 기관 데이터 격리)", async () => {
    const result = await loadApiSlotSearch(input({ institutionId: ORG_OTHER }));
    assert.equal(!result.ok && result.reason, "INVALID_INPUT");
    assert.equal(state.gatewayCalls.some((call) => call.startsWith("slots:") || call.startsWith("equipments:")), false);
  });

  it("정상: ACTIVE 협약만 조회하고, 슬롯 검색은 view=SEARCH·서울 오프셋·요청 기간으로 한 번 보낸다", async () => {
    const result = await loadApiSlotSearch(input({ institutionId: ORG_A, modality: "CT" }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(state.gatewayCalls[0], "users/me:REFERRING");
    assert.ok(state.gatewayCalls.includes('partnerships:{"status":"ACTIVE"}'));
    assert.equal(state.slotQueries.length, 1);
    assert.equal(state.slotQueries[0].view, "SEARCH");
    assert.equal(state.slotQueries[0].from, `${tomorrow}T00:00:00+09:00`);
    assert.equal(state.slotQueries[0].to, `${addDays(tomorrow, 1)}T00:00:00+09:00`);
    assert.equal(state.slotQueries[0].institutionId, ORG_A);
    assert.equal(result.slots[0].equipmentId, EQUIPMENT);
    assert.equal(result.slots[0].examTypeId, EXAM_TYPE);
    // 요청 수: 협약 1 + 검사 유형 1 + 장비 1 + 슬롯 1
    assert.equal(result.requestCount, 4);
    // 검색 자체는 장비별 지원 검사 유형을 다시 조회하지 않는다 (선택지 조회는 loadApiSlotSearchOrganizations)
    assert.equal(state.gatewayCalls.some((call) => call.startsWith("equipment-exam-types:")), false);
  });

});
