import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { addDays, getSeoulNow } from "@/lib/date/seoulDate";

/**
 * 세부 검사 항목(ExamType) 필터 — 일반 슬롯 검색·재조정 대화상자 공통.
 * 선택지(장비별 지원 검사 유형 → examTypeId 중복 제거) → 검색 URL·Route → 서버 loader(Gateway examTypeId) → 결과·달력 → Mock.
 * 물리 장비(equipmentId)는 사용자 필터에서 빠지고 슬롯 데이터(예약 요청 DTO)에는 그대로 남는다. 실제 네트워크 없음.
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ORG_X = "99999999-9999-4999-8999-999999999999";
const MRI_A1 = "a0000000-0000-4000-8000-0000000000a1";
const MRI_A2 = "a0000000-0000-4000-8000-0000000000a2";
const CT_A = "a0000000-0000-4000-8000-0000000000c1";
const MRI_B = "b0000000-0000-4000-8000-0000000000b1";
const MRI_B_DOWN = "b0000000-0000-4000-8000-0000000000b2";
const BRAIN_MRI = "e0000000-0000-4000-8000-000000000001";
const SPINE_MRI = "e0000000-0000-4000-8000-000000000002";
const CHEST_MRI = "e0000000-0000-4000-8000-000000000003";
const CHEST_CT = "e0000000-0000-4000-8000-000000000004";
const KNEE_MRI = "e0000000-0000-4000-8000-000000000005";

const organizations = [
  { id: ORG_A, name: "A 영상센터" },
  { id: ORG_B, name: "B 영상의학과" },
];
const page = <T>(contents: T[]) => ({ contents, totalElements: contents.length, totalPages: 1, size: 100, number: 0 });
const link = (equipmentId: string, examTypeId: string, examTypeName: string, modality: "CT" | "MRI") => ({
  id: `${equipmentId.slice(0, 8)}-${examTypeId.slice(-4)}`,
  equipmentId,
  examTypeId,
  examTypeName,
  modality,
  durationMinutes: 30,
});
/** 장비별 지원 검사 유형 (검사기관 A: MRI 1호기 뇌·척추, MRI 2호기 뇌·흉부, CT 흉부 / B: MRI 뇌, 점검 중 장비는 무릎) */
const SUPPORTED: Record<string, ReturnType<typeof link>[]> = {
  [MRI_A1]: [link(MRI_A1, BRAIN_MRI, "뇌 MRI", "MRI"), link(MRI_A1, SPINE_MRI, "척추 MRI", "MRI")],
  [MRI_A2]: [link(MRI_A2, BRAIN_MRI, "뇌 MRI", "MRI"), link(MRI_A2, CHEST_MRI, "흉부 MRI", "MRI")],
  [CT_A]: [link(CT_A, CHEST_CT, "흉부 CT", "CT")],
  [MRI_B]: [link(MRI_B, BRAIN_MRI, "뇌 MRI", "MRI")],
  [MRI_B_DOWN]: [link(MRI_B_DOWN, KNEE_MRI, "무릎 MRI", "MRI")],
};

const state = {
  access: { ok: true, headers: { Authorization: "Bearer test" }, user: {} } as Record<string, unknown>,
  examTypeLinkFails: false,
  calls: [] as string[],
  slotQueries: [] as Record<string, unknown>[],
};

let filter: typeof import("@/features/slots/examTypeFilter");
let client: typeof import("@/features/slots/apiSearchClient");
let route: typeof import("@/features/slots/searchRoute");
let server: typeof import("@/features/slots/server");
let availability: typeof import("@/features/slots/availability");
let mockApi: typeof import("@/features/slots/api");
let mockExam: typeof import("@/features/slots/mockSlotExamTypes");
let store: typeof import("@/features/equipment/mockEquipmentStore");
let SlotSearchFilter: typeof import("@/features/slots/components/SlotSearchFilter").default;
let SlotSearchTable: typeof import("@/features/slots/components/SlotSearchTable").default;
let RescheduleTable: typeof import("@/features/notifications/components/RescheduleTable").default;

