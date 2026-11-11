import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import SlotTimeCards from "@/features/slots/components/SlotTimeCards";
import { countAvailableSlotsByDate, groupSlotCards } from "@/features/slots/slotResultGroups";
import type { ExamSlot } from "@/features/slots/types";

/**
 * PC 슬롯 검색 결과의 시간 카드: 시간 버튼이 원본 slotId를 그대로 넘기는지, 건수·예약 불가 표시·날짜 지정 안내.
 * SlotTimeCards는 상태(hook)가 없어 함수로 그려 버튼의 onClick을 직접 부른다 (DOM 없이)
 */

const DATE = "2026-11-10";
const slot = (id: string, time: string, patch: Partial<ExamSlot> = {}): ExamSlot => ({
  id,
  organizationId: "org-a",
  organizationName: "A 영상센터",
  equipmentId: "mri-1",
  equipmentName: "MRI 1호기",
  examType: "MRI",
  examTypeId: "brain",
  examTypeName: "뇌 MRI",
  startAt: `${DATE}T${time}`,
  isAvailable: true,
  ...patch,
});

const SLOTS = [
  slot("slot-0900", "09:00"),
  slot("slot-0930-mri2", "09:30", { equipmentId: "mri-2", equipmentName: "MRI 2호기" }),
  slot("slot-1000", "10:00"),
  slot("slot-1030-spine", "10:30", { examTypeId: "spine", examTypeName: "척추 MRI" }),
  slot("slot-1100-closed", "11:00", { isAvailable: false }),
];

type Props = Parameters<typeof SlotTimeCards>[0];
const props = (patch: Partial<Props> = {}): Props => ({
  date: DATE,
  cards: groupSlotCards(SLOTS, DATE),
  onRequestReservation: () => {},
  actionLabel: "예약 요청",
  ...patch,
});

/** 그린 트리에서 data-slot-id가 있는 버튼을 모두 찾는다 */
function findSlotButtons(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(findSlotButtons);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const own = element.type === "button" && element.props["data-slot-id"] ? [element] : [];
  return [...own, ...findSlotButtons(element.props.children as ReactNode)];
}

describe("시간 카드 (PC 슬롯 검색 결과)", () => {
  it("시간 버튼을 누르면 그 시간의 원본 slotId를 넘긴다 (카드로 묶여도 바뀌지 않는다)", () => {
    const calls: string[] = [];
    const tree = SlotTimeCards(props({ onRequestReservation: (id) => calls.push(id) }));
    const buttons = findSlotButtons(tree);
    assert.deepEqual(
      buttons.map((button) => button.props["data-slot-id"]),
      ["slot-0900", "slot-1000", "slot-1100-closed", "slot-0930-mri2", "slot-1030-spine"],
    );
    for (const button of buttons) (button.props.onClick as () => void)();
    assert.deepEqual(calls, buttons.map((button) => button.props["data-slot-id"]));
  });

  it("같은 기관의 다른 장비·다른 세부 검사 항목은 다른 카드, 예약 불가 시간은 비활성", () => {
    const html = renderToStaticMarkup(createElement(SlotTimeCards, props()));
    const cards = html.split('<li class="rounded-xl').slice(1);
    assert.equal(cards.length, 3);
    assert.match(cards[0], /MRI 1호기[\s\S]*뇌 MRI|뇌 MRI[\s\S]*MRI 1호기/);
    assert.match(cards[0], /data-slot-id="slot-0900"[\s\S]*data-slot-id="slot-1000"/);
    assert.match(cards[1], /MRI 2호기/);
    assert.match(cards[2], /척추 MRI/);
    assert.match(html, /<button type="button" data-slot-id="slot-1100-closed" disabled=""[^>]*aria-label="11:00 [^"]*예약 마감, 선택할 수 없음"/);
    assert.match(html, /aria-label="09:00 A 영상센터 MRI 1호기 MRI 뇌 MRI 2026년 11월 10일 화요일 예약 요청"/);
  });

  it("머리글 건수 = 그날 예약 가능한 슬롯 수 (달력 건수와 같다)", () => {
    const html = renderToStaticMarkup(createElement(SlotTimeCards, props()));
    const expected = countAvailableSlotsByDate(SLOTS)[DATE];
    assert.equal(expected, 4);
    assert.match(html, new RegExp(`${expected}건</strong>`));
  });

  it("고른 날짜에 예약 가능한 슬롯이 없으면 빈 결과 안내 (카드·버튼 없음)", () => {
    const html = renderToStaticMarkup(createElement(SlotTimeCards, props({ cards: groupSlotCards([slot("closed", "09:00", { isAvailable: false })], DATE) })));
    assert.match(html, /role="status"[^>]*>선택한 날짜에 예약 가능한 슬롯이 없습니다/);
    assert.doesNotMatch(html, /data-slot-id=/);
  });

  it("날짜 지정 검색: 다른 날짜를 보려면 검색 조건의 날짜를 해제하라는 안내", () => {
    const html = renderToStaticMarkup(createElement(SlotTimeCards, props({ lockedDate: DATE })));
    assert.match(html, /검색 조건에서 날짜\(2026-11-10\)를 지정해 이 날짜의 결과만 표시합니다/);
    assert.match(html, /해제\(날짜 선택 해제\)한 뒤 다시 검색해 주세요/);
  });

  it("재조정 모드 문구: 시간 버튼 이름 끝이 '대체 슬롯 선택'", () => {
    const html = renderToStaticMarkup(createElement(SlotTimeCards, props({ actionLabel: "대체 슬롯 선택" })));
    assert.match(html, /aria-label="09:00 [^"]* 대체 슬롯 선택"/);
  });
});
