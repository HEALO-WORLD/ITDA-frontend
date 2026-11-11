"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import {
  loadGeneratedSlots,
  loadSlotGenerationContext,
  submitSlotGeneration,
  submitSlotRangeGeneration,
  type GeneratedSlotsLookupResult,
  type SlotRangeGenerationResult,
  type SlotGenerationContextResult,
  type SlotGenerationResult,
} from "./generateServer";

/**
 * 검사기관 슬롯 생성 Server Function (장비·슬롯 운영 화면, API 모드).
 * 인자는 브라우저에서 오므로 믿지 않는다: 같은 출처 확인 → generateServer가 users/me(EXAMINER)·장비 소속·연결 검사 유형·운영 요일을 확인한다.
 * JWT는 서버에서 Gateway 요청에만 붙인다. X-User-Id·X-Role 같은 헤더는 만들지 않는다 (Gateway가 JWT로 붙인다).
 * 결과에는 토큰·서버 오류 본문을 담지 않는다.
 */

const FORBIDDEN_ORIGIN = { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." } as const;

/** 생성 대화상자: 장비의 연결 검사 유형(소요 시간)·운영시간 (조회만) */
export async function loadSlotGenerationContextAction(equipmentId: unknown): Promise<SlotGenerationContextResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  return loadSlotGenerationContext(equipmentId);
}

/**
 * 하루치 슬롯 생성 (POST 1회). 성공하면 화면을 서버 값으로 다시 그린다.
 * expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값. 다른 탭에서 계정이 바뀌었으면 만들지 않는다 (SESSION_CHANGED)
 */
export async function generateSlotsAction(input: unknown, expectedLoginSession?: unknown): Promise<SlotGenerationResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  const result = await submitSlotGeneration(input, expectedLoginSession);
  if (result.ok || result.reason === "CONFLICT" || result.reason === "NOT_FOUND") refresh();
  return result;
}

/**
 * 기간 슬롯 생성 (운영일마다 하루 생성 POST를 차례로 1회씩). 날짜 하나라도 성공·중복이면 화면을 서버 값으로 다시 그린다.
 * 같은 기간을 다시 보내도 이미 슬롯이 있는 날짜는 서버 조회로 걸러 POST하지 않는다 (generateServer.submitSlotRangeGeneration)
 */
export async function generateSlotRangeAction(input: unknown, expectedLoginSession?: unknown): Promise<SlotRangeGenerationResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  const result = await submitSlotRangeGeneration(input, expectedLoginSession);
  if (result.ok ? result.summary.success > 0 || result.summary.conflict > 0 || result.summary.unknown > 0 : result.reason === "NOT_FOUND") refresh();
  return result;
}

/** 생성 결과 재확인: 그날 장비·검사 유형의 예약 가능 슬롯을 서버에서 다시 조회 (조회만) */
export async function loadGeneratedSlotsAction(equipmentId: unknown, examTypeId: unknown, date: unknown): Promise<GeneratedSlotsLookupResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  return loadGeneratedSlots(equipmentId, examTypeId, date);
}
