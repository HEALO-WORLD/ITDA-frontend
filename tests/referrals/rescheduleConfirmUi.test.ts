import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 재조정 대체 슬롯 확인 화면 (API 모드) 표시·판단 테스트. Server Function은 가짜로 바꾼다 (호출 기록만).
 * - 기존 예약 | 새 슬롯 비교 표시, 확인 전에는 [재예약 요청] 비활성
 * - 요청 실패 → 확실한 실패/결과 불명 구분 (결과 불명이면 다시 요청하지 않고 상태 확인)
 * - 진행 단계 판단 (접수 ≠ 확정)
 * - SlotSearch: API 재조정 모드와 Mock 재조정 모드 분리
 */

const REFERRAL = "88888888-8888-4888-8888-888888888888";
const SLOT = "44444444-4444-4444-8444-444444444444";
const EXAM_ORG = "22222222-2222-4222-8222-222222222222";
const EXAM_TYPE = "66666666-6666-4666-8666-666666666666";

const calls: string[] = [];

let Confirm: typeof import("@/features/referrals/components/ApiRescheduleConfirm");
let progress: typeof import("@/features/referrals/rescheduleProgress");
let SlotSearch: typeof import("@/features/slots/components/SlotSearch").default;

before(async () => {
  mock.module("@/features/referrals/rescheduleActions", {
    namedExports: {
      checkRescheduleCandidateAction: async () => {
        calls.push("check");
        return new Promise(() => {});
      },
      requestRescheduleAction: async () => {
        calls.push("request");
        return { ok: false };
      },
    },
  });
  mock.module("@/features/referrals/rescheduleProgressActions", {
    namedExports: { loadRescheduleProgressAction: async () => (calls.push("progress"), { ok: false }) },
  });
  mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {} }), unstable_rethrow: () => {} } });
  Confirm = await import("@/features/referrals/components/ApiRescheduleConfirm");
  progress = await import("@/features/referrals/rescheduleProgress");
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

describe("ApiRescheduleConfirm 표시", () => {
  const organizations = [{ id: EXAM_ORG, name: "A 영상센터" }];
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(Confirm.default, { open: true, target, slot, organizations, onCancel: () => {}, onBusyChange: () => {}, onAccepted: () => {}, ...props } as never),
    );

  it("요청 전: 제목 '예약 변경 확인', 기존 예약 | 변경할 예약 좌우 카드, 확인 전에는 요청 버튼 비활성 (렌더링만으로 요청 없음)", () => {
    const html = render();
    assert.match(html, /<h2[^>]*>예약 변경 확인<\/h2>/);
    // 좌우 2열(좁은 화면은 세로) 카드
    assert.match(html, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
    assert.match(html, /<section aria-label="기존 예약" class="[^"]*bg-gray-50/);
    assert.match(html, /<section aria-label="변경할 예약" class="[^"]*bg-primary-soft/);
    for (const text of ["A 영상센터", "흉부 CT", "CT-1", "CT-2", "~ 10:30", "기존과 같음"]) assert.ok(html.includes(text), text);
    // 큰 세로 화살표 없음, 상태 안내는 배너 하나
    assert.doesNotMatch(html, /lucide-arrow-down/);
    assert.equal((html.match(/role="(status|alert)" aria-live="polite"/g) ?? []).length, 1);
    assert.match(html, /재조정할 수 있는지 확인하고 있습니다/);
    // 하단 고정 버튼: 취소 / 이 슬롯으로 재조정 요청(비활성)
    assert.match(html, />취소<\/button>/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>이 슬롯으로 재조정 요청<\/button>/);
    assert.equal(calls.includes("request"), false, "렌더링만으로 재예약 요청을 보내지 않는다");
  });

  it("너비는 비교용 compare(880px), 닫혀 있거나 슬롯이 없으면 본문을 그리지 않는다", () => {
    assert.match(render(), /w-\[min\(880px,calc\(100%-24px\)\)\]/);
    const closed = render({ open: false, slot: null });
    assert.doesNotMatch(closed, /기존 예약|이 슬롯으로 재조정 요청/);
  });

  it("기존 예약 정보가 없으면 확인 불가·— 로 보인다 (임의 값으로 채우지 않음)", () => {
    const html = renderToStaticMarkup(
      createElement(Confirm.RescheduleCompare, {
        target: { ...target, examTypeName: null, modality: null, currentReservation: null },
        slot,
        organizations: [],
        newCardLabel: "변경할 예약",
        banner: { tone: "info", message: "x" },
      }),
    );
    assert.match(html, /확인 불가/);
    assert.match(html, /<dd[^>]*>—<\/dd>/);
    assert.doesNotMatch(html, /기존과 같음/);
  });
});

