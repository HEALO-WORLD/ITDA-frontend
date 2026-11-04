"use server";

import { headers } from "next/headers";

import { INCIDENT_PROCESSING_STATUSES, type IncidentProcessingStatusDto } from "@/features/incidents/remote";
import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { loadAdminIncidentDetail, loadAdminIncidentReferrals } from "./incidents";
import { loadAdminReferralDetail, loadAdminReservation } from "./operations";
import type { AdminLoadFailure } from "./server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 관리자 상세 대화상자용 조회 Server Function (의뢰·예약·장비 장애). 조회만 하고 아무것도 바꾸지 않는다.
 * - 대화상자를 열 때만 부른다 (목록을 그릴 때는 상세 요청이 없다)
 * - 같은 출처인지 확인하고, 인자는 브라우저에서 오므로 형식을 다시 확인한다 (틀리면 요청하지 않는다)
 * - ADMIN 확인과 조회는 기존 서버 로더(requireRoleAccess("ADMIN"))가 그대로 한다. 데이터 변환·노출 정책도 로더 그대로다
 *   (영향 의뢰의 lastError는 관리자 로더에서만 담긴다)
 */

const FORBIDDEN: AdminLoadFailure = { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null };
const invalid = (message: string): AdminLoadFailure => ({ ok: false, reason: "ERROR", message, code: null });
const sameOrigin = async () => isSameOriginHeaders(await headers());
const isId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

export type AdminReferralDetailResult = Awaited<ReturnType<typeof loadAdminReferralDetail>>;

export async function loadAdminReferralDetailAction(referralId: unknown): Promise<AdminReferralDetailResult> {
  if (!(await sameOrigin())) return FORBIDDEN;
  if (!isId(referralId)) return invalid("의뢰 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.");
  return loadAdminReferralDetail(referralId);
}

export type AdminReservationDetailResult = Awaited<ReturnType<typeof loadAdminReservation>>;

export async function loadAdminReservationDetailAction(reservationId: unknown): Promise<AdminReservationDetailResult> {
  if (!(await sameOrigin())) return FORBIDDEN;
  if (!isId(reservationId)) return invalid("예약 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.");
  return loadAdminReservation(reservationId);
}

export type AdminIncidentDetailResult =
  | {
      ok: true;
      incident: Extract<Awaited<ReturnType<typeof loadAdminIncidentDetail>>, { ok: true }>["incident"];
      /** 영향 의뢰는 따로 실패할 수 있다 (장애 정보는 그대로 보인다) */
      referrals: Awaited<ReturnType<typeof loadAdminIncidentReferrals>>;
    }
  | AdminLoadFailure;

/** 장애 상세 + 영향 의뢰 한 페이지 (referralPage: 0부터, referralStatus: 후속 처리 상태 조건) */
export async function loadAdminIncidentDetailAction(incidentId: unknown, referralPage: unknown, referralStatus: unknown): Promise<AdminIncidentDetailResult> {
  if (!(await sameOrigin())) return FORBIDDEN;
  if (!isId(incidentId)) return invalid("장애 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.");
  if (typeof referralPage !== "number" || !Number.isSafeInteger(referralPage) || referralPage < 0) return invalid("영향 의뢰 페이지가 올바르지 않습니다.");
  if (referralStatus !== null && !(INCIDENT_PROCESSING_STATUSES as readonly unknown[]).includes(referralStatus)) return invalid("후속 처리 상태 조건이 올바르지 않습니다.");
  const [detail, referrals] = await Promise.all([
    loadAdminIncidentDetail(incidentId),
    loadAdminIncidentReferrals(incidentId, referralPage, (referralStatus ?? undefined) as IncidentProcessingStatusDto | undefined),
  ]);
  if (!detail.ok) return detail;
  return { ok: true, incident: detail.incident, referrals };
}
