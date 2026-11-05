"use server";

import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { loadManagementMonthSlots, loadManagementSlotDetail, type ManagementSlotDetailResult, type MonthSlotsResult } from "./managementServer";

/**
 * 검사기관 슬롯 관리 조회 Server Function (장비·슬롯 운영 화면, API 모드, 조회만).
 * 같은 출처 확인 → managementServer가 users/me(EXAMINER)를 확인하고 우리 기관 장비 슬롯만 돌려준다.
 * 결과에는 JWT·서버 내부 헤더·응답 본문을 담지 않는다. 사용자별 데이터라 캐시하지 않는다 (호출마다 새로 조회).
 */

const FORBIDDEN_ORIGIN = { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." } as const;

/** 한 달 슬롯 (모든 상태·지난 슬롯 포함). monthStart = 그 달 1일 `YYYY-MM-01` */
export async function loadMonthSlotsAction(monthStart: unknown): Promise<MonthSlotsResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  return loadManagementMonthSlots(monthStart);
}

/** 슬롯 상세 (조회만) */
export async function loadSlotDetailAction(slotId: unknown): Promise<ManagementSlotDetailResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  return loadManagementSlotDetail(slotId);
}
