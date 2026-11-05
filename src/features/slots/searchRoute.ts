import type { DateKey } from "@/lib/date/seoulDate";

import type { SlotSearchRouteFailure, SlotSearchRouteSuccess } from "./apiSearchClient";
import type { ApiSlotSearchInput, ApiSlotSearchResult, SlotSearchLoadFailureReason } from "./server";
import type { ExamType } from "./types";

/**
 * `GET /referring/slots/search` 처리 (route.ts가 loadApiSlotSearch를 넣어 부른다. 테스트에서는 가짜 loader를 넣는다).
 *
 * - 로그인·REQUESTER 역할 확인은 loader(loadApiSlotSearch)가 Gateway 요청 전에 한다 (users/me). 여기서는 역할·기관을 받지 않는다
 * - 브라우저 입력은 검색 기간·검사기관 UUID·CT/MRI만 꺼낸다. userId·institutionId(본인 기관)·role 같은 값은 쿼리에 있어도 읽지 않는다
 * - 다른 사이트에서 보낸 요청(Sec-Fetch-Site가 same-origin이 아님)은 조회 전에 거부한다
 * - 응답은 사용자별 데이터라 공유 캐시에 두지 않는다 (Cache-Control: private, no-store). JWT·서버 오류 본문을 담지 않는다
 */

type SlotSearchLoader = (input: ApiSlotSearchInput) => Promise<ApiSlotSearchResult>;

const STATUS_BY_REASON: Record<SlotSearchLoadFailureReason, number> = {
  NOT_AVAILABLE: 503,
  SIGNED_OUT: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  INVALID_REQUEST: 400,
  CONFLICT: 409,
  NETWORK: 502,
  TIMEOUT: 504,
  SERVER_ERROR: 502,
  INVALID_RESPONSE: 502,
  METADATA_MISSING: 502,
  METADATA_MISMATCH: 502,
  INVALID_TIME: 502,
  TOO_MANY_RESULTS: 422,
  ERROR: 500,
};

export const SLOT_SEARCH_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

const respond = (status: number, body: SlotSearchRouteSuccess | SlotSearchRouteFailure) =>
  Response.json(body, { status, headers: SLOT_SEARCH_RESPONSE_HEADERS });

/** 빈 값은 '조건 없음'. 값이 있으면 그대로 넘겨 loader가 형식을 확인한다 (잘못된 값을 조용히 버리지 않는다) */
const optional = (value: string | null) => (value === null || value === "" ? undefined : value);

export async function handleSlotSearchGet(request: Request, load: SlotSearchLoader): Promise<Response> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return respond(403, { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다." });
  }
  const params = new URL(request.url).searchParams;
  const result = await load({
    startDate: (params.get("startDate") ?? "") as DateKey,
    endDateExclusive: (params.get("endDateExclusive") ?? "") as DateKey,
    institutionId: optional(params.get("institutionId")),
    modality: optional(params.get("modality")) as ExamType | undefined,
    // 세부 검사 항목을 골랐거나(일반 검색) 고정했을 때(재조정)만 보낸다 (없으면 loader 입력은 그대로)
    ...(optional(params.get("examTypeId")) ? { examTypeId: optional(params.get("examTypeId")) } : {}),
  });
  if (!result.ok) {
    return respond(STATUS_BY_REASON[result.reason] ?? 500, { ok: false, reason: result.reason, message: result.message });
  }
  return respond(200, {
    ok: true,
    slots: result.slots,
    window: { startDate: result.window.startDate, endDateExclusive: result.window.endDateExclusive },
    requestCount: result.requestCount,
  });
}