describe("getRescheduleView (상태별 제목·배너·버튼, 서버 응답 기준)", () => {
  const progressOk = (stage: string, message = "상태 메시지") => ({ ok: true, stage, message, referralStatus: "PENDING", reservation: null }) as never;

  it("요청 전·요청 중: '예약 변경 확인' + 취소/요청", () => {
    for (const phase of [{ kind: "CHECKING" }, { kind: "READY" }, { kind: "SUBMITTING" }] as const) {
      const view = Confirm.getRescheduleView(phase as never, null);
      assert.equal(view.title, "예약 변경 확인");
      assert.equal(view.actions, "REQUEST");
      assert.equal(view.newCardLabel, "변경할 예약");
    }
    assert.equal(Confirm.getRescheduleView({ kind: "REJECTED", message: "m" } as never, null).actions, "RECHECK");
  });

  it("접수 후(확정 전): '예약 재조정 현황', 배너 하나에 접수+처리 중 상태, 닫기/상태 새로고침 — 확정으로 보이지 않는다", () => {
    const before = Confirm.getRescheduleView({ kind: "ACCEPTED", message: "재예약 요청이 접수되었습니다. 아직 확정되지 않았습니다." } as never, null);
    assert.equal(before.title, "예약 재조정 현황");
    assert.equal(before.actions, "STATUS");
    assert.equal(before.statusLabel, "상태 새로고침");
    assert.equal(before.newCardLabel, "변경 요청 예약");
    assert.match(before.banner.message, /접수되었습니다/);
    const processing = Confirm.getRescheduleView({ kind: "ACCEPTED", message: "m" } as never, progressOk("PROCESSING", "재예약 요청을 처리하고 있습니다. 아직 확정되지 않았습니다."));
    assert.equal(processing.title, "예약 재조정 현황");
    assert.match(processing.banner.message, /^재조정 요청이 접수되었습니다\. 재예약 요청을 처리하고 있습니다/);
  });

  it("확정(상태 재조회 CONFIRMED)일 때만 '예약 재조정 완료' + 확정된 예약, 닫기만", () => {
    const view = Confirm.getRescheduleView({ kind: "ACCEPTED", message: "m" } as never, progressOk("CONFIRMED", "재예약이 확정되었습니다."));
    assert.equal(view.title, "예약 재조정 완료");
    assert.equal(view.newCardLabel, "확정된 예약");
    assert.equal(view.actions, "CLOSE");
    assert.equal(view.banner.tone, "success");
    assert.equal(view.banner.message, "재예약이 확정되었습니다.");
  });

  it("실패: 오류 영역 하나 + 현재 상태에 맞는 버튼 (요청 실패는 닫기, 비동기 실패는 닫기 + 재조정 목록)", () => {
    const requestFailed = Confirm.getRescheduleView({ kind: "FAILED", message: "이미 재예약했거나", showList: true } as never, null);
    assert.equal(requestFailed.banner.tone, "error");
    assert.equal(requestFailed.actions, "CLOSE");
    const asyncFailed = Confirm.getRescheduleView({ kind: "ACCEPTED", message: "m" } as never, progressOk("FAILED", "재예약이 확정되지 않았습니다."));
    assert.equal(asyncFailed.title, "예약 재조정 현황");
    assert.equal(asyncFailed.banner.tone, "error");
    assert.equal(asyncFailed.banner.showList, true);
    assert.equal(asyncFailed.actions, "CLOSE");
  });

  it("결과 불명: 요청 버튼 없이 '현재 상태 확인'만, 상태 조회 실패도 배너 하나", () => {
    const uncertain = Confirm.getRescheduleView({ kind: "UNCERTAIN", message: "결과를 확인하지 못했습니다" } as never, null);
    assert.equal(uncertain.actions, "STATUS");
    assert.equal(uncertain.statusLabel, "현재 상태 확인");
    const lookupFailed = Confirm.getRescheduleView({ kind: "ACCEPTED", message: "m" } as never, { ok: false, reason: "ERROR", message: "상태를 확인하지 못했습니다." } as never);
    assert.equal(lookupFailed.banner.tone, "warning");
    assert.match(lookupFailed.banner.message, /접수되었지만 현재 상태를 확인하지 못했습니다/);
    assert.equal(lookupFailed.actions, "STATUS");
  });
});

