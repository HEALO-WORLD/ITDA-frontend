import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * PC 예약 재조정 모달 (한 모달 3단계): 단계 표시, 요청 상태 단계(접수 ≠ 확정), 슬롯 다시 선택 허용 범위,
 * 3단계 inline 표시, 2단계 레이아웃(기존 예약 고정 + 조건 칩·달력·카드)과 모바일(기존 구조) 분리.
 * Server Function은 가짜로 바꾼다 (렌더링만으로 요청하지 않는지 기록)
 */

const REFERRAL = "88888888-8888-4888-8888-888888888888";
const SLOT = "44444444-4444-4444-8444-444444444444";
const EXAM_ORG = "22222222-2222-4222-8222-222222222222";
const EXAM_TYPE = "66666666-6666-4666-8666-666666666666";

const calls: string[] = [];

let Confirm: typeof import("@/features/referrals/components/ApiRescheduleConfirm");
let Steps: typeof import("@/features/referrals/components/RescheduleWizardSteps");
let SlotSearch: typeof import("@/features/slots/components/SlotSearch").default;

before(async () => {
  mock.module("@/features/referrals/rescheduleActions", {
    namedExports: {
      checkRescheduleCandidateAction: async () => (calls.push("check"), new Promise(() => {})),
      requestRescheduleAction: async () => (calls.push("request"), { ok: false }),
    },
  });
  mock.module("@/features/referrals/rescheduleProgressActions", {
    namedExports: { loadRescheduleProgressAction: async () => (calls.push("progress"), { ok: false }) },
  });
  mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {} }), unstable_rethrow: () => {} } });
  Confirm = await import("@/features/referrals/components/ApiRescheduleConfirm");
  Steps = await import("@/features/referrals/components/RescheduleWizardSteps");
  SlotSearch = (await import("@/features/slots/components/SlotSearch")).default;
});

const target = {
  referralId: REFERRAL,
  examTypeId: EXAM_TYPE,
  examTypeName: "흉부 CT",
  modality: "CT" as const,
  currentReservation: { status: "BLOCKED" as const, startTime: "2099-01-05T10:00:00", endTime: "2099-01-05T10:30:00", examInstitutionId: EXAM_ORG, equipmentName: "CT-1" },
};
const slot = {
  id: SLOT,
  organizationId: EXAM_ORG,
  organizationName: "A 영상센터",
  equipmentId: "55555555-5555-4555-8555-555555555555",
  equipmentName: "CT-2",
  examType: "CT" as const,
  examTypeId: EXAM_TYPE,
  examTypeName: "흉부 CT",
  startAt: "2099-01-10T10:00",
  endAt: "2099-01-10T10:30",
  startsAt: "2099-01-10T10:00:00+09:00",
  endsAt: "2099-01-10T10:30:00+09:00",
  isAvailable: true,
  status: "AVAILABLE" as const,
};
const organizations = [{ id: EXAM_ORG, name: "A 영상센터" }];

type Phase = import("@/features/referrals/components/ApiRescheduleConfirm").Phase;
const states = (phase: Phase, progress: unknown = null) =>
  Confirm.getRescheduleStatusSteps(phase, progress as never).map(({ label, state, note }) => `${label}:${state}${note ? `(${note})` : ""}`);

