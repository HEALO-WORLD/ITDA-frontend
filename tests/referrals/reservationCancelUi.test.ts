import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 의뢰 상세(API 모드)의 예약 취소 버튼 표시·위치 테스트. Server Function은 가짜로 바꾼다 (요청 없음).
 * 클릭 흐름(중복 클릭·요청 중 닫기 방지·실패 후 복구·성공/409 뒤 상세 재조회)은 실제 Chromium으로 따로 확인했다.
 */

const REFERRAL = "88888888-8888-4888-8888-888888888888";
/** 2099-01-05 10:00 KST */
const START = "2099-01-05T10:00:00";
const START_MS = Date.UTC(2099, 0, 5, 1, 0, 0);
const TWO_HOURS = 2 * 60 * 60 * 1000;

const reservation = {
  state: "ok" as const,
  attemptNo: 1,
  reservationStatus: "CONFIRMED" as const,
  failureReason: null,
  startTime: START,
  endTime: "2099-01-05T10:30:00",
  confirmedAt: null,
  endedAt: null,
  examInstitution: { state: "ok" as const, value: "A 영상센터" },
  equipment: { state: "ok" as const, value: "CT-1" },
};

let Control: typeof import("@/features/referrals/components/ReservationCancelControl").default;
let ControlModule: typeof import("@/features/referrals/components/ReservationCancelControl");
let DetailButton: typeof import("@/features/referrals/components/ReferralApiDetailButton").default;

before(async () => {
  mock.module("@/features/referrals/reservationCancelActions", { namedExports: { cancelReservationAction: async () => ({ ok: true, message: "" }) } });
  mock.module("@/features/referrals/actions", { namedExports: { loadReferralDetailAction: async () => ({ ok: false }) } });
  ControlModule = await import("@/features/referrals/components/ReservationCancelControl");
  Control = ControlModule.default;
  DetailButton = (await import("@/features/referrals/components/ReferralApiDetailButton")).default;
});

const render = (props: Partial<Parameters<typeof Control>[0]>) =>
  renderToStaticMarkup(
    createElement(Control, {
      referralId: REFERRAL,
      referralStatus: "CONFIRMED",
      reservation,
      checkedAtMs: START_MS - TWO_HOURS - 1,
      onPendingChange: () => {},
      onSettled: () => {},
      ...props,
    }),
  );

