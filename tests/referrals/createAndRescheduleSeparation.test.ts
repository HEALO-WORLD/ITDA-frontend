import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 재조정 대화상자의 세부 검사 항목 고정·기존 예약 표시, 일반 검색의 새 검사 의뢰 화면, 두 흐름(의뢰 생성 ↔ 재조정)의 분리.
 * Server Function은 가짜로 바꾸고 호출만 기록한다 (렌더링만으로 POST·조회가 나가지 않는지 확인).
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const MRI_A = "a0000000-0000-4000-8000-00000000000b";
const REFERRAL = "88888888-8888-4888-8888-888888888888";
const EXAM_MRI = "cccccccc-0000-4000-8000-000000000002";

const calls: string[] = [];
const organizations = [
  { id: ORG_A, name: "A 영상센터" },
  { id: ORG_B, name: "B 영상의학과" },
];
const EXAM_MRI_SPINE = "cccccccc-0000-4000-8000-000000000003";
const EXAM_CT = "cccccccc-0000-4000-8000-000000000001";
/** 세부 검사 항목 선택지 (물리 장비가 아니라 ExamType) */
const examTypeOptions = [
  { id: EXAM_CT, name: "흉부 CT", examType: "CT" as const, organizationIds: [ORG_A] },
  { id: EXAM_MRI, name: "뇌 MRI", examType: "MRI" as const, organizationIds: [ORG_A, ORG_B] },
  { id: EXAM_MRI_SPINE, name: "척추 MRI", examType: "MRI" as const, organizationIds: [ORG_B] },
];
const target = {
  referralId: REFERRAL,
  examTypeId: EXAM_MRI,
  examTypeName: "뇌 MRI",
  modality: "MRI" as const,
  currentReservation: { status: "BLOCKED" as const, startTime: "2099-01-05T10:00:00", endTime: "2099-01-05T10:30:00", examInstitutionId: ORG_A, equipmentName: "MRI 1호기" },
};

let dialog: typeof import("@/features/notifications/components/RescheduleSearchDialog");
let CreateForm: typeof import("@/features/referrals/components/ApiReferralCreateForm").default;

before(async () => {
  mock.module("@/features/referrals/createActions", {
    namedExports: {
      createReferralAction: async () => (calls.push("create"), { ok: false }),
      loadReferralProgressAction: async () => (calls.push("progress"), { ok: false }),
    },
  });
  mock.module("@/features/referrals/rescheduleActions", {
    namedExports: {
      checkRescheduleCandidateAction: async () => (calls.push("check"), { ok: false }),
      requestRescheduleAction: async () => (calls.push("reschedule"), { ok: false }),
    },
  });
  mock.module("@/features/referrals/rescheduleProgressActions", { namedExports: { loadRescheduleProgressAction: async () => ({ ok: false }) } });
  mock.module("@/features/notifications/rescheduleSearchActions", { namedExports: { loadRescheduleSearchAction: async () => (calls.push("load"), { ok: false }) } });
  mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {} }), unstable_rethrow: () => {} } });
  dialog = await import("@/features/notifications/components/RescheduleSearchDialog");
  CreateForm = (await import("@/features/referrals/components/ApiReferralCreateForm")).default;
});