describe("요청 상태 단계 (재조정 요청 → 요청 접수 → 예약 확정)", () => {
  it("요청 전·요청 중·확실한 실패", () => {
    for (const kind of ["CHECKING", "READY"] as const) {
      assert.deepEqual(states({ kind }), ["재조정 요청:pending(요청 전)", "요청 접수:pending", "예약 확정:pending"]);
    }
    assert.deepEqual(states({ kind: "REJECTED", message: "x" }), ["재조정 요청:pending(요청 전)", "요청 접수:pending", "예약 확정:pending"]);
    assert.deepEqual(states({ kind: "SUBMITTING" }), ["재조정 요청:current(요청 중)", "요청 접수:pending", "예약 확정:pending"]);
    assert.deepEqual(states({ kind: "FAILED", message: "x", showList: false }), ["재조정 요청:error(요청 실패)", "요청 접수:pending", "예약 확정:pending"]);
  });

  it("접수됨: 상태 재조회 전·처리 중에는 '확정 대기' (확정으로 표시하지 않는다)", () => {
    const accepted = { kind: "ACCEPTED", message: "접수" } as const;
    assert.deepEqual(states(accepted), ["재조정 요청:done", "요청 접수:done(접수됨)", "예약 확정:current(확정 대기)"]);
    assert.deepEqual(states(accepted, { ok: true, stage: "PROCESSING", message: "" }), ["재조정 요청:done", "요청 접수:done(접수됨)", "예약 확정:current(확정 대기)"]);
  });

  it("서버 상태 재조회가 CONFIRMED일 때만 '예약 확정' 완료", () => {
    const accepted = { kind: "ACCEPTED", message: "접수" } as const;
    assert.deepEqual(states(accepted, { ok: true, stage: "CONFIRMED", message: "" }), ["재조정 요청:done", "요청 접수:done(접수됨)", "예약 확정:done(확정됨)"]);
    for (const stage of ["PROCESSING", "FAILED", "NEEDS_RESCHEDULE", "OTHER"]) {
      assert.notEqual(states(accepted, { ok: true, stage, message: "" })[2], "예약 확정:done(확정됨)", stage);
    }
    assert.notEqual(states(accepted, { ok: false, reason: "ERROR", message: "" })[2], "예약 확정:done(확정됨)");
  });

  it("확정 실패·확인 필요·결과 불명", () => {
    const accepted = { kind: "ACCEPTED", message: "접수" } as const;
    assert.equal(states(accepted, { ok: true, stage: "FAILED", message: "" })[2], "예약 확정:error(확정 실패)");
    assert.equal(states(accepted, { ok: true, stage: "NEEDS_RESCHEDULE", message: "" })[2], "예약 확정:error(확정 실패)");
    assert.equal(states(accepted, { ok: true, stage: "OTHER", message: "" })[2], "예약 확정:warning(확인 필요)");
    assert.equal(states(accepted, { ok: false, reason: "ERROR", message: "" })[2], "예약 확정:warning(상태 확인 실패)");
    const uncertain = { kind: "UNCERTAIN", message: "불명" } as const;
    assert.deepEqual(states(uncertain), ["재조정 요청:done", "요청 접수:warning(결과 확인 필요)", "예약 확정:pending"]);
    // 결과 불명이어도 재조회가 확정을 돌려주면 확정
    assert.equal(states(uncertain, { ok: true, stage: "CONFIRMED", message: "" })[2], "예약 확정:done(확정됨)");
  });
});

describe("슬롯 다시 선택 허용 범위", () => {
  it("요청 전(확인 중·확인 통과·확인 실패)에만 되돌아갈 수 있다", () => {
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "CHECKING" }), true);
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "READY" }), true);
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "REJECTED", message: "x" }), true);
  });
  it("요청 중·접수 뒤·결과 불명·실패 뒤에는 되돌아갈 수 없다 (같은 의뢰를 다른 슬롯으로 다시 요청하지 않게)", () => {
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "SUBMITTING" }), false);
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "ACCEPTED", message: "x" }), false);
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "UNCERTAIN", message: "x" }), false);
    assert.equal(Confirm.canReturnToSlotSelection({ kind: "FAILED", message: "x", showList: true }), false);
  });
});