describe("toRequestFailurePhase", () => {
  const failure = (reason: string, cause?: string) =>
    ({ ok: false, reason, message: "서버 메시지", ...(cause ? { request: { cause, status: null, code: null } } : {}) }) as never;

  it("네트워크·응답 형식·5xx·처리 중 중복은 결과 불명 (다시 요청 유도 안 함)", () => {
    for (const [reason, cause] of [["REQUEST_FAILED", "NETWORK"], ["REQUEST_FAILED", "INVALID_RESPONSE"], ["REQUEST_FAILED", "SERVER_ERROR"], ["DUPLICATE_REQUEST", undefined]] as const) {
      const phase = Confirm.toRequestFailurePhase(failure(reason, cause));
      assert.equal(phase.kind, "UNCERTAIN", `${reason} ${cause}`);
    }
    assert.match(Confirm.toRequestFailurePhase(failure("REQUEST_FAILED", "NETWORK")).message, /다시 요청하지 말고/);
  });

  it("409·404·403·후보 확인 실패는 확실한 실패, 409·404는 목록 확인 안내", () => {
    const conflict = Confirm.toRequestFailurePhase(failure("REQUEST_FAILED", "CONFLICT"));
    assert.equal(conflict.kind, "FAILED");
    assert.match(conflict.message, /이미 재예약했거나/);
    if (conflict.kind === "FAILED") assert.equal(conflict.showList, true);
    assert.equal(Confirm.toRequestFailurePhase(failure("REQUEST_FAILED", "NOT_FOUND")).kind, "FAILED");
    const forbidden = Confirm.toRequestFailurePhase(failure("REQUEST_FAILED", "FORBIDDEN"));
    assert.equal(forbidden.kind, "FAILED");
    assert.equal(forbidden.message, "서버 메시지");
    assert.equal(Confirm.toRequestFailurePhase(failure("CANDIDATE_REJECTED")).kind, "FAILED");
    assert.equal(Confirm.toRequestFailurePhase(failure("UNAUTHORIZED")).kind, "FAILED");
  });

  it("SESSION_CHANGED(다른 탭 계정 변경)는 확실한 실패: 서버의 전용 안내 그대로, 목록 안내·재요청 없음", () => {
    const phase = Confirm.toRequestFailurePhase(failure("SESSION_CHANGED"));
    assert.deepEqual(phase, { kind: "FAILED", message: "서버 메시지", showList: false });
    assert.equal(Confirm.getRescheduleView(phase, null).actions, "CLOSE");
  });

  it("재조정 요청에 렌더링 시점 로그인 세션을 함께 보낸다 (/auth/session에서 새로 읽은 값이 아님)", () => {
    const source = readFileSync(new URL("../../src/features/referrals/components/ApiRescheduleConfirm.tsx", import.meta.url), "utf8");
    assert.match(source, /const renderedLoginSession = useRenderedLoginSession\(\);/);
    assert.match(source, /requestRescheduleAction\(target\.referralId, slotId, renderedLoginSession\)/);
    assert.doesNotMatch(source, /\/auth\/session/);
  });
});

describe("toRescheduleProgress (접수 ≠ 확정)", () => {
  const cases: [string, unknown, string][] = [
    ["PENDING", { status: "REQUESTED", failureReason: null }, "PROCESSING"],
    ["PENDING", { status: "HELD", failureReason: null }, "PROCESSING"],
    ["CONFIRMED", { status: "CONFIRMED", failureReason: null }, "CONFIRMED"],
    ["PENDING", { status: "FAILED", failureReason: "SLOT_CONFLICT" }, "FAILED"],
    ["PENDING", { status: "BLOCKED", failureReason: "EQUIPMENT_FAILURE" }, "FAILED"],
    ["FAILED", null, "FAILED"],
    ["NEEDS_RESCHEDULE", { status: "BLOCKED", failureReason: "EQUIPMENT_FAILURE" }, "NEEDS_RESCHEDULE"],
    ["CONFIRMED", { status: "HELD", failureReason: null }, "OTHER"],
    ["CANCELED", null, "OTHER"],
  ];
  for (const [referralStatus, reservation, stage] of cases) {
    it(`${referralStatus} + ${reservation ? (reservation as { status: string }).status : "예약 없음"} → ${stage}`, () => {
      const result = progress.toRescheduleProgress(referralStatus as never, reservation as never);
      assert.equal(result.stage, stage);
      assert.ok(result.message.length > 0);
    });
  }
});