describe("재조정 대화상자: 세부 검사 항목", () => {
  it("검사 유형(MRI)·세부 검사 항목(뇌 MRI)이 기존 의뢰 값으로 고정되고, 기관·날짜·시간대는 바꿀 수 있다", () => {
    const html = renderToStaticMarkup(createElement(dialog.ApiRescheduleSlotSearch, { organizations, examTypeOptions, reschedule: { ok: true, target } }));
    assert.match(html, /<select id="slot-exam-type"[^>]*disabled=""[\s\S]*?<option value="MRI" selected="">/);
    assert.match(html, /<label[^>]*for="slot-exam-item"[^>]*>세부 검사 항목/);
    // 고정: 기존 의뢰의 항목 하나만 (같은 MRI라도 척추 MRI는 고를 수 없다)
    assert.match(html, new RegExp(`<select id="slot-exam-item"[^>]*disabled=""[^>]*><option value="${EXAM_MRI}" selected="">뇌 MRI</option></select>`));
    assert.doesNotMatch(html, /척추 MRI|흉부 CT/);
    assert.doesNotMatch(html, /<select id="slot-organization"[^>]*disabled=""/);
    assert.match(html, /예약 가능한 슬롯만 보기/);
    // 물리 장비 선택 칸은 없다
    assert.doesNotMatch(html, /slot-equipment|지원 장비/);
    // 페이지용 배너(다른 화면 링크)는 대화상자에서 숨긴다
    assert.doesNotMatch(html, /재조정 화면으로 돌아가기/);
  });

  it("검사 유형 목록에서 이름을 찾지 못해도 의뢰의 examTypeId로 고정한다 (이름을 만들지 않고 안내 문구)", () => {
    const html = renderToStaticMarkup(
      createElement(dialog.ApiRescheduleSlotSearch, { organizations, examTypeOptions: null, reschedule: { ok: true, target: { ...target, examTypeName: null, modality: null } } }),
    );
    assert.match(html, new RegExp(`<select id="slot-exam-item"[^>]*disabled=""[^>]*><option value="${EXAM_MRI}" selected="">기존 의뢰의 검사 항목</option>`));
  });

  it("기존 예약: 예약번호·기존 검사기관·기존 검사 유형·기존 세부 검사 항목·기존 검사일시·현재 상태 (장비 칸 없음)", () => {
    const summary = { reservationNumber: "RS-1", copyable: false, institution: "A 영상센터", modality: "MRI", examTypeName: "뇌 MRI", scheduledAt: "2099-01-05T10:00" };
    const html = renderToStaticMarkup(createElement(dialog.ExistingReservation, { summary }));
    for (const label of ["예약번호", "기존 검사기관", "기존 검사 유형", "기존 세부 검사 항목", "기존 검사일시", "현재 상태"]) assert.ok(html.includes(label), label);
    assert.match(html, /기존 검사 유형<\/dt><dd[^>]*>MRI/);
    assert.match(html, /기존 세부 검사 항목<\/dt><dd[^>]*>뇌 MRI/);
    assert.doesNotMatch(html, /검사 장비/);
    const unknown = renderToStaticMarkup(createElement(dialog.ExistingReservation, { summary: { ...summary, modality: null, examTypeName: null } }));
    assert.match(unknown, /기존 세부 검사 항목<\/dt><dd[^>]*>확인 불가/);
    assert.equal(calls.length, 0);
  });
});

describe("일반 검색: 새 검사 의뢰", () => {
  const slot = {
    id: "44444444-4444-4444-8444-444444444444",
    organizationId: ORG_A,
    organizationName: "A 영상센터",
    equipmentId: MRI_A,
    equipmentName: "MRI 1호기",
    examType: "MRI" as const,
    examTypeId: EXAM_MRI,
    examTypeName: "뇌 MRI",
    startAt: "2099-01-10T10:00",
    endAt: "2099-01-10T10:30",
    startsAt: "2099-01-10T10:00:00+09:00",
    endsAt: "2099-01-10T10:30:00+09:00",
    isAvailable: true,
    status: "AVAILABLE" as const,
  };

  it("선택한 슬롯(기관·검사 유형·세부 검사 항목·장비·날짜·시간)과 환자 이름 입력, 렌더링만으로 POST 없음", () => {
    const html = renderToStaticMarkup(createElement(CreateForm, { slot, onCancel: () => {} }));
    for (const text of ["A 영상센터", "MRI 1호기", "뇌 MRI", "2099년 1월 10일", "10:00 ~ 10:30", "환자 이름", "의뢰·예약 요청"]) assert.ok(html.includes(text), text);
    assert.match(html, /<dt[^>]*>세부 검사 항목<\/dt><dd[^>]*>뇌 MRI<\/dd>/);
    assert.match(html, /<dt[^>]*>검사 장비<\/dt><dd[^>]*>MRI 1호기<\/dd>/);
    assert.match(html, /maxLength="20"/);
    assert.doesNotMatch(html, /아직 연동되지 않았습니다/);
    assert.equal(calls.includes("create"), false);
  });

  it("SlotSearch: 일반 API 모달은 ApiReferralCreateForm, 재조정 모달은 ApiRescheduleConfirm (미연동 안내 제거)", () => {
    const fullSource = readFileSync("src/features/slots/components/SlotSearch.tsx", "utf8");
    assert.doesNotMatch(fullSource, /실제 의뢰·예약 요청 기능은 아직 연동되지 않았습니다/);
    // PC 재조정 단계 모달(한 모달 3단계)은 같은 ApiRescheduleConfirm을 inline으로 쓴다 (의뢰 생성 폼은 쓰지 않는다)
    const wizardStart = fullSource.indexOf("if (isWizard && rescheduleWizard) {");
    const mainStart = fullSource.indexOf("<div className={embedded ? \"flex flex-col gap-5\" : \"flex flex-col gap-8\"}>");
    assert.ok(wizardStart > 0 && mainStart > wizardStart);
    const wizardSource = fullSource.slice(wizardStart, mainStart);
    assert.match(wizardSource, /<ApiRescheduleConfirm[\s\S]*?inline/);
    assert.doesNotMatch(wizardSource, /<ApiReferralCreateForm/);
    // 기존 모달 분기 (모바일·일반 검색): API 재조정 → API 의뢰 생성 → Mock 순서
    const source = fullSource.slice(mainStart);
    const rescheduleModal = source.indexOf("<ApiRescheduleConfirm");
    const createModal = source.indexOf("<ApiReferralCreateForm");
    const mockModal = source.indexOf("<RescheduleSlotConfirm");
    assert.ok(rescheduleModal > 0 && createModal > rescheduleModal && mockModal > createModal, "API 재조정 → API 의뢰 생성 → Mock 순서의 분기");
  });
});

