import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ApiExamSlot } from "@/features/slots/apiSlots";

/**
 * 화면 첫 렌더링(서버 렌더링 HTML) 확인: Mock 모드 회귀, API 모드 안내, 선택 버튼 동작.
 * 선택 버튼은 SlotSearchTable이 돌려준 요소의 onClick을 직접 불러 확인한다 (이 저장소에는 DOM 테스트 도구가 없다).
 * 의뢰 생성·재조정 모달로 이어지는 화면 흐름은 tests/referrals와 Playwright(E2E)에서 확인한다.
 */

process.env.NEXT_PUBLIC_API_MODE = "mock";

const { default: SlotSearch } = await import("@/features/slots/components/SlotSearch");
const { default: SlotSearchTable } = await import("@/features/slots/components/SlotSearchTable");

const ORGS = [{ id: "11111111-1111-4111-8111-111111111111", name: "A 영상센터" }];

const SLOT: ApiExamSlot = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  organizationId: ORGS[0].id,
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
};
/** 서버 상태 HELD (다른 요청이 먼저 잡은 슬롯) → 예약 불가 */
const HELD_SLOT: ApiExamSlot = { ...SLOT, id: "aaaaaaaa-0000-4000-8000-000000000002", status: "HELD", isAvailable: false };

type ButtonProps = { disabled?: boolean; title?: string; onClick?: () => void; children?: ReactNode };

/** 요소 트리에서 button 요소를 순서대로 모은다 (함수 컴포넌트는 펼치지 않는다: SlotStatusBadge 등에는 버튼이 없다) */
function collectButtons(node: ReactNode, found: ReactElement<ButtonProps>[] = []): ReactElement<ButtonProps>[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, found);
  } else if (isValidElement<ButtonProps>(node)) {
    if (node.type === "button") found.push(node);
    collectButtons(node.props.children, found);
  }
  return found;
}

describe("SlotSearch 첫 화면", () => {
  it("Mock 모드(기본): 기존 문구·개발용 예시 데이터 표시·'전체 기간' 그대로", () => {
    const html = renderToStaticMarkup(createElement(SlotSearch, { organizations: ORGS }));
    assert.match(html, /개발용 예시 데이터/);
    assert.match(html, /검색 조건을 선택한 후 검색 버튼을 눌러 주세요\.<\/p>/);
    assert.match(html, /전체 기간/);
    assert.doesNotMatch(html, /오늘부터 31일/);
    assert.match(html, /슬롯 검색/);
    assert.match(html, /예약 가능한 슬롯만 보기/);
  });

  it("API 모드: Mock 표시 없음, 검색 범위(오늘부터 31일) 안내", () => {
    const html = renderToStaticMarkup(createElement(SlotSearch, { organizations: ORGS, dataSource: "api" }));
    assert.doesNotMatch(html, /개발용 예시 데이터/);
    assert.match(html, /날짜를 선택하지 않으면 오늘부터 31일 동안의 슬롯을 검색합니다/);
    assert.match(html, /오늘부터 31일/);
    assert.doesNotMatch(html, /전체 기간/);
    // 같은 검색 조건 구성 (검사 유형·협력 검사기관·검사 날짜·시간대·예약 가능만 보기)
    for (const label of ["검사 유형", "협력 검사기관", "검사 날짜", "시간대", "예약 가능한 슬롯만 보기", "A 영상센터"]) {
      assert.ok(html.includes(label), label);
    }
  });

  // page.tsx: 재조정 쿼리가 있어도 referrals 기능이 API 대상이 아니면(재예약 Server Function 사용 불가)
  // 대상 의뢰를 조회하지 않고 isApiRescheduleRequested로 이 안내만 요청한다. referrals가 켜져 있으면 apiReschedule로 실제 재조정을 한다
  it("API 모드 + referrals 기능 비활성(isApiRescheduleRequested): 재예약 미연동 안내를 보이고 Mock 재조정 배너는 보이지 않는다", () => {
    const html = renderToStaticMarkup(createElement(SlotSearch, { organizations: ORGS, dataSource: "api", isApiRescheduleRequested: true }));
    assert.match(html, /재조정 대체 슬롯 선택\(재예약 요청\)은 아직 이 화면에 연결되지 않았습니다/);
    assert.match(html, /일반 검사 슬롯 검색으로 표시합니다/);
    assert.doesNotMatch(html, /기존 예약을 변경할 새로운 검사 슬롯을 선택해 주세요/);
  });

  it("API 모드 일반 검색(재조정 쿼리 없음): 재예약 미연동 안내를 보이지 않는다", () => {
    const html = renderToStaticMarkup(createElement(SlotSearch, { organizations: ORGS, dataSource: "api" }));
    assert.doesNotMatch(html, /아직 이 화면에 연결되지 않았습니다/);
  });
});

describe("SlotSearchTable 선택 버튼", () => {
  const noop = () => {};

  it("Mock 모드: 예약 가능한 슬롯의 예약 요청 버튼은 활성", () => {
    const html = renderToStaticMarkup(createElement(SlotSearchTable, { slots: [SLOT], onRequestReservation: noop }));
    assert.match(html, />예약 요청<\/button>/);
    assert.doesNotMatch(html, /disabled=""/);
  });

  // SlotSearch(API 모드)는 실제 의뢰 생성·재예약이 연결되어 비활성 이유(actionDisabledReason)를 넘기지 않는다.
  // 선택 버튼은 슬롯 상태로만 활성·비활성이 갈리고, 누르면 슬롯 UUID를 넘겨 의뢰 생성(ApiReferralCreateForm)을 연다
  it("API 모드: 예약 가능(AVAILABLE) 슬롯의 예약 요청 버튼은 활성이고, 누르면 그 슬롯 UUID를 넘긴다", () => {
    const requested: string[] = [];
    const buttons = collectButtons(SlotSearchTable({ slots: [SLOT], onRequestReservation: (slotId) => requested.push(slotId) }));
    // 좁은 화면 카드 + 넓은 화면 표 (같은 슬롯, 같은 버튼)
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.equal(button.props.disabled, false);
      assert.equal(button.props.title, undefined);
      assert.equal(button.props.children, "예약 요청");
      button.props.onClick?.();
    }
    assert.deepEqual(requested, [SLOT.id, SLOT.id]);

    const html = renderToStaticMarkup(createElement(SlotSearchTable, { slots: [SLOT], onRequestReservation: noop }));
    assert.doesNotMatch(html, /disabled=""/);
    assert.match(html, /A 영상센터/);
    assert.match(html, /흉부 CT/);
  });

  it("API 모드: 예약할 수 없는 슬롯(HELD)의 버튼만 비활성 (다른 슬롯 버튼은 그대로 활성)", () => {
    const buttons = collectButtons(SlotSearchTable({ slots: [SLOT, HELD_SLOT], onRequestReservation: noop }));
    // 카드 2개 + 표 2줄
    assert.deepEqual(
      buttons.map((button) => button.props.disabled),
      [false, true, false, true],
    );
  });

  it("결과 표에 장비 이름 열이 없다 (장비 ID는 슬롯 데이터에만 남는다)", () => {
    const html = renderToStaticMarkup(createElement(SlotSearchTable, { slots: [SLOT], onRequestReservation: noop }));
    assert.doesNotMatch(html, /CT-1/);
    assert.doesNotMatch(html, />장비</);
  });
});