before(async () => {
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "slots,partnerships,equipment";
  // 다른 모듈이 쓰는 나머지 내보내기는 실제 구현을 그대로 두고, 이 테스트가 부르는 조회 함수만 가짜로 바꾼다
  const realPartnerships = await import("@/features/partnerships/remote");
  const realEquipment = await import("@/features/equipment/remote");
  const realReferrals = await import("@/features/referrals/remote");
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) => {
        state.calls.push(`users/me:${role}`);
        return state.access;
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({ reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : "FORBIDDEN", message: access.message, code: null }),
    },
  });
  mock.module("@/features/partnerships/remote", {
    namedExports: {
      ...realPartnerships,
      fetchMyPartnershipList: async () =>
        organizations.map((org, index) => ({
          partnershipId: `p${index}`,
          partnerInstitutionId: org.id,
          partnerInstitutionName: org.name,
          partnerInstitutionType: "EXAM",
          status: "ACTIVE",
          requestedAt: "",
          approvedAt: null,
          terminatedAt: null,
        })),
    },
  });
  mock.module("@/features/equipment/remote", {
    namedExports: {
      ...realEquipment,
      fetchEquipmentPage: async (institutionId: string) => {
        state.calls.push(`equipments:${institutionId}`);
        return page(
          institutionId === ORG_A
            ? [
                { id: MRI_A1, institutionId, name: "MRI 1호기", modality: "MRI", status: "OPERATIONAL" },
                { id: MRI_A2, institutionId, name: "MRI 2호기", modality: "MRI", status: "OPERATIONAL" },
                { id: CT_A, institutionId, name: "CT 1호기", modality: "CT", status: "OPERATIONAL" },
              ]
            : [
                { id: MRI_B, institutionId, name: "MRI 1호기", modality: "MRI", status: "OPERATIONAL" },
                { id: MRI_B_DOWN, institutionId, name: "MRI 2호기", modality: "MRI", status: "MAINTENANCE" },
              ],
        );
      },
      fetchEquipmentExamTypePage: async (equipmentId: string) => {
        state.calls.push(`exam-types:${equipmentId}`);
        if (state.examTypeLinkFails) throw new Error("network");
        return page(SUPPORTED[equipmentId] ?? []);
      },
    },
  });
  mock.module("@/features/referrals/remote", {
    namedExports: {
      ...realReferrals,
      fetchExamTypePage: async () =>
        page([
          { id: BRAIN_MRI, name: "뇌 MRI", modality: "MRI" },
          { id: SPINE_MRI, name: "척추 MRI", modality: "MRI" },
          { id: CHEST_MRI, name: "흉부 MRI", modality: "MRI" },
          { id: CHEST_CT, name: "흉부 CT", modality: "CT" },
          { id: KNEE_MRI, name: "무릎 MRI", modality: "MRI" },
        ]),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { query: Record<string, unknown> }) => {
        state.calls.push(`GET ${path}`);
        state.slotQueries.push(options.query);
        const from = String(options.query.from).slice(0, 10);
        const all = [
          { id: "aaaaaaaa-0000-4000-8000-000000000001", equipmentId: MRI_A1, examTypeId: BRAIN_MRI, startsAt: `${from}T09:00:00+09:00`, endsAt: `${from}T09:30:00+09:00`, status: "AVAILABLE" },
          { id: "aaaaaaaa-0000-4000-8000-000000000002", equipmentId: MRI_A1, examTypeId: SPINE_MRI, startsAt: `${from}T10:00:00+09:00`, endsAt: `${from}T10:30:00+09:00`, status: "AVAILABLE" },
          { id: "aaaaaaaa-0000-4000-8000-000000000003", equipmentId: MRI_B, examTypeId: BRAIN_MRI, startsAt: `${from}T11:00:00+09:00`, endsAt: `${from}T11:30:00+09:00`, status: "AVAILABLE" },
        ];
        // 서버는 examTypeId 조건을 적용해 돌려준다
        const items = options.query.examTypeId ? all.filter((slot) => slot.examTypeId === options.query.examTypeId) : all;
        return { items, page: options.query.page, size: options.query.size, hasNext: false };
      },
    },
  });
  mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {} }), unstable_rethrow: () => {} } });
  mock.module("@/features/notifications/rescheduleSearchActions", { namedExports: { loadRescheduleSearchAction: async () => ({ ok: false, reason: "X", message: "x" }) } });

  filter = await import("@/features/slots/examTypeFilter");
  client = await import("@/features/slots/apiSearchClient");
  route = await import("@/features/slots/searchRoute");
  server = await import("@/features/slots/server");
  availability = await import("@/features/slots/availability");
  mockApi = await import("@/features/slots/api");
  mockExam = await import("@/features/slots/mockSlotExamTypes");
  store = await import("@/features/equipment/mockEquipmentStore");
  SlotSearchFilter = (await import("@/features/slots/components/SlotSearchFilter")).default;
  SlotSearchTable = (await import("@/features/slots/components/SlotSearchTable")).default;
  RescheduleTable = (await import("@/features/notifications/components/RescheduleTable")).default;
});

