import "server-only";

import { unstable_rethrow } from "next/navigation";

import { EQUIPMENT_PAGE_MAX_SIZE, fetchEquipmentPage } from "@/features/equipment/remote";
import { isApiError } from "@/lib/api/errors";
import { getSeoulNow } from "@/lib/date/seoulDate";
import { requireRoleAccess, requireRoleMutationAccess } from "@/lib/auth/session";

import { isDowntimeRegistrationEnabled } from "./downtimeConfig";
import { hasDowntimeErrors, toSeoulOffsetDateTime, validateDowntimeForm, type DowntimeFormErrors, type DowntimeFormInput } from "./downtimeRules";
import { isRegisteredIncident, type RegisteredIncidentMatch } from "./downtimeTracking";
import { createEquipmentDowntime, DOWNTIME_CREATE_UNCERTAIN, fetchIncidentPage, getDowntimeCreateFailure, isUuid, type DowntimeCreateFailureReason } from "./remote";
import { parseOffsetDateTime, toSeoulLocalDateTime } from "@/features/referrals/offsetDateTime";

/**
 * 장비 장애(중단) 등록 (서버 전용). Server Function(downtimeActions.ts)이 부른다.
 *
 * 순서: 기능 스위치 → users/me로 검사기관(EXAMINER) 확인 → 입력 검증(한국 시간 규칙)
 *   → 우리 기관 장비 목록 1회 조회(선택한 장비가 있는지. 조회 실패면 등록하지 않는다) → `+09:00` OffsetDateTime → POST 1회
 * - 브라우저 값은 장비 ID·중단 유형·한국 시간 문자열·사유만 받는다. 기관 ID·역할 헤더는 만들지 않는다 (Gateway가 JWT로 붙인다)
 * - 같은 사용자·장비 요청이 이 서버에서 처리 중이면 다시 보내지 않는다 (백엔드에 멱등 키가 없다. 최종 중복 방지는 409 DOWNTIME_OVERLAP)
 * - 201은 '중단 등록'까지다: 장애 목록(referral-service)·예약 BLOCKED·의뢰 NEEDS_RESCHEDULE·알림은 Outbox·Kafka로 나중에 반영된다
 * 결과에는 토큰·서버 오류 본문을 담지 않는다. 로그에는 사유를 남기지 않는다.
 */

export type DowntimeActionFailureReason =
  | DowntimeCreateFailureReason
  | "NOT_AVAILABLE"
  | "SIGNED_OUT"
  /** 화면을 그린 뒤 다른 탭에서 로그인 계정이 바뀜(같은 계정 재로그인 포함)·렌더링 세션 값 누락 (장비 확인·등록 POST 모두 하지 않음. FORBIDDEN과 구분) */
  | "SESSION_CHANGED"
  | "INVALID_INPUT"
  | "IN_PROGRESS"
  | "EQUIPMENT_LOOKUP_FAILED";

export type DowntimeActionResult =
  | {
      ok: true;
      message: string;
      /** slot-service 중단 ID (장애 상세 incidentId가 아니다) */
      downtimeId: string;
      affectedSlotCount: number;
      conflictedSlotCount: number;
      /** 장애 목록에서 이 등록을 찾을 값 (응답 원본에서 만든다). 만들 수 없으면 null → 자동 확인 없이 수동 새로고침만 */
      match: RegisteredIncidentMatch | null;
    }
  | {
      ok: false;
      reason: DowntimeActionFailureReason;
      message: string;
      /** true면 서버에 저장됐을 수 있다: 자동으로 다시 보내지 않고 목록 확인을 안내한다 */
      uncertain?: boolean;
      fieldErrors?: DowntimeFormErrors;
    };

export const DOWNTIME_SUCCESS_MESSAGE = "장비 중단이 등록되었습니다. 영향받은 예약과 의뢰의 후속 처리는 순차적으로 반영됩니다.";

const inFlight = new Set<string>();