describe("예약 취소 버튼 표시", () => {
  it("확정 예약·마감 전: '예약 취소' 버튼, 확인 창은 닫혀 있다", () => {
    const html = render({});
    assert.match(html, /<button[^>]*>예약 취소<\/button>/);
    assert.doesNotMatch(html, /예약을 취소할까요\?/);
  });

  it("마감 정각부터 버튼 대신 마감 안내", () => {
    const html = render({ checkedAtMs: START_MS - TWO_HOURS });
    assert.doesNotMatch(html, /<button[^>]*>예약 취소<\/button>/);
    assert.match(html, /검사 시작 2시간 전이 지나 예약을 취소할 수 없습니다/);
  });

  it("의뢰·예약이 확정이 아니면 아무것도 그리지 않는다", () => {
    assert.equal(render({ referralStatus: "NEEDS_RESCHEDULE" }), "");
    assert.equal(render({ reservation: { ...reservation, reservationStatus: "CANCELED" } }), "");
  });

  it("렌더링 중에는 현재 시각을 읽지 않는다 (프리렌더·hydration 안정성)", () => {
    const realNow = Date.now;
    Date.now = () => {
      throw new Error("렌더링 중 Date.now() 호출");
    };
    try {
      render({});
      // 상세 버튼은 서버에서 그려도 상세·취소 버튼 없이 '상세' 버튼만 나온다
      const html = renderToStaticMarkup(createElement(DetailButton, { referralId: REFERRAL, examTypeLabel: "흉부 CT", badgeStatus: "CONFIRMED" }));
      assert.match(html, />상세</);
      assert.doesNotMatch(html, /예약 취소/);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("배치: API 상세 모달에만 (목록·Mock 화면은 그대로)", () => {
  const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

  it("상세 대화상자 하단에 두고, 성공·409 뒤 상세를 직접 다시 불러온다", () => {
    const source = read("features/referrals/components/ReferralApiDetailButton.tsx");
    assert.match(source, /<ReservationCancelControl/);
    assert.match(source, /onSettled=\{\(next, unknownResultTarget\) => \{\s*setNotice\(next\);[\s\S]*?void \(unknownResultTarget \? recheck\(unknownResultTarget\) : load\(\)\);/);
    assert.match(source, /preventClose=\{cancelPending\}/);
  });

  it("의뢰 목록·Mock 상세에는 취소 버튼을 두지 않는다", () => {
    for (const path of ["features/referrals/components/ReferralApiTable.tsx", "features/referrals/components/ReferralApiSection.tsx", "features/referrals/components/ReferralDetailDialog.tsx", "features/referrals/components/ReferralHistoryTable.tsx"]) {
      assert.doesNotMatch(read(path), /ReservationCancelControl|cancelReservationAction|예약 취소/, path);
    }
  });
});

describe("5xx·네트워크 결과 불명 뒤 안내와 재시도 차단", () => {
  const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
  const TARGET = { attemptNo: 1, startTime: START, endTime: "2099-01-05T10:30:00" };

  it("결과 불명: 확인 창을 닫고 성공·실패를 단정하지 않는 안내 + 확인한 표식으로 재조회만 한다", () => {
    assert.equal(ControlModule.CANCEL_UNKNOWN_RESULT_NOTICE, "예약 취소 요청의 처리 결과를 확인하지 못했습니다. 최신 예약 상태를 확인하겠습니다.");
    const source = read("features/referrals/components/ReservationCancelControl.tsx");
    assert.match(source, /result\.reason === "UNKNOWN_RESULT"\) \{[\s\S]*?setConfirmTarget\(null\);\s*onSettled\(\{ tone: "info", message: CANCEL_UNKNOWN_RESULT_NOTICE \}, \{ attemptNo, startTime, endTime \}\);/);
    assert.doesNotMatch(source, /REFETCH_REASONS[^\n]*UNKNOWN_RESULT/);
  });

  it("재조회 결과별 안내: 완료·수동 재시도·변경·확인 실패(상태 확인만 다시)", () => {
    const notice = (outcome: Parameters<typeof ControlModule.getCancelRecheckNotice>[0]) => ControlModule.getCancelRecheckNotice(outcome, TARGET);
    assert.equal(notice("CANCELED").tone, "success");
    assert.match(notice("CANCELED").message, /예약 취소가 완료되었습니다/);
    assert.match(notice("SAME_CONFIRMED").message, /아직 취소되지 않았습니다[\s\S]*다시 눌러 주세요/);
    assert.match(notice("CHANGED").message, /^예약 정보가 변경되었습니다\./);
    assert.match(notice("CHANGED").message, /다시 보내지 않았습니다/);
    assert.equal(notice("LOOKUP_FAILED").tone, "error");
    assert.match(notice("LOOKUP_FAILED").message, /처리 여부를 알 수 없습니다/);
    assert.deepEqual(notice("LOOKUP_FAILED").recheckTarget, TARGET);
    for (const outcome of ["CANCELED", "SAME_CONFIRMED", "CHANGED"] as const) assert.equal(notice(outcome).recheckTarget, undefined, outcome);
  });

  it("상세 재조회는 조회만 하고, 재조회 중·조회 실패 상태에서는 취소 버튼을 그리지 않는다", () => {
    const source = read("features/referrals/components/ReferralApiDetailButton.tsx");
    // 상태 다시 확인 = 상세 조회(loadReferralDetailAction)만. 취소 Server Function은 상세 버튼에서 부르지 않는다
    assert.doesNotMatch(source, /cancelReservationAction/);
    assert.match(source, /const recheck = async \(target: ReservationCancelTarget\) => \{[\s\S]*?const loaded = await load\(\);[\s\S]*?classifyCancelRecheck\(target, loaded\.ok \? loaded\.detail : null\)/);
    // 재조회 시작 시 상세를 비우고(취소 버튼 없음), 이미 불러오는 중이면 요청하지 않는다
    assert.match(source, /if \(loadingRef\.current\) return null;\s*loadingRef\.current = true;\s*setResult\(null\);/);
    // 취소 버튼은 상세·예약 조회에 성공했을 때만 (재조회 실패면 없음)
    assert.match(source, /\{detail && currentReservation && loadedAtMs !== null && \(\s*<ReservationCancelControl/);
    assert.match(source, /const currentReservation = detail\?\.reservation\.state === "ok" \? detail\.reservation : null;/);
    // 확인 실패 뒤 다시 시도는 상태 재조회
    assert.match(source, /onRetry=\{\(\) => void \(notice\?\.recheckTarget \? recheck\(notice\.recheckTarget\) : load\(\)\)\}/);
  });
});