after(() => mock.reset());

beforeEach(() => {
  state.access = { ok: true, headers: { Authorization: "Bearer test" }, user: {} };
  state.examTypeLinkFails = false;
  state.calls = [];
  state.slotQueries = [];
  process.env.NEXT_PUBLIC_API_MODE = "api";
});

const tomorrow = addDays(getSeoulNow().dateKey, 1);
const options = () =>
  filter.collectExamTypeOptions(
    Object.entries(SUPPORTED)
      .filter(([equipmentId]) => equipmentId !== MRI_B_DOWN)
      .flatMap(([equipmentId, links]) =>
        links.map((item) => ({ organizationId: equipmentId.startsWith("a") ? ORG_A : ORG_B, examTypeId: item.examTypeId, examTypeName: item.examTypeName, examType: item.modality })),
      ),
  );

// ── 선택지 ──

describe("collectExamTypeOptions / getExamTypeChoices / reconcileExamTypeId", () => {
  it("같은 examTypeId는 장비·기관이 여러 곳이어도 하나 (지원 기관을 모은다)", () => {
    const brain = options().filter((option) => option.id === BRAIN_MRI);
    assert.equal(brain.length, 1);
    assert.deepEqual(brain[0].organizationIds.sort(), [ORG_A, ORG_B].sort());
  });

  it("CT 선택 → CT 항목만, MRI 선택 → MRI 항목만 (장비 이름이 아니라 검사 항목 이름)", () => {
    assert.deepEqual(filter.getExamTypeChoices(options(), organizations, { examType: "CT", organizationId: "" }), [{ value: CHEST_CT, label: "흉부 CT" }]);
    assert.deepEqual(
      filter.getExamTypeChoices(options(), organizations, { examType: "MRI", organizationId: "" }).map((choice) => choice.label),
      ["뇌 MRI", "척추 MRI", "흉부 MRI"],
    );
  });

  it("검사기관을 고르면 그 기관이 실제 지원하는 항목만 (협약 기관이 아니면 제외)", () => {
    assert.deepEqual(
      filter.getExamTypeChoices(options(), organizations, { examType: "", organizationId: ORG_B }).map((choice) => choice.value),
      [BRAIN_MRI],
    );
    const withOutsider = [...options(), { id: KNEE_MRI, name: "무릎 MRI", examType: "MRI" as const, organizationIds: [ORG_X] }];
    assert.equal(filter.getExamTypeChoices(withOutsider, organizations, { examType: "", organizationId: "" }).some((choice) => choice.value === KNEE_MRI), false);
  });

  it("검사 유형·기관이 바뀌어 고른 항목이 빠지면 전체 검사 항목으로", () => {
    const toCt = filter.getExamTypeChoices(options(), organizations, { examType: "CT", organizationId: "" });
    assert.equal(filter.reconcileExamTypeId(SPINE_MRI, toCt), "");
    const toB = filter.getExamTypeChoices(options(), organizations, { examType: "MRI", organizationId: ORG_B });
    assert.equal(filter.reconcileExamTypeId(SPINE_MRI, toB), "");
    assert.equal(filter.reconcileExamTypeId(BRAIN_MRI, toB), BRAIN_MRI);
  });

  it("이름이 같은 다른 검사 유형(ID가 다름)은 구분해서 보인다", () => {
    const dup = [...options(), { id: "f0000000-0000-4000-8000-000000000009", name: "뇌 MRI", examType: "MRI" as const, organizationIds: [ORG_A] }];
    const labels = filter.getExamTypeChoices(dup, organizations, { examType: "MRI", organizationId: "" }).map((choice) => choice.label);
    assert.equal(labels.filter((label) => label.startsWith("뇌 MRI (")).length, 2);
  });
});