describe("SlotSearch 모드 분리", () => {
  const organizations = [{ id: EXAM_ORG, name: "A 영상센터" }];

  it("API 재조정 모드: 안내 배너 + 검사 종류 고정(CT), Mock 배너·미연결 안내 없음", () => {
    const html = renderToStaticMarkup(createElement(SlotSearch, { dataSource: "api", organizations, apiReschedule: { ok: true, target } }));
    assert.match(html, /기존 예약을 변경할 새로운 검사 슬롯을 선택해 주세요/);
    assert.match(html, /흉부 CT \(CT\)/);
    assert.doesNotMatch(html, /아직 이 화면에 연결되지 않았습니다/);
    assert.doesNotMatch(html, /재조정 대상 예약을 찾을 수 없습니다/);
    assert.match(html, /<select id="slot-exam-type"[^>]*disabled=""[^>]*>[\s\S]*?<option value="CT" selected="">/);
  });

  it("API 재조정 대상 조회 실패: 서버 안내 + 일반 검색 (Mock 대상 없음)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotSearch, { dataSource: "api", organizations, apiReschedule: { ok: false, reason: "NOT_RESCHEDULABLE", message: "재조정이 필요한 상태의 의뢰가 아닙니다." } }),
    );
    assert.match(html, /재조정이 필요한 상태의 의뢰가 아닙니다\. 일반 검사 슬롯 검색으로 표시합니다/);
    assert.doesNotMatch(html, /기존 예약을 변경할 새로운 검사 슬롯을/);
  });

  it("일반 API 검색(재조정 없음)·Mock 모드는 기존 그대로", () => {
    const api = renderToStaticMarkup(createElement(SlotSearch, { dataSource: "api", organizations }));
    assert.doesNotMatch(api, /기존 예약을 변경할/);
    // 검사 유형은 고정하지 않는다 (지원 장비 칸은 장비 목록을 넘기지 않아 비활성일 수 있다)
    assert.doesNotMatch(api, /<select id="slot-exam-type"[^>]*disabled=""/);
    const notLinked = renderToStaticMarkup(createElement(SlotSearch, { dataSource: "api", organizations, isApiRescheduleRequested: true }));
    assert.match(notLinked, /아직 이 화면에 연결되지 않았습니다/);
    const mockInvalid = renderToStaticMarkup(createElement(SlotSearch, { organizations, rescheduleTarget: "INVALID" }));
    assert.match(mockInvalid, /재조정 대상 예약을 찾을 수 없습니다/);
    assert.equal(calls.includes("request"), false);
  });
});

