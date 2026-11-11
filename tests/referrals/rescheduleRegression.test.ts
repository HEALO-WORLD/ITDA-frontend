import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * 재예약 회귀: 의뢰 생성 추가(remote.ts 확장) 뒤에도 재예약 요청 검증·본문·경로·응답 확인·시각 변환이 그대로인지.
 * Gateway 요청은 가짜(apiRequestData)로 바꾼다 (실제 POST 없음).
 */

const REFERRAL = "88888888-8888-4888-8888-888888888888";
const RESERVATION = "aaaaaaaa-8888-4888-8888-888888888888";
const SLOT = "44444444-4444-4444-8444-444444444444";
const EXAM_ORG = "22222222-2222-4222-8222-222222222222";
const EQUIPMENT = "55555555-5555-4555-8555-555555555555";

const input = {
  slotId: SLOT,
  examInstitutionId: EXAM_ORG,
  equipmentId: EQUIPMENT,
  examDate: "2099-01-10T10:00:00",
  startTime: "2099-01-10T10:00:00",
  endTime: "2099-01-10T10:30:00",
};

const reservation = (overrides: Record<string, unknown> = {}) => ({
  id: RESERVATION,
  referralId: REFERRAL,
  attemptNo: 2,
  ...input,
  confirmedAt: null,
  endedAt: null,
  reservationStatus: "REQUESTED",
  failureReason: null,
  ...overrides,
});

const state = { calls: [] as { path: string; method?: string; body?: unknown }[], response: reservation() as unknown };

let remote: typeof import("@/features/referrals/remote");
let time: typeof import("@/features/referrals/rescheduleTime");

before(async () => {
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown } = {}) => {
        state.calls.push({ path, method: options.method, body: options.body });
        return state.response;
      },
    },
  });
  remote = await import("@/features/referrals/remote");
  time = await import("@/features/referrals/rescheduleTime");
});

beforeEach(() => {
  state.calls = [];
  state.response = reservation();
});

describe("재예약 회귀", () => {
  it("POST /api/v1/referrals/{id}/reschedule 에 DTO 필드만 보낸다", async () => {
    const result = await remote.requestReschedule(REFERRAL, { ...input, extra: "x" } as never);
    assert.equal(result.id, RESERVATION);
    assert.deepEqual(state.calls, [{ path: `/api/v1/referrals/${REFERRAL}/reschedule`, method: "POST", body: input }]);
  });

  it("검증 실패는 요청하지 않는다 (종료 ≤ 시작, 오프셋 포함 시각, 잘못된 ID)", async () => {
    for (const bad of [{ endTime: "2099-01-10T10:00:00" }, { startTime: "2099-01-10T10:00:00+09:00" }, { slotId: "x" }]) {
      await assert.rejects(remote.requestReschedule(REFERRAL, { ...input, ...bad }), { kind: "CONFIG" });
    }
    await assert.rejects(remote.requestReschedule("bad", input), { kind: "CONFIG" });
    assert.equal(state.calls.length, 0);
  });

  it("응답 예약이 요청과 다르면 PARSE", async () => {
    state.response = reservation({ slotId: "45444444-4444-4444-8444-444444444444" });
    await assert.rejects(remote.requestReschedule(REFERRAL, input), { kind: "PARSE" });
  });

  it("서울 LocalDateTime 변환 (toRescheduleLocalTimes)", () => {
    assert.deepEqual(time.toRescheduleLocalTimes({ startsAt: "2099-01-10T01:00:00Z", endsAt: "2099-01-10T01:30:00.5Z" }), {
      ok: true,
      startTime: "2099-01-10T10:00:00",
      endTime: "2099-01-10T10:30:00.5",
    });
    const mismatch = time.toRescheduleLocalTimes({ startsAt: "2099-01-10T14:30:00Z", endsAt: "2099-01-10T15:30:00Z" });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, "DATE_MISMATCH");
    assert.equal(time.toRescheduleLocalTimes({ startsAt: "2099-01-10 10:00", endsAt: "2099-01-10T01:30:00Z" }).ok, false);
  });
});