describe("의뢰 생성 ↔ 재조정 분리", () => {
  const importsOf = (path: string) => [...readFileSync(path, "utf8").matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  it("의뢰 생성 화면은 createActions만, 재조정 화면은 rescheduleActions만 쓴다", () => {
    const create = importsOf("src/features/referrals/components/ApiReferralCreateForm.tsx");
    assert.ok(create.includes("../createActions"));
    assert.equal(create.some((path) => path.includes("reschedule")), false);
    const reschedule = importsOf("src/features/referrals/components/ApiRescheduleConfirm.tsx");
    assert.ok(reschedule.includes("../rescheduleActions"));
    assert.equal(reschedule.some((path) => path.includes("create")), false);
  });

  it("기존 재조정 Server Function(checkRescheduleCandidateAction·requestRescheduleAction)이 그대로 있다", () => {
    const source = readFileSync("src/features/referrals/rescheduleActions.ts", "utf8");
    assert.match(source, /export async function checkRescheduleCandidateAction\(referralId: unknown, slotId: unknown\)/);
    // STEP 3-2-2B-1: 렌더링 시점 로그인 세션(expectedLoginSession)을 마지막 인자로 받는다
    assert.match(source, /export async function requestRescheduleAction\(referralId: unknown, slotId: unknown, expectedLoginSession\?: unknown\)/);
    assert.match(source, /\/api\/v1\/referrals|requestReschedule\(/);
  });

  it("의뢰 생성은 렌더링 시점 로그인 세션을 함께 보내고, SESSION_CHANGED면 입력·요청을 잠근다 (STEP 3-2-2B-2)", () => {
    const action = readFileSync("src/features/referrals/createActions.ts", "utf8");
    assert.match(action, /export async function createReferralAction\(input: unknown, expectedLoginSession\?: unknown\)/);
    assert.match(action, /submitCreateReferral\(input, expectedLoginSession\)/);
    const form = readFileSync("src/features/referrals/components/ApiReferralCreateForm.tsx", "utf8");
    assert.match(form, /const renderedLoginSession = useRenderedLoginSession\(\);/);
    assert.match(form, /createReferralAction\(\{ \.\.\.content, idempotencyKey, confirmExisting: tracker\.isLocked \}, renderedLoginSession\)/);
    assert.match(form, /const sessionChanged = failure\?\.reason === "SESSION_CHANGED";/);
    assert.match(form, /if \(lock\.running \|\| created \|\| sessionChanged\) return;/);
    assert.match(form, /type="submit"\s+disabled=\{pending \|\| sessionChanged\}/);
    assert.doesNotMatch(form, /\/auth\/session/);
  });
});