// ── API 연결 ──

describe("examTypeId → 검색 요청", () => {
  it("검색 URL·Route Handler는 examTypeId를 넘기고, equipmentId는 사용자 필터로 받지 않는다", async () => {
    assert.match(client.buildSlotSearchUrl({ startDate: tomorrow, endDateExclusive: addDays(tomorrow, 1), examTypeId: BRAIN_MRI }), new RegExp(`examTypeId=${BRAIN_MRI}`));
    const received: Record<string, unknown>[] = [];
    const load = async (input: unknown) => {
      received.push(input as Record<string, unknown>);
      return { ok: true, slots: [], window: { startDate: tomorrow, endDateExclusive: addDays(tomorrow, 1) }, requestCount: 0 } as never;
    };
    await route.handleSlotSearchGet(
      new Request(`http://localhost/referring/slots/search?startDate=${tomorrow}&endDateExclusive=${addDays(tomorrow, 1)}&examTypeId=${BRAIN_MRI}&equipmentId=${MRI_A1}`),
      load,
    );
    assert.equal(received[0].examTypeId, BRAIN_MRI);
    assert.equal("equipmentId" in received[0], false);
  });

  it("loadApiSlotSearch: Gateway 쿼리에 examTypeId, 결과는 그 항목 슬롯만 + 항목 이름은 검사 유형 목록 (장비 ID는 슬롯에 그대로)", async () => {
    const result = await server.loadApiSlotSearch({ startDate: tomorrow, endDateExclusive: addDays(tomorrow, 1), examTypeId: BRAIN_MRI });
    assert.equal(result.ok, true);
    assert.equal(state.slotQueries[0].examTypeId, BRAIN_MRI);
    assert.equal("equipmentId" in state.slotQueries[0] && state.slotQueries[0].equipmentId !== undefined, false);
    if (result.ok) {
      assert.deepEqual(result.slots.map((slot) => slot.examTypeName), ["뇌 MRI", "뇌 MRI"]);
      assert.deepEqual(result.slots.map((slot) => slot.equipmentId).sort(), [MRI_A1, MRI_B].sort());
    }
  });

  it("검색 선택지: 운영 중 장비의 지원 검사 유형만, 같은 항목은 하나, 조회 실패는 examTypes=null (Mock 항목으로 채우지 않음)", async () => {
    const result = await server.loadApiSlotSearchOrganizations();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.examTypes?.map((option) => option.id).sort(), [BRAIN_MRI, SPINE_MRI, CHEST_MRI, CHEST_CT].sort());
      assert.equal(result.examTypes?.some((option) => option.id === KNEE_MRI), false, "점검 중 장비의 항목은 제외");
    }
    assert.equal(state.calls.includes(`exam-types:${MRI_B_DOWN}`), false);
    state.examTypeLinkFails = true;
    const original = console.error;
    console.error = () => {};
    const failed = await server.loadApiSlotSearchOrganizations().finally(() => (console.error = original));
    assert.equal(failed.ok, true);
    if (failed.ok) {
      assert.equal(failed.examTypes, null);
      assert.equal(failed.organizations.length, 2);
    }
  });
});

// ── 결과·달력 ──

const apiSlot = (id: string, examTypeId: string, startAt: string) => ({
  id,
  organizationId: ORG_A,
  organizationName: "A 영상센터",
  equipmentId: MRI_A1,
  equipmentName: "MRI 1호기",
  examType: "MRI" as const,
  examTypeId,
  examTypeName: examTypeId === BRAIN_MRI ? "뇌 MRI" : "척추 MRI",
  startAt,
  endAt: startAt,
  startsAt: `${startAt}:00+09:00`,
  endsAt: `${startAt}:00+09:00`,
  isAvailable: true,
  status: "AVAILABLE" as const,
});