describe("3단계 inline 표시 (같은 모달 본문)", () => {
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(Confirm.default, {
        open: true,
        inline: true,
        target,
        slot,
        organizations,
        onCancel: () => {},
        onBack: () => {},
        onBusyChange: () => {},
        onAccepted: () => {},
        ...props,
      } as never),
    );

  it("별도 대화상자 없이 단계 제목·요청 상태 단계·비교·하단 버튼 (요청 전: 슬롯 다시 선택 / 취소 / 요청(확인 전 비활성))", () => {
    const html = render();
    assert.doesNotMatch(html, /<dialog/);
    assert.match(html, /<h3 id="reschedule-confirm-title" tabindex="-1"[^>]*>예약 변경 확인<\/h3>/);
    assert.match(html, /<ol aria-label="재조정 요청 상태"/);
    assert.match(html, />슬롯 다시 선택<\/button>/);
    assert.match(html, />취소<\/button>/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>이 슬롯으로 재조정 요청<\/button>/);
    assert.equal(calls.includes("request"), false, "렌더링만으로 재예약 요청을 보내지 않는다");
  });

  it("바뀌는 항목만 '변경'(날짜·시간, 장비), 같은 항목은 '기존과 같음', 기존 → 변경 화살표", () => {
    const html = render();
    const newCard = html.slice(html.indexOf('aria-label="변경할 예약"'));
    assert.equal((newCard.match(/>변경<\/span>/g) ?? []).length, 2);
    assert.match(newCard, /2099-01-10[^<]*<span[^>]*>변경<\/span>/);
    assert.match(newCard, /CT-2<span[^>]*>변경<\/span>/);
    assert.equal((newCard.match(/기존과 같음/g) ?? []).length, 2);
    assert.match(html, /lucide-arrow-right/);
  });

  it("onBack이 없으면 슬롯 다시 선택 버튼도 없다", () => {
    assert.doesNotMatch(render({ onBack: undefined }), /슬롯 다시 선택/);
  });
});

describe("단계 표시", () => {
  it("현재 단계만 aria-current=step, 앞 단계는 완료", () => {
    const html = renderToStaticMarkup(createElement(Steps.default, { current: 2 }));
    assert.match(html, /<ol aria-label="예약 재조정 단계"/);
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
    assert.match(html, /aria-current="step"[\s\S]*?대체 슬롯 선택/);
    assert.match(html, /기존 예약 확인<span class="sr-only"> \(완료\)<\/span>/);
  });
});

describe("SlotSearch 재조정: PC 한 모달 3단계 / 모바일 기존 구조", () => {
  const original = globalThis.window;
  after(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = original;
  });
  const renderSearch = (pc: boolean) => {
    if (pc) globalThis.window = { matchMedia: () => ({ matches: true }) } as unknown as Window & typeof globalThis;
    else Reflect.deleteProperty(globalThis, "window");
    try {
      return renderToStaticMarkup(
        createElement(SlotSearch, {
          organizations,
          apiReschedule: { ok: true, target },
          embedded: true,
          rescheduleWizard: {
            existing: createElement("section", { "aria-label": "기존 예약" }, "EXISTING-CARD"),
            onClose: () => {},
            onBusyChange: () => {},
          },
        }),
      );
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  };

  it("PC: 단계 표시(2단계) + 왼쪽 기존 예약·선택 안내 + 조건 칩(검사 유형 고정) + 검색 중 안내, [다음]은 슬롯을 고르기 전 비활성", () => {
    const html = renderSearch(true);
    assert.match(html, /<ol aria-label="예약 재조정 단계"/);
    assert.match(html, /aria-current="step"[\s\S]*?대체 슬롯 선택/);
    assert.match(html, /<aside aria-label="기존 예약과 선택한 대체 슬롯"[\s\S]*EXISTING-CARD[\s\S]*오른쪽 달력에서 날짜를 고르고 시간을 선택해 주세요/);
    assert.match(html, /data-criteria-chips/);
    assert.match(html, /id="slot-chip-exam-type"[^>]*aria-disabled="true"/);
    assert.match(html, /대체 슬롯을 검색하고 있습니다/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>다음: 변경 내용 확인/);
    // 표(기존 결과 영역)·별도 확인 대화상자 없음
    assert.doesNotMatch(html, /<table/);
    assert.doesNotMatch(html, /<dialog/);
  });

  it("모바일(열 때 PC가 아님): 기존 전체 폼 + [슬롯 검색] + 확인 대화상자 구조 그대로, 단계 표시 없음", () => {
    const html = renderSearch(false);
    assert.doesNotMatch(html, /예약 재조정 단계/);
    assert.doesNotMatch(html, /EXISTING-CARD/);
    assert.match(html, />슬롯 검색</);
    assert.match(html, /<dialog/);
  });
});
