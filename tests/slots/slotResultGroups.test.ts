import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countAvailableSlotsByDate,
  getResultDateRange,
  groupSlotCards,
  pickInitialResultDate,
  resolveResultDate,
} from "@/features/slots/slotResultGroups";
import type { ExamSlot } from "@/features/slots/types";

/**
 * 슬롯 검색 PC 결과(달력 + 카드)의 날짜·카드 묶기. 받은 결과만 나누고 슬롯을 만들거나 합치지 않는지 확인한다.
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const MRI_1 = "a0000000-0000-4000-8000-0000000000a1";
const MRI_2 = "a0000000-0000-4000-8000-0000000000a2";
const BRAIN = "e0000000-0000-4000-8000-000000000001";
const SPINE = "e0000000-0000-4000-8000-000000000002";

const slot = (id: string, startAt: string, patch: Partial<ExamSlot> = {}): ExamSlot => ({
  id,
  organizationId: ORG_A,
  organizationName: "A 영상센터",
  equipmentId: MRI_1,
  equipmentName: "MRI 1호기",
  examType: "MRI",
  examTypeId: BRAIN,
  examTypeName: "뇌 MRI",
  startAt,
  isAvailable: true,
  ...patch,
});

describe("날짜별 예약 가능 건수", () => {
  const slots = [
    slot("s1", "2026-11-10T09:00"),
    slot("s2", "2026-11-10T10:00", { isAvailable: false }),
    slot("s3", "2026-11-10T11:00", { equipmentId: MRI_2 }),
    slot("s4", "2026-11-11T09:00", { isAvailable: false, blockedReason: "EQUIPMENT_FAILURE" }),
    slot("s5", "2026-11-12T13:30", { organizationId: ORG_B }),
  ];

  it("달력 건수 = 그날 예약 가능한 슬롯 수 (예약 불가 슬롯은 세지 않고, 없는 날짜는 키가 없다)", () => {
    const counts = countAvailableSlotsByDate(slots);
    assert.deepEqual(counts, { "2026-11-10": 2, "2026-11-12": 1 });
    // 날짜별 건수 합 = 결과 전체의 예약 가능 슬롯 수
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    assert.equal(total, slots.filter((item) => item.isAvailable).length);
  });

  it("각 날짜의 건수 = 그날 카드들의 예약 가능 시간 수의 합", () => {
    const counts = countAvailableSlotsByDate(slots);
    for (const date of ["2026-11-10", "2026-11-11", "2026-11-12"]) {
      const cardTotal = groupSlotCards(slots, date).reduce((sum, card) => sum + card.availableCount, 0);
      assert.equal(cardTotal, counts[date] ?? 0, date);
    }
  });
});

describe("카드 묶기 (날짜·검사기관 ID·장비 ID·세부 검사 항목 ID)", () => {
  it("같은 날짜·기관·장비·항목의 시간만 한 카드로 묶고, 슬롯 원본(id)을 그대로 둔다", () => {
    const slots = [
      slot("s-b", "2026-11-10T13:00"),
      slot("s-a", "2026-11-10T09:00"),
      slot("s-other-day", "2026-11-11T09:00"),
    ];
    const cards = groupSlotCards(slots, "2026-11-10");
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0].slots.map((item) => item.id), ["s-a", "s-b"]);
    // 원본 객체 그대로 (복사·변형하지 않는다)
    assert.equal(cards[0].slots[0], slots[1]);
  });

  it("같은 기관이라도 장비가 다르거나 세부 검사 항목이 다르면 따로 묶는다", () => {
    const slots = [
      slot("brain-mri1", "2026-11-10T09:00"),
      slot("brain-mri2", "2026-11-10T09:00", { equipmentId: MRI_2, equipmentName: "MRI 2호기" }),
      slot("spine-mri1", "2026-11-10T10:00", { examTypeId: SPINE, examTypeName: "척추 MRI" }),
      slot("brain-orgB", "2026-11-10T11:00", { organizationId: ORG_B, organizationName: "B 영상의학과" }),
    ];
    const cards = groupSlotCards(slots, "2026-11-10");
    assert.equal(cards.length, 4);
    assert.deepEqual(
      cards.map((card) => card.slots.map((item) => item.id)),
      [["brain-mri1"], ["brain-mri2"], ["spine-mri1"], ["brain-orgB"]],
    );
  });

  it("ID 대소문자만 다른 경우는 같은 카드 (서버 UUID 비교 기준과 같다)", () => {
    const slots = [slot("s1", "2026-11-10T09:00"), slot("s2", "2026-11-10T10:00", { examTypeId: BRAIN.toUpperCase(), equipmentId: MRI_1.toUpperCase() })];
    assert.equal(groupSlotCards(slots, "2026-11-10").length, 1);
  });

  it("examTypeId가 없는 Mock 슬롯: 이름이 다른 항목, ID가 있는 항목과 합치지 않는다", () => {
    const slots = [
      slot("no-id-brain", "2026-11-10T09:00", { examTypeId: undefined, examTypeName: "뇌 MRI" }),
      slot("no-id-spine", "2026-11-10T09:30", { examTypeId: undefined, examTypeName: "척추 MRI" }),
      slot("no-id-brain-2", "2026-11-10T10:00", { examTypeId: undefined, examTypeName: "뇌 MRI" }),
      slot("with-id-brain", "2026-11-10T10:30"),
      slot("no-id-no-name", "2026-11-10T11:00", { examTypeId: undefined, examTypeName: undefined }),
    ];
    const cards = groupSlotCards(slots, "2026-11-10");
    assert.deepEqual(
      cards.map((card) => card.slots.map((item) => item.id)),
      [["no-id-brain", "no-id-brain-2"], ["no-id-spine"], ["with-id-brain"], ["no-id-no-name"]],
    );
  });

  it("카드별 예약 가능 수는 예약 가능한 시간만 센다 (예약 불가 시간은 카드에 남지만 세지 않는다)", () => {
    const cards = groupSlotCards([slot("ok", "2026-11-10T09:00"), slot("closed", "2026-11-10T10:00", { isAvailable: false })], "2026-11-10");
    assert.equal(cards[0].slots.length, 2);
    assert.equal(cards[0].availableCount, 1);
  });
});

describe("검색 기간·처음 선택 날짜", () => {
  const slots = [
    slot("closed", "2026-11-10T09:00", { isAvailable: false }),
    slot("ok", "2026-11-12T09:00"),
  ];

  it("API: 실제 검색 기간을 그대로, 날짜 지정: 그날 하루, Mock 전체 기간: 결과의 첫~마지막 날짜", () => {
    const window = { startDate: "2026-11-08", endDateExclusive: "2026-12-09" };
    assert.deepEqual(getResultDateRange(slots, { window }), window);
    assert.deepEqual(getResultDateRange([], { criteriaDate: "2026-11-20" }), { startDate: "2026-11-20", endDateExclusive: "2026-11-21" });
    assert.deepEqual(getResultDateRange(slots, {}), { startDate: "2026-11-10", endDateExclusive: "2026-11-13" });
    assert.equal(getResultDateRange([], {}), null);
  });

  it("새 검색: 날짜 지정이면 그 날짜, 아니면 예약 가능한 슬롯이 있는 첫 날짜", () => {
    assert.equal(pickInitialResultDate(slots, null, "2026-11-10"), "2026-11-10");
    assert.equal(pickInitialResultDate(slots, null), "2026-11-12");
    assert.equal(pickInitialResultDate([slots[0]], null), "2026-11-10");
    assert.equal(pickInitialResultDate([], { startDate: "2026-11-08", endDateExclusive: "2026-12-09" }), "2026-11-08");
  });
});

describe("결과 갱신 뒤 선택 날짜", () => {
  const range = { startDate: "2026-11-08", endDateExclusive: "2026-12-09" };
  const before = [slot("a", "2026-11-10T09:00"), slot("b", "2026-11-12T09:00")];
  // 11/12 슬롯을 예약해 그날 예약 가능한 슬롯이 없어진 재검색 결과
  const after = [slot("a", "2026-11-10T09:00")];

  it("예약 접수 뒤 같은 조건 재검색: 고른 날짜를 유지한다 (그날 슬롯이 없어져도 첫 날짜로 옮기지 않는다)", () => {
    const date = resolveResultDate({ previous: "2026-11-12", isNewSearch: false, slots: after, range });
    assert.equal(date, "2026-11-12");
    assert.equal(countAvailableSlotsByDate(after)[date], undefined);
    assert.deepEqual(groupSlotCards(after, date), []);
  });

  it("새 검색일 때만 첫 예약 가능 날짜를 고른다", () => {
    assert.equal(resolveResultDate({ previous: "2026-11-12", isNewSearch: true, slots: before, range }), "2026-11-10");
    assert.equal(resolveResultDate({ previous: "", isNewSearch: false, slots: before, range }), "2026-11-10");
    assert.equal(resolveResultDate({ previous: "2026-11-12", isNewSearch: true, slots: before, range, criteriaDate: "2026-11-12" }), "2026-11-12");
  });
});