describe("결과 수·항목별 가용 날짜", () => {
  const day1 = addDays(tomorrow, 1);
  const day2 = addDays(tomorrow, 2);
  // 같은 장비(MRI 1호기)라도 슬롯마다 검사 항목이 다르다: 달력은 장비가 아니라 항목 기준
  const slots = [apiSlot("s1", BRAIN_MRI, `${day1}T09:00`), apiSlot("s2", BRAIN_MRI, `${day1}T10:00`), apiSlot("s3", SPINE_MRI, `${day2}T09:00`)];
  const criteria = { examType: "" as const, date: "", organizationId: "", timeOfDay: "" as const, availableOnly: false };

  it("결과 수는 세부 검사 항목 필터를 적용한 수와 같다", () => {
    const now = getSeoulNow().dateTime;
    assert.equal(client.filterApiSearchResults(slots, criteria, now).length, 3);
    assert.equal(client.filterApiSearchResults(slots, { ...criteria, examTypeId: BRAIN_MRI }, now).length, 2);
    assert.equal(client.filterApiSearchResults(slots, { ...criteria, examTypeId: SPINE_MRI.toUpperCase() }, now).length, 1);
  });

  it("달력: 뇌 MRI·척추 MRI·전체마다 가용 날짜가 다르다 (같은 장비의 다른 항목 날짜를 섞지 않음)", () => {
    const now = getSeoulNow().dateTime;
    assert.deepEqual(client.countApiSlotsByDate(slots, { ...criteria, examTypeId: BRAIN_MRI }, now), { [day1]: 2 });
    assert.deepEqual(client.countApiSlotsByDate(slots, { ...criteria, examTypeId: SPINE_MRI }, now), { [day2]: 1 });
    assert.deepEqual(client.countApiSlotsByDate(slots, criteria, now), { [day1]: 2, [day2]: 1 });
  });

  it("Mock 판정(matchesSlotFilter)도 examTypeId 기준", () => {
    assert.equal(availability.matchesSlotFilter(slots[0], { examType: "", organizationId: "", timeOfDay: "", examTypeId: BRAIN_MRI }), true);
    assert.equal(availability.matchesSlotFilter(slots[2], { examType: "", organizationId: "", timeOfDay: "", examTypeId: BRAIN_MRI }), false);
  });
});

describe("Mock 모드", () => {
  it("Mock 슬롯마다 장비가 지원하는 Mock 검사 유형 하나 (같은 슬롯은 항상 같은 항목), 선택지는 그 항목들", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const { MOCK_EXAM_TYPES } = await import("@/lib/dev/mockExamTypes");
    const { MOCK_PARTNER_ORGANIZATIONS } = await import("@/lib/dev/mockSlots");
    const criteria = { examType: "" as const, date: "", organizationId: "", timeOfDay: "" as const, availableOnly: false };
    const all = await mockApi.searchSlots(criteria);
    assert.ok(all.length > 0);
    for (const slot of all) {
      const type = MOCK_EXAM_TYPES.find((item) => item.id === slot.examTypeId);
      assert.ok(type, `${slot.id} 항목 없음`);
      assert.equal(type!.modality, slot.examType);
      assert.equal(slot.examTypeName, type!.name);
    }
    const again = await mockApi.searchSlots(criteria);
    assert.deepEqual(again.map((slot) => slot.examTypeId), all.map((slot) => slot.examTypeId));

    const optionIds = mockExam.getMockExamTypeOptions(store.equipmentChangeStore.read(), MOCK_PARTNER_ORGANIZATIONS).map((option) => option.id);
    assert.ok(all.every((slot) => optionIds.includes(slot.examTypeId!)));

    const target = all[0].examTypeId!;
    const only = await mockApi.searchSlots({ ...criteria, examTypeId: target });
    assert.ok(only.length > 0 && only.length < all.length);
    assert.ok(only.every((slot) => slot.examTypeId === target));
  });
});

// ── 화면 ──

