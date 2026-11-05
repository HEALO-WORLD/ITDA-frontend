import { handleSlotSearchGet } from "@/features/slots/searchRoute";
import { loadApiSlotSearch } from "@/features/slots/server";

/**
 * 의뢰기관 슬롯 검색 `GET /referring/slots/search?startDate=&endDateExclusive=&institutionId=&modality=` (조회 전용).
 * 화면(SlotSearch, Client Component)이 같은 출처로 부른다. 서버가 HttpOnly 쿠키의 JWT로 REQUESTER를 확인한 뒤 조회한다.
 * 요청마다 쿠키·쿼리를 읽으므로 미리 렌더링·캐시하지 않는다 (응답도 Cache-Control: private, no-store).
 */
export async function GET(request: Request) {
  return handleSlotSearchGet(request, loadApiSlotSearch);
}
