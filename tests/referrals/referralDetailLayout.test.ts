import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 의뢰 상세 대화상자(API 모드) 배치: [검사 정보 | 예약 정보] 2열(좁은 화면 1열) + 상태 변경 이력 전체 너비 + 하단 닫기.
 * 조회 로직(loadReferralDetailAction)은 가짜로 바꾸고 화면 배치만 확인한다 (데이터·상태 표시는 기존과 같다).
 */

let Detail: typeof import("@/features/referrals/components/ReferralApiDetailButton");

before(async () => {
  mock.module("@/features/referrals/actions", { namedExports: { loadReferralDetailAction: async () => ({ ok: false, reason: "ERROR", message: "x", code: null }) } });
  Detail = await import("@/features/referrals/components/ReferralApiDetailButton");
});

type Reservation = Extract<import("@/features/referrals/server").ReferralDetail["reservation"], { state: "ok" }>;
const reservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  state: "ok",
  attemptNo: 1,
  reservationStatus: "CONFIRMED",
  failureReason: null,
  startTime: "2099-01-10T10:00:00",
  endTime: "2099-01-10T10:30:00",
  confirmedAt: "2099-01-01T09:00:00",
  endedAt: null,
  examInstitution: { state: "ok", value: "ITDA 중앙영상센터" },
  equipment: { state: "ok", value: "MRI 1호기" },
  ...overrides,
});
const history = (reason: string, occurredAt: string, toStatus = "PENDING", fromStatus: string | null = null) => ({ fromStatus, toStatus, reason, occurredAt }) as never;
const detail = (overrides: Record<string, unknown> = {}) =>
  ({
    referralId: "88888888-8888-4888-8888-888888888888",
    patientName: "홍길동",
    referralStatus: "CONFIRMED",
    reservation: reservation(),
    histories: [history("REFERRAL_CREATED", "2099-01-01T08:00:00"), history("RESERVATION_CONFIRMED", "2099-01-01T09:00:00", "CONFIRMED", "PENDING")],
    ...overrides,
  }) as never;
const render = (value: unknown, examTypeLabel = "ITDA 뇌 CT 정밀검사 (CT)") =>
  renderToStaticMarkup(createElement(Detail.ReferralDetailContent, { detail: value as never, examTypeLabel }));

describe("의뢰 상세 배치", () => {
  it("일반·확정: 검사 정보 | 예약 정보 2열(lg), 좁은 화면 1열, 이력은 그 아래 전체 너비", () => {
    const html = render(detail());
    assert.match(html, /^<div class="flex flex-col gap-5"><div class="grid grid-cols-1 gap-5 lg:grid-cols-2">/);
    const order = ["검사 정보", "예약 정보", "상태 변경 이력"].map((title) => html.indexOf(`aria-label="${title}"`));
    assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2]);
    // 이력은 2열 grid 밖 (전체 너비)
    const gridEnd = html.indexOf('aria-label="상태 변경 이력"');
    assert.equal(html.slice(0, gridEnd).split('class="h-full min-w-0 rounded-xl border border-line bg-white px-5 py-5"').length - 1, 3);
    for (const label of ["환자명", "검사 유형", "검사기관", "검사 장비", "검사 일시", "의뢰 요청 일시", "현재 예약 상태", "예약 시도", "예약 확정 시각", "종료 시각"]) {
      assert.ok(html.includes(`>${label}</dt>`), label);
    }
    // 예약 정보는 반쪽 너비라 2열 (이전 4열)
    assert.match(html, /<dl class="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2"><div class="min-w-0 "><dt[^>]*>현재 예약 상태/);
    // 긴 검사 항목 이름은 단어 중간에서 끊지 않는다
    assert.match(html, /<span class="break-keep">ITDA 뇌 CT 정밀검사 \(CT\)<\/span>/);
    // 가로 스크롤을 만드는 고정 최소 폭 없음
    assert.doesNotMatch(html, /min-w-\[\d+px\]/);
  });

  it("재조정 필요(장비 장애로 BLOCKED): 실패 사유·예약 상태는 예약 정보 카드 안에 그대로", () => {
    const html = render(
      detail({
        referralStatus: "NEEDS_RESCHEDULE",
        reservation: reservation({ reservationStatus: "BLOCKED", failureReason: "EQUIPMENT_FAILURE", confirmedAt: "2099-01-01T09:00:00", endedAt: "2099-01-02T09:00:00" }),
      }),
    );
    const reservationCard = html.slice(html.indexOf('aria-label="예약 정보"'), html.indexOf('aria-label="상태 변경 이력"'));
    assert.match(reservationCard, /예약 실패 사유/);
    assert.match(reservationCard, /role="note"/);
  });

  it("예약 실패: 실패 사유와 상태 배지 유지, 예약이 없거나 조회 실패면 기존 안내 문구", () => {
    const failed = render(detail({ referralStatus: "FAILED", reservation: reservation({ reservationStatus: "FAILED", failureReason: "SLOT_CONFLICT", confirmedAt: null }) }));
    assert.match(failed, /예약 실패 사유/);
    assert.match(render(detail({ reservation: { state: "none" } })), /연결된 예약이 없습니다\./);
    assert.match(render(detail({ reservation: { state: "error" } })), /예약 정보를 불러오지 못했습니다/);
    assert.match(render(detail({ histories: null })), /변경 이력을 불러오지 못했습니다\./);
  });

  it("이력이 많아도 시간순 그대로 모두 보인다 (대화상자 본문만 스크롤)", () => {
    const many = Array.from({ length: 12 }, (_, index) => history(index % 2 ? "RESERVATION_FAILED" : "REFERRAL_CREATED", `2099-01-01T${String(8 + index).padStart(2, "0")}:00:00`));
    const html = render(detail({ histories: many }));
    const times = [...html.matchAll(/<time dateTime="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(times, many.map((item: { occurredAt: string }) => item.occurredAt));
  });
});

describe("의뢰 상세 대화상자 틀", () => {
  it("닫혀 있을 때는 상세 버튼만 (조회하지 않는다)", () => {
    const html = renderToStaticMarkup(createElement(Detail.default, { referralId: "88888888-8888-4888-8888-888888888888", examTypeLabel: "x", badgeStatus: "CONFIRMED" }));
    assert.match(html, />상세<\/button>/);
    assert.match(html, /w-\[min\(1080px,calc\(100%-24px\)\)\]/);
  });
});
