"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { findRegisteredIncident, submitEquipmentDowntime, type DowntimeActionResult, type RegisteredIncidentCheckResult } from "./downtimeServer";

/**
 * 장비 장애(중단) 등록 Server Function (검사기관 장애 화면, API 모드).
 * 인자는 브라우저에서 오므로 믿지 않는다: 같은 출처 확인 → downtimeServer가 users/me(EXAMINER)·우리 기관 장비·입력을 다시 확인한다.
 * JWT는 서버에서 Gateway 요청에만 붙인다. X-User-Id·X-Institution-Id·X-Role은 만들지 않는다.
 * 성공·결과 불명·409(겹침)이면 화면을 다시 불러온다(refresh). 장애 목록 반영은 비동기라 바로 보이지 않을 수 있다.
 */
/** expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값. 다른 탭에서 계정이 바뀌었으면 등록하지 않는다 (SESSION_CHANGED) */
export async function registerEquipmentDowntimeAction(input: unknown, expectedLoginSession?: unknown): Promise<DowntimeActionResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  const result = await submitEquipmentDowntime(input, expectedLoginSession);
  if (result.ok || result.uncertain || result.reason === "OVERLAP") refresh();
  return result;
}

/**
 * 등록 뒤 장애 목록 반영 확인 (조회만, 화면을 다시 그리지 않는다). 등록 안내가 2초마다 최대 30초 부른다.
 * 반영을 확인하면 브라우저가 router.refresh()로 보고 있던 목록(필터·페이지 그대로)을 한 번 다시 받는다.
 */
export async function checkRegisteredIncidentAction(match: unknown): Promise<RegisteredIncidentCheckResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  }
  return findRegisteredIncident(match);
}