function logFailure(stage: string, error: unknown) {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  if (status === 401) return;
  console.error(`[incidents] 장애 등록 ${stage} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
}

/**
 * expectedLoginSession: 화면이 렌더링될 때의 로그인 세션 구분 값 (LoginSessionContext).
 * 역할 확인과 함께 지금 쿠키의 로그인 세션과 비교한다. 다르면 우리 기관 장비 확인·등록 POST 없이 SESSION_CHANGED
 */
export async function submitEquipmentDowntime(input: unknown, expectedLoginSession?: unknown): Promise<DowntimeActionResult> {
  if (!isDowntimeRegistrationEnabled()) return { ok: false, reason: "NOT_AVAILABLE", message: "장비 장애 등록 기능이 아직 연결되지 않았습니다." };
  const access = await requireRoleMutationAccess("EXAMINING", expectedLoginSession);
  if (!access.ok) {
    // 다른 계정 쿠키로 바뀐 화면: 등록하지 않고 새로고침 안내만 한다 (결과 불명이 아니다)
    if (access.reason === "SESSION_CHANGED") return { ok: false, reason: "SESSION_CHANGED", message: access.message };
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다. 다시 로그인해 주세요." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "검사기관 계정만 장비 장애를 등록할 수 있습니다." };
  }

  const data = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const form: DowntimeFormInput = {
    equipmentId: typeof data.equipmentId === "string" ? data.equipmentId : "",
    downtimeType: typeof data.downtimeType === "string" ? data.downtimeType : "",
    startedAt: typeof data.startedAt === "string" ? data.startedAt : "",
    endedAt: typeof data.endedAt === "string" ? data.endedAt : "",
    reason: typeof data.reason === "string" ? data.reason : "",
  };

  // 장비 소속은 서버가 조회한 우리 기관 장비 목록으로 확인한다 (화면 값을 믿지 않는다. 백엔드도 다시 403으로 막는다)
  let equipmentIds: Set<string>;
  try {
    const page = await fetchEquipmentPage(access.user.institutionId, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, { headers: access.headers });
    const own = access.user.institutionId.toLowerCase();
    equipmentIds = new Set(page.contents.filter((item) => item.institutionId.toLowerCase() === own).map((item) => item.id.toLowerCase()));
  } catch (error) {
    unstable_rethrow(error);
    logFailure("전 장비 조회", error);
    if (isApiError(error) && error.kind === "HTTP" && error.status === 401) {
      return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    }
    return { ok: false, reason: "EQUIPMENT_LOOKUP_FAILED", message: "장비 목록을 확인하지 못해 장애를 등록하지 않았습니다. 잠시 후 다시 시도해 주세요." };
  }

  const fieldErrors = validateDowntimeForm(form, { equipmentIds, nowDateTime: getSeoulNow().dateTime });
  if (hasDowntimeErrors(fieldErrors)) {
    return { ok: false, reason: "INVALID_INPUT", message: "입력 내용을 확인해 주세요.", fieldErrors };
  }

  const key = `${access.user.userId}|${form.equipmentId.toLowerCase()}`;
  if (inFlight.has(key)) {
    return { ok: false, reason: "IN_PROGRESS", message: "같은 장비의 장애 등록을 처리하고 있습니다. 잠시 후 장애 목록을 확인해 주세요.", uncertain: true };
  }
  inFlight.add(key);
  const registeredAt = getSeoulNow().dateTime;
  try {
    const created = await createEquipmentDowntime(
      {
        equipmentId: form.equipmentId,
        downtimeType: form.downtimeType as "FAILURE" | "MAINTENANCE",
        startedAt: toSeoulOffsetDateTime(form.startedAt),
        endedAt: toSeoulOffsetDateTime(form.endedAt),
        reason: form.reason,
      },
      { headers: access.headers },
    );
    return {
      ok: true,
      message: DOWNTIME_SUCCESS_MESSAGE,
      downtimeId: created.id,
      affectedSlotCount: created.affectedSlotCount,
      conflictedSlotCount: created.conflictedSlots.length,
      match: toIncidentMatch(created, registeredAt),
    };
  } catch (error) {
    unstable_rethrow(error);
    logFailure("요청", error);
    const failure = getDowntimeCreateFailure(error);
    return {
      ok: false,
      reason: failure.reason,
      message: failure.message,
      uncertain: DOWNTIME_CREATE_UNCERTAIN.has(failure.reason) || undefined,
      fieldErrors: failure.field ? { [failure.field]: failure.message } : undefined,
    };
  } finally {
    inFlight.delete(key);
  }
}

function toSeoulLocal(value: string): string | null {
  const parsed = parseOffsetDateTime(value);
  return parsed ? toSeoulLocalDateTime(parsed) : null;
}

function toIncidentMatch(
  created: { equipmentId: string; startedAt: string; endedAt: string; reason: string },
  registeredAt: string,
): RegisteredIncidentMatch | null {
  const startAt = toSeoulLocal(created.startedAt);
  const endAt = toSeoulLocal(created.endedAt);
  if (!startAt || !endAt) return null;
  return { equipmentId: created.equipmentId, startAt, endAt, reason: created.reason, registeredAt };
}

// ── 등록 뒤 장애 목록 반영 확인 (조회만) ──

export type RegisteredIncidentCheckResult =
  | { ok: true; found: false }
  | { ok: true; found: true; incidentId: string }
  | { ok: false; reason: "NOT_AVAILABLE" | "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT" | "ERROR"; message: string };

const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;

/** 브라우저가 돌려준 확인 값 검증 (형식만. 판단은 서버가 조회한 목록으로 한다) */
function parseMatch(value: unknown): RegisteredIncidentMatch | null {
  if (typeof value !== "object" || value === null) return null;
  const { equipmentId, startAt, endAt, reason, registeredAt } = value as Record<string, unknown>;
  if (!isUuid(equipmentId) || typeof reason !== "string" || reason === "" || reason.length > 500) return null;
  if (typeof startAt !== "string" || !LOCAL_DATE_TIME.test(startAt) || typeof endAt !== "string" || !LOCAL_DATE_TIME.test(endAt)) return null;
  if (typeof registeredAt !== "string" || !LOCAL_MINUTE.test(registeredAt)) return null;
  return { equipmentId, startAt, endAt, reason, registeredAt };
}

/**
 * 등록한 중단이 장애 목록(referral-service)에 반영됐는지 1회 확인.
 * 요청: users/me + 그 장비의 장애 목록 첫 페이지 1회 (최신 발생순 10건. 방금 등록한 장애가 가장 최근이다).
 * 화면의 필터·페이지와 따로 조회하므로 보고 있는 목록 조건을 바꾸지 않는다. 캐시 없이(no-store) 매번 서버에서 받는다.
 */
export async function findRegisteredIncident(input: unknown): Promise<RegisteredIncidentCheckResult> {
  if (!isDowntimeRegistrationEnabled()) return { ok: false, reason: "NOT_AVAILABLE", message: "장비 장애 등록 기능이 아직 연결되지 않았습니다." };
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) {
    if (access.reason === "SIGNED_OUT") return { ok: false, reason: "SIGNED_OUT", message: "로그인이 필요합니다." };
    if (access.reason === "UNAUTHORIZED") return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    return { ok: false, reason: "FORBIDDEN", message: "검사기관 계정만 장애 목록을 확인할 수 있습니다." };
  }
  const match = parseMatch(input);
  if (!match) return { ok: false, reason: "INVALID_INPUT", message: "확인할 장애 정보가 올바르지 않습니다." };
  try {
    const page = await fetchIncidentPage({ page: 0, size: 10, equipmentId: match.equipmentId }, { headers: access.headers });
    const found = page.contents.find((incident) => isRegisteredIncident(incident, match));
    return found ? { ok: true, found: true, incidentId: found.incidentId } : { ok: true, found: false };
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status !== 401) console.error("[incidents] 등록 반영 확인 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${error.code ?? ""}`.trim() : "unknown");
    if (status === 401) return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    if (status === 403) return { ok: false, reason: "FORBIDDEN", message: "장애 목록을 조회할 권한이 없습니다." };
    return { ok: false, reason: "ERROR", message: "장애 목록을 확인하지 못했습니다." };
  }
}