describe("검색 조건·결과 표시", () => {
  it("세부 검사 항목 칸: 전체 검사 항목 + 항목 이름 (지원 장비 칸 없음), 실패·없음 안내", () => {
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(SlotSearchFilter, { organizations, isSearching: false, onSearch: () => {}, dataSource: "api", ...props } as never));
    const html = render({ examTypeOptions: options() });
    assert.match(html, /<label[^>]*for="slot-exam-item"[^>]*>세부 검사 항목/);
    assert.match(html, /<option value="" selected="">전체 검사 항목<\/option>/);
    assert.match(html, new RegExp(`<option value="${BRAIN_MRI}">뇌 MRI</option>`));
    assert.doesNotMatch(html, /지원 장비|slot-equipment|MRI 1호기/);
    assert.match(render({ examTypeOptions: null }), /<select id="slot-exam-item"[^>]*disabled=""[\s\S]*?검사 항목을 불러오지 못했습니다/);
    assert.match(render({ examTypeOptions: [] }), /선택 가능한 검사 항목이 없습니다/);
  });

  it("결과 표: 검사기관 | 검사 유형 | 세부 검사 항목 | 검사 일시 | 상태 | 선택 (장비 이름 열 없음)", () => {
    const html = renderToStaticMarkup(createElement(SlotSearchTable, { slots: [apiSlot("s1", BRAIN_MRI, `${tomorrow}T09:00`)], onRequestReservation: () => {} }));
    const headers = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]);
    assert.deepEqual(headers, ["검사기관", "검사 유형", "세부 검사 항목", "검사 일시", "상태", "선택"]);
    assert.match(html, /<td[^>]*>뇌 MRI<\/td>/);
    assert.doesNotMatch(html, /MRI 1호기|지원 장비|검사 장비/);
  });
});

describe("결과 표 한 줄 표시 (일반 검색·재조정 공통 SlotSearchTable)", () => {
  const render = (actionLabel?: string) =>
    renderToStaticMarkup(createElement(SlotSearchTable, { slots: [{ ...apiSlot("s1", BRAIN_MRI, `${tomorrow}T09:00`), examTypeName: "ITDA 뇌 CT 정밀검사" }], onRequestReservation: () => {}, actionLabel }));

  it("머리글·검사 유형·세부 검사 항목·상태 배지·버튼이 줄바꿈되지 않는다 (항목 전체 이름은 title로 확인)", () => {
    const html = render();
    const headers = [...html.matchAll(/<th [^>]*class="([^"]*)"/g)].map((match) => match[1]);
    assert.equal(headers.length, 6);
    assert.ok(headers.every((cls) => cls.includes("whitespace-nowrap")));
    assert.match(html, /<td class="[^"]*whitespace-nowrap break-keep[^"]*" title="ITDA 뇌 CT 정밀검사">ITDA 뇌 CT 정밀검사<\/td>/);
    assert.match(html, /<span class="[^"]*whitespace-nowrap[^"]*bg-emerald-50 text-emerald-700">예약 가능<\/span>/);
    assert.match(html, /<button[^>]*class="h-10 min-w-\[100px\] px-4 whitespace-nowrap[^"]*bg-primary[^"]*hover:bg-primary-hover[^"]*disabled:bg-gray-200[^"]*">예약 요청<\/button>/);
  });

  it("대체 슬롯 선택도 같은 표·같은 버튼 (높이 40px, 글자 길이만큼), 좁은 화면 카드는 그대로", () => {
    const html = render("대체 슬롯 선택");
    assert.match(html, /<button[^>]*class="h-10 min-w-\[100px\] px-4 whitespace-nowrap[^"]*">대체 슬롯 선택<\/button>/);
    assert.match(html, /<ul aria-label="검사 슬롯 검색 결과" class="flex flex-col gap-3 md:hidden">/);
    assert.match(html, /<button[^>]*class="mt-3 h-11 w-full whitespace-nowrap[^"]*">대체 슬롯 선택<\/button>/);
  });
});

describe("재조정 목록 (Mock)", () => {
  it("기존 세부 검사 항목은 Mock 의뢰의 항목 ID로 찾는다 (없으면 확인 불가로, 이름을 만들지 않음)", () => {
    const html = renderToStaticMarkup(
      createElement(RescheduleTable, {
        referrals: [
          { id: "r1", referralNumber: "R-1", organizationId: ORG_A, organizationName: "A 영상센터", equipmentName: "MRI 1호기", examType: "MRI", examTypeId: "mock-exam-type-mri-brain", scheduledAt: `${tomorrow}T09:00`, status: "RESCHEDULE_REQUIRED" },
        ],
        isEquipmentFailure: true,
      } as never),
    );
    assert.match(html, /<ul aria-label="예약 재조정 필요 목록"/);
    assert.doesNotMatch(html, /href="\/referring\/slots/);
  });
});