describe("결과 불명 화면 (P1-A)", () => {
  const OTHER_SLOT = "49999999-4444-4444-8444-444444444444";
  const progress = (stage: string, slotId: string | null, status = "REQUESTED", referralStatus = "PENDING") =>
    ({ ok: true, stage, message: "상태 메시지", referralStatus, reservation: { id: "r", slotId, status, failureReason: null, startTime: "2099-01-10T10:00:00" } }) as never;
  const uncertain = { kind: "UNCERTAIN", message: "결과를 확인하지 못했습니다" } as never;

  it("uncertain 플래그가 있으면(5xx 포함) 결과 불명 단계", () => {
    const phase = Confirm.toRequestFailurePhase({ ok: false, reason: "REQUEST_FAILED", message: "m", request: { cause: "SERVER_ERROR", status: 503, code: null, uncertain: true } } as never);
    assert.equal(phase.kind, "UNCERTAIN");
  });

  it("A. 결과 불명 → 재조회: 요청한 슬롯이 처리 중이면 접수로, 확정이면 완료로 (PENDING·HELD를 확정으로 보이지 않음)", () => {
    const processing = Confirm.getRescheduleView(uncertain, progress("PROCESSING", SLOT, "HELD"), SLOT);
    assert.equal(processing.title, "예약 재조정 현황");
    assert.match(processing.banner.message, /접수되었습니다/);
    assert.equal(processing.actions, "STATUS");
    const confirmed = Confirm.getRescheduleView(uncertain, progress("CONFIRMED", SLOT, "CONFIRMED", "CONFIRMED"), SLOT);
    assert.equal(confirmed.title, "예약 재조정 완료");
  });

  it("B. 결과 불명 → 재조회해도 아직 재조정 필요: 실패로 확정하지 않고 결과 불명 유지 + 다시 확인 (요청 버튼 없음)", () => {
    const view = Confirm.getRescheduleView(uncertain, progress("NEEDS_RESCHEDULE", null, "BLOCKED", "NEEDS_RESCHEDULE"), SLOT);
    assert.equal(view.banner.tone, "warning");
    assert.match(view.banner.message, /실패로 확정하지 않았습니다/);
    assert.match(view.banner.message, /재조정 목록에서 다시 요청할 수 있습니다/);
    assert.equal(view.actions, "STATUS");
    const steps = Confirm.getRescheduleStatusSteps(uncertain, progress("NEEDS_RESCHEDULE", null, "BLOCKED", "NEEDS_RESCHEDULE"));
    assert.equal(steps[2].state, "warning", "확정 실패가 아니라 확인 필요");
    // 접수가 확인된 뒤(ACCEPTED)에 재조정 필요로 돌아간 것은 기존과 같이 실패
    assert.equal(Confirm.getRescheduleView({ kind: "ACCEPTED", message: "m" } as never, progress("NEEDS_RESCHEDULE", null, "BLOCKED", "NEEDS_RESCHEDULE"), SLOT).banner.tone, "error");
  });

  it("C. 다른 예약(다른 슬롯)으로 바뀌어 있으면 그 상태를 안내하고 닫기만 (요청 다시 보내지 않음)", () => {
    for (const phase of [uncertain, { kind: "ACCEPTED", message: "m" } as never]) {
      for (const [stage, status] of [["PROCESSING", "REQUESTED"], ["CONFIRMED", "CONFIRMED"]] as const) {
        const view = Confirm.getRescheduleView(phase, progress(stage, OTHER_SLOT, status, stage === "CONFIRMED" ? "CONFIRMED" : "PENDING"), SLOT);
        assert.equal(view.banner.tone, "warning");
        assert.match(view.banner.message, /요청한 슬롯이 아닌 다른/);
        assert.equal(view.actions, "CLOSE");
        assert.notEqual(view.title, "예약 재조정 완료");
      }
    }
  });

  it("D. 재조회 실패: 결과 불명 유지 + 상태 다시 확인", () => {
    const view = Confirm.getRescheduleView(uncertain, { ok: false, reason: "ERROR", message: "상태를 확인하지 못했습니다." } as never, SLOT);
    assert.equal(view.banner.tone, "warning");
    assert.equal(view.actions, "STATUS");
  });

  it("화면: 결과 불명에서도 자동 상태 확인(조회만), 요청 버튼은 다시 열지 않는다", () => {
    const source = readFileSync(new URL("../../src/features/referrals/components/ApiRescheduleConfirm.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.match(source, /const accepted = phase\.kind === "ACCEPTED" \|\| phase\.kind === "UNCERTAIN";/);
    assert.match(source, /getRescheduleView\(phase, progress, slotId\)/);
    assert.match(source, /실패 뒤에도 같은 화면에서 다시 요청하지 않는다 \(submittingRef를 풀지 않는다\)/);
  });

  it("재조정 접수 뒤 refresh()로 대상 의뢰가 재조정 필요가 아니게 돼도 이 화면의 재조정 대상을 유지한다 (새 검사 의뢰로 바뀌지 않음, 기존 문제 수정)", () => {
    const source = readFileSync(new URL("../../src/features/slots/components/SlotSearch.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.match(source, /const \[heldApiTarget, setHeldApiTarget\] = useState\(latestApiTarget\);/);
    assert.match(source, /const apiTarget = latestApiTarget \?\? heldApiTarget;/);
    assert.match(source, /\{isApi && apiReschedule && !apiReschedule\.ok && !heldApiTarget && \(/);
  });
});
