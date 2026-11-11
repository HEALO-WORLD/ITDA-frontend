import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleSlotSearchGet } from "@/features/slots/searchRoute";
import type { ApiSlotSearchInput, ApiSlotSearchResult, SlotSearchLoadFailureReason } from "@/features/slots/server";

const BASE = "http://localhost:3000/referring/slots/search";
const ORG = "11111111-1111-4111-8111-111111111111";

function recordingLoader(result: ApiSlotSearchResult) {
  const calls: ApiSlotSearchInput[] = [];
  const load = async (input: ApiSlotSearchInput) => {
    calls.push(input);
    return result;
  };
  return { calls, load };
}

const OK_RESULT: ApiSlotSearchResult = {
  ok: true,
  organizations: [{ id: ORG, name: "A 영상센터" }],
  examTypes: [],
  slots: [],
  availability: {},
  window: { startDate: "2026-11-05", endDateExclusive: "2026-12-06", from: "2026-11-05T00:00:00+09:00", to: "2026-12-06T00:00:00+09:00" },
  requestCount: 4,
};

describe("GET /referring/slots/search", () => {
  it("검색 기간·검사기관·검사 종류만 loader로 넘긴다 (쿼리의 userId·role·본인 기관 값은 읽지 않는다)", async () => {
    const { calls, load } = recordingLoader(OK_RESULT);
    const url = `${BASE}?startDate=2026-11-05&endDateExclusive=2026-12-06&institutionId=${ORG}&modality=CT&userId=evil&role=ADMIN&requesterInstitutionId=evil`;
    const response = await handleSlotSearchGet(new Request(url, { headers: { "sec-fetch-site": "same-origin" } }), load);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ startDate: "2026-11-05", endDateExclusive: "2026-12-06", institutionId: ORG, modality: "CT" }]);
  });

  it("빈 선택 값은 '조건 없음'으로 넘긴다", async () => {
    const { calls, load } = recordingLoader(OK_RESULT);
    await handleSlotSearchGet(new Request(`${BASE}?startDate=2026-11-05&endDateExclusive=2026-11-06&institutionId=&modality=`), load);
    assert.equal(calls[0].institutionId, undefined);
    assert.equal(calls[0].modality, undefined);
  });

  it("응답은 사용자별 데이터: 공유 캐시 금지 헤더, 토큰·기관 메타데이터 없이 화면 데이터만", async () => {
    const { load } = recordingLoader(OK_RESULT);
    const response = await handleSlotSearchGet(new Request(`${BASE}?startDate=2026-11-05&endDateExclusive=2026-12-06`), load);
    assert.match(response.headers.get("cache-control") ?? "", /private/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("vary"), "Cookie");
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["ok", "requestCount", "slots", "window"]);
    assert.deepEqual(body.window, { startDate: "2026-11-05", endDateExclusive: "2026-12-06" });
    const text = JSON.stringify(body);
    assert.equal(/bearer|authorization|token/i.test(text), false);
  });

  it("다른 사이트에서 보낸 요청은 조회 전에 403", async () => {
    const { calls, load } = recordingLoader(OK_RESULT);
    const response = await handleSlotSearchGet(
      new Request(`${BASE}?startDate=2026-11-05&endDateExclusive=2026-12-06`, { headers: { "sec-fetch-site": "cross-site" } }),
      load,
    );
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  });

  it("실패 구분 → HTTP 상태 (401 로그인 만료·403 권한·400 조건·5xx·504·422 조회 제한)", async () => {
    const table: [SlotSearchLoadFailureReason, number][] = [
      ["SIGNED_OUT", 401],
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
      ["INVALID_INPUT", 400],
      ["INVALID_REQUEST", 400],
      ["SERVER_ERROR", 502],
      ["NETWORK", 502],
      ["TIMEOUT", 504],
      ["INVALID_RESPONSE", 502],
      ["TOO_MANY_RESULTS", 422],
      ["NOT_AVAILABLE", 503],
    ];
    for (const [reason, status] of table) {
      const { load } = recordingLoader({ ok: false, reason, message: "안내" });
      const response = await handleSlotSearchGet(new Request(`${BASE}?startDate=2026-11-05&endDateExclusive=2026-11-06`), load);
      assert.equal(response.status, status, reason);
      assert.deepEqual(await response.json(), { ok: false, reason, message: "안내" });
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
  });
});
