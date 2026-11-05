"use server";

import { headers } from "next/headers";

import { loadApiRescheduleTarget, type ApiRescheduleTargetResult } from "@/features/referrals/rescheduleTarget";
import type { SlotExamTypeOption } from "@/features/slots/examTypeFilter";
import { isApiSlotSearchAvailable, loadApiSlotSearchOrganizations } from "@/features/slots/server";
import type { PartnerOrganization } from "@/features/slots/types";
import { isApiFeature } from "@/lib/api/config";
import { isSameOriginHeaders } from "@/lib/auth/csrf";

/**
 * 재조정·알림 화면의 대체 슬롯 검색 대화상자 데이터 (API 모드, 조회만). [새 슬롯 검색]을 눌렀을 때 한 번 부른다.
 * 슬롯 검색 화면(/referring/slots?rescheduleReferralId=)과 같은 서버 로더를 쓴다:
 * - 검색 조건 선택지: loadApiSlotSearchOrganizations (협력 검사기관 + 세부 검사 항목)
 * - 재조정 대상: loadApiRescheduleTarget (users/me REQUESTER → 의뢰 → NEEDS_RESCHEDULE 확인 → 기존 예약)
 * 슬롯 검색·후보 확인·재예약 요청은 대화상자 안의 기존 SlotSearch·ApiRescheduleConfirm이 그대로 한다.
 */

type RescheduleSearchLoadResult =
  | { ok: true; organizations: PartnerOrganization[]; examTypes: SlotExamTypeOption[] | null; reschedule: ApiRescheduleTargetResult }
  | { ok: false; reason: string; message: string };

export async function loadRescheduleSearchAction(referralId: unknown): Promise<RescheduleSearchLoadResult> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요." };
  if (!isApiSlotSearchAvailable() || !isApiFeature("referrals")) {
    return { ok: false, reason: "NOT_AVAILABLE", message: "대체 슬롯 검색 기능이 아직 연결되지 않았습니다." };
  }
  const [options, reschedule] = await Promise.all([loadApiSlotSearchOrganizations(), loadApiRescheduleTarget(referralId)]);
  if (!options.ok) return { ok: false, reason: options.reason, message: options.message };
  return { ok: true, organizations: options.organizations, examTypes: options.examTypes, reschedule };
}
