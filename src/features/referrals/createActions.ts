"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { loadReferralProgress, submitCreateReferral, type CreateReferralActionResult, type ReferralProgressResult } from "./createServer";

/**
 * 의뢰 생성 + 첫 예약 접수 Server Function (의뢰기관 슬롯 검색 화면, API 모드).
 * 인자는 브라우저에서 오므로 믿지 않는다: 같은 출처 확인 → createServer가 users/me(REQUESTER)·슬롯·장비·협약을 다시 확인한다.
 * JWT는 서버에서 Gateway 요청에만 붙인다. X-User-Id·X-Institution-Id·X-Role은 만들지 않는다.
 */

const FORBIDDEN_ORIGIN = { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." } as const;

/**
 * 입력: { slotId, examTypeId, patientName, idempotencyKey }. 성공·결과 불명이면 화면 데이터를 서버 값으로 다시 그린다.
 * expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값. 다른 탭에서 계정이 바뀌었으면 요청하지 않는다 (SESSION_CHANGED)
 */
export async function createReferralAction(input: unknown, expectedLoginSession?: unknown): Promise<CreateReferralActionResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  const result = await submitCreateReferral(input, expectedLoginSession);
  if (result.ok || result.uncertain || result.reason === "SLOT_NOT_AVAILABLE" || result.reason === "IDEMPOTENCY_CONFLICT") refresh();
  return result;
}

/** 접수 뒤 의뢰·예약 상태 확인 (조회만) */
export async function loadReferralProgressAction(referralId: unknown): Promise<ReferralProgressResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  return loadReferralProgress(referralId);
}
