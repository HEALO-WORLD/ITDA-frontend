"use server";

import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { INCIDENT_PROCESSING_STATUSES, isUuid, type EquipmentIncidentDetailDto, type IncidentProcessingStatusDto } from "./remote";
import { loadIncidentDetail, loadIncidentReferralPage, type IncidentLoadFailure } from "./server";

export type ExaminingIncidentDetailResult =
  | { ok: true; incident: EquipmentIncidentDetailDto; referrals: Awaited<ReturnType<typeof loadIncidentReferralPage>> }
  | IncidentLoadFailure;

const invalid = (message: string): IncidentLoadFailure => ({ ok: false, reason: "ERROR", message, code: null });

/**
 * 검사기관 장애 상세 대화상자 Server Function (조회만). 대화상자를 열 때·영향 의뢰 조건을 바꿀 때만 부른다.
 * - 같은 출처·장애 ID·조건 형식을 확인하고, 검사기관 역할 확인은 기존 로더(requireRoleAccess("EXAMINING"))가 요청 전에 한다
 * - 장애 단건 `GET /api/v1/equipment-incidents/{id}`와 영향 의뢰 `GET …/{id}/referrals`를 함께 부른다 (기존 로더 그대로)
 * - 다른 기관 장애는 백엔드가 404로 막는다. lastError(ADMIN 전용)는 로더가 버린다
 */
export async function loadExaminingIncidentDetailAction(incidentId: unknown, referralPage: unknown, referralStatus: unknown): Promise<ExaminingIncidentDetailResult> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null };
  if (!isUuid(incidentId)) return invalid("장애 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.");
  if (typeof referralPage !== "number" || !Number.isSafeInteger(referralPage) || referralPage < 0) return invalid("영향 의뢰 페이지가 올바르지 않습니다.");
  if (referralStatus !== null && !(INCIDENT_PROCESSING_STATUSES as readonly unknown[]).includes(referralStatus)) return invalid("후속 처리 상태 조건이 올바르지 않습니다.");
  const [detail, referrals] = await Promise.all([
    loadIncidentDetail(incidentId),
    loadIncidentReferralPage(incidentId, referralPage, (referralStatus ?? undefined) as IncidentProcessingStatusDto | undefined),
  ]);
  if (!detail.ok) return detail;
  return { ok: true, incident: detail.incident, referrals };
}
