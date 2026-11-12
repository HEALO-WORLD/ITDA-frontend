import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HISTORY_REASON_LABELS, REFERRAL_STATUS_LABELS } from "@/features/referrals/labels";
import { isReferralStatus, REFERRAL_STATUSES, toReferralDisplayStatus } from "@/features/referrals/remote";
import { toRescheduleProgress } from "@/features/referrals/rescheduleProgress";

/** 새 백엔드 enum을 이전 프론트가 PARSE 오류로 거부하는 회귀를 방지한다. */
describe("재조정 기한 만료(EXPIRED) 프론트 계약", () => {
  it("EXPIRED 상태를 유효한 의뢰 상태로 인식하고 별도 종료 상태로 표시한다", () => {
    assert.ok(REFERRAL_STATUSES.includes("EXPIRED"));
    assert.equal(isReferralStatus("EXPIRED"), true);
    assert.equal(toReferralDisplayStatus("EXPIRED"), "EXPIRED");
    assert.equal(REFERRAL_STATUS_LABELS.EXPIRED, "재조정 기한 만료");
  });

  it("RESCHEDULE_TIMEOUT 이력 사유를 표시한다", () => {
    assert.equal(HISTORY_REASON_LABELS.RESCHEDULE_TIMEOUT, "재조정 기한 만료");
  });

  it("기존 예약이 BLOCKED여도 EXPIRED를 우선하고 재예약을 유도하지 않는다", () => {
    const progress = toRescheduleProgress("EXPIRED", { status: "BLOCKED", failureReason: "EQUIPMENT_FAILURE" });
    assert.equal(progress.stage, "EXPIRED");
    assert.match(progress.message, /더 이상 재예약할 수 없습니다/);
    assert.doesNotMatch(progress.message, /다른 슬롯으로 다시 요청/);
  });

  it("재조정 중인 의뢰는 기존 상태와 안내를 유지한다", () => {
    assert.equal(toRescheduleProgress("NEEDS_RESCHEDULE", { status: "BLOCKED", failureReason: "EQUIPMENT_FAILURE" }).stage, "NEEDS_RESCHEDULE");
  });
});
