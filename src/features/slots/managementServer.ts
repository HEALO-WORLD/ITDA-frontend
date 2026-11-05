import "server-only";

import { unstable_rethrow } from "next/navigation";

import { EQUIPMENT_PAGE_MAX_SIZE, fetchEquipment, fetchEquipmentExamTypePage, fetchEquipmentPage } from "@/features/equipment/remote";
import { EXAM_TYPE_MAX_PAGE_SIZE, fetchExamTypePage } from "@/features/referrals/remote";
import { isApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure, type RoleAccess } from "@/lib/auth/session";
import { addMonths, getSeoulNow, type DateKey } from "@/lib/date/seoulDate";

import { getManagementMonthRange } from "./managementMonth";
import { buildSlotSearchMetadata, collectAllPages, collectSlicePages, mapApiSlots, type ApiExamSlot } from "./apiSlots";
import { fetchSlotDetail, getSlotSearchErrorMessage, getSlotSearchFailureReason, isSlotApiId, searchManagementSlots, SLOT_SEARCH_MAX_SIZE } from "./remote";

/**
 * 검사기관 장비·슬롯 운영 화면의 슬롯 관리 조회 (서버 전용, 조회만). Server Function(managementActions.ts)이 부른다.
 *
 * - users/me로 EXAMINER를 확인한 뒤에만 요청한다. 기관은 users/me 소속 기관만 쓴다 (브라우저에서 기관 ID를 받지 않는다)
 * - 슬롯: `GET /api/v1/slots?view=MANAGEMENT` (모든 상태·지난 슬롯 포함, 서비스가 우리 기관 장비로 제한)
 * - 장비명·검사 유형명은 우리 기관 장비 목록·검사 유형 목록으로 붙인다. 목록에 없는 장비·검사 유형이 오면 일부만 보여 주지 않고 실패
 * - 실패하면 Mock·빈 목록으로 대신하지 않는다. 로그에는 종류·상태·코드만 남긴다 (토큰·응답 본문 없음). 결과는 요청마다 새로 조회한다
 */

const REQUIRED_FEATURES = ["slots", "equipment"] as const;
/** 한 달 슬롯 최대 페이지 (100건 × 30). 넘으면 일부만 보여 주지 않고 안내한다 */
const MONTH_MAX_SLOT_PAGES = 30;
const LIST_MAX_PAGES = 20;

export type ManagementLoadFailureReason =
  | "NOT_AVAILABLE"
  | "SIGNED_OUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID"
  | "SERVER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "TOO_MANY"
  | "ERROR";

export type ManagementLoadFailure = { ok: false; reason: ManagementLoadFailureReason; message: string };

export type MonthSlotsResult =
  | {
      ok: true;
      /** 그 달 1일 */
      monthStart: DateKey;
      /** 그 달 우리 기관 장비의 모든 슬롯 (모든 상태, 서울 시작 시각·ID순) */
      slots: ApiExamSlot[];
      /** 이번 조회의 Gateway 요청 수 (users/me 제외) */
      requestCount: number;
    }
  | ManagementLoadFailure;

export type ManagementSlotDetailResult = { ok: true; slot: ApiExamSlot } | ManagementLoadFailure;

const NOT_AVAILABLE: ManagementLoadFailure = { ok: false, reason: "NOT_AVAILABLE", message: "슬롯 조회 API가 아직 연결되지 않았습니다." };
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function accessFailure(access: Extract<RoleAccess, { ok: false }>): ManagementLoadFailure {
  const failure = toRoleAccessFailure(access);
  return {
    ok: false,
    reason: failure.reason,
    message:
      failure.reason === "SIGNED_OUT"
        ? "로그인이 필요합니다. 다시 로그인해 주세요."
        : failure.reason === "FORBIDDEN"
          ? "검사기관 계정만 슬롯 현황을 볼 수 있습니다."
          : failure.message,
  };
}

/** 조회 실패 → 화면 구분 (토큰·응답 본문은 담지 않는다) */
function toLoadFailure(error: unknown, action: string): ManagementLoadFailure {
  const reason = getSlotSearchFailureReason(error);
  if (reason !== "UNAUTHORIZED") {
    console.error(`[slots] ${action} 실패:`, isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
  }
  switch (reason) {
    case "UNAUTHORIZED":
      return { ok: false, reason: "UNAUTHORIZED", message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." };
    case "FORBIDDEN":
      return { ok: false, reason: "FORBIDDEN", message: "슬롯을 조회할 권한이 없습니다." };
    case "INVALID_REQUEST":
    case "NOT_SENT":
      return { ok: false, reason: "INVALID", message: getSlotSearchErrorMessage(error) };
    case "NETWORK":
    case "ABORTED":
      return { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요." };
    case "TIMEOUT":
      return { ok: false, reason: "TIMEOUT", message: "응답이 지연되어 슬롯을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
    case "INVALID_RESPONSE":
      return { ok: false, reason: "INVALID_RESPONSE", message: "서버 응답을 확인할 수 없어 슬롯을 표시하지 않았습니다." };
    case "SERVER_ERROR":
    case "CONFLICT":
      return { ok: false, reason: "SERVER_ERROR", message: "서버 오류로 슬롯을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
    default:
      return { ok: false, reason: "ERROR", message: "슬롯을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * 한 달 슬롯 (관리 조회). 요청: 장비 목록 페이지 + 검사 유형 페이지 + 슬롯 페이지(hasNext까지) — 세 목록은 병렬.
 * 기간: 그 달 1일 00:00 ~ 다음 달 1일 00:00 (서울, 31일 이하 한 번).
 */
export async function loadManagementMonthSlots(monthStart: unknown): Promise<MonthSlotsResult> {
  if (!REQUIRED_FEATURES.every((feature) => isApiFeature(feature))) return NOT_AVAILABLE;
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return accessFailure(access);
  if (typeof monthStart !== "string" || !MONTH_START.test(monthStart)) return { ok: false, reason: "INVALID", message: "조회할 달이 올바르지 않습니다." };
  const range = getManagementMonthRange(getSeoulNow().dateKey);
  if (monthStart < range.first || monthStart > range.last) return { ok: false, reason: "INVALID", message: "조회할 수 있는 기간이 아닙니다." };

  const options = { headers: access.headers };
  const institutionId = access.user.institutionId;
  const nextMonth = addMonths(monthStart, 1);
  let requestCount = 0;
  try {
    const [equipments, examTypes, found] = await Promise.all([
      collectAllPages((page) => {
        requestCount++;
        return fetchEquipmentPage(institutionId, { page, size: EQUIPMENT_PAGE_MAX_SIZE }, options);
      }, LIST_MAX_PAGES),
      collectAllPages((page) => {
        requestCount++;
        return fetchExamTypePage({ page, size: EXAM_TYPE_MAX_PAGE_SIZE }, options);
      }, LIST_MAX_PAGES),
      collectSlicePages((page) => {
        requestCount++;
        return searchManagementSlots(
          { from: `${monthStart}T00:00:00+09:00`, to: `${nextMonth}T00:00:00+09:00`, page, size: SLOT_SEARCH_MAX_SIZE },
          options,
        );
      }, MONTH_MAX_SLOT_PAGES),
    ]);
    if (!found.ok) {
      return { ok: false, reason: "TOO_MANY", message: "이 달의 슬롯이 너무 많아 모두 불러오지 못했습니다. 관리자에게 문의해 주세요." };
    }
    // 장비 목록이 모두 우리 기관 것인지 (계약과 다르면 보여 주지 않는다)
    if (equipments.some((item) => !sameId(item.institutionId, institutionId))) {
      return { ok: false, reason: "INVALID_RESPONSE", message: "장비 목록 응답을 확인할 수 없습니다." };
    }
    const built = buildSlotSearchMetadata({
      organizations: [{ id: institutionId, name: access.user.institutionName }],
      examTypes,
      equipments,
    });
    if (!built.ok) return { ok: false, reason: "INVALID_RESPONSE", message: built.message };
    const mapped = mapApiSlots(found.items, built.metadata);
    if (!mapped.ok) {
      console.error(`[slots] 관리 슬롯 매핑 실패: ${mapped.reason}`);
      return { ok: false, reason: "INVALID_RESPONSE", message: mapped.message };
    }
    // 요청한 달 밖 슬롯이 있으면 계약 위반
    if (mapped.slots.some((slot) => slot.startAt.slice(0, 10) < monthStart || slot.startAt.slice(0, 10) >= nextMonth)) {
      return { ok: false, reason: "INVALID_RESPONSE", message: "서버 응답이 조회 기간과 맞지 않습니다." };
    }
    return { ok: true, monthStart, slots: mapped.slots, requestCount };
  } catch (error) {
    unstable_rethrow(error);
    return toLoadFailure(error, "월 슬롯 조회");
  }
}

/**
 * 슬롯 상세 (조회만). 요청: 슬롯 1 → 장비 1(우리 기관 장비인지) → 장비 검사 유형 1(이름).
 * 운영 중단·재개 같은 상태 변경은 API 계약 확인 전이라 두지 않는다.
 */
export async function loadManagementSlotDetail(slotId: unknown): Promise<ManagementSlotDetailResult> {
  if (!REQUIRED_FEATURES.every((feature) => isApiFeature(feature))) return NOT_AVAILABLE;
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return accessFailure(access);
  if (!isSlotApiId(slotId)) return { ok: false, reason: "INVALID", message: "슬롯 정보가 올바르지 않습니다." };
  const options = { headers: access.headers };
  try {
    const detail = await fetchSlotDetail(slotId, options);
    const equipment = await fetchEquipment(detail.equipmentId, options);
    if (!sameId(equipment.institutionId, access.user.institutionId)) {
      return { ok: false, reason: "FORBIDDEN", message: "우리 기관 장비의 슬롯만 볼 수 있습니다." };
    }
    const links = await fetchEquipmentExamTypePage(equipment.id, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, options);
    const link = links.contents.find((item) => sameId(item.examTypeId, detail.examTypeId));
    const built = buildSlotSearchMetadata({
      organizations: [{ id: access.user.institutionId, name: access.user.institutionName }],
      // 장비에서 연결이 해제된 검사 유형이면 이름을 알 수 없다: 이름 없이 보이지 않고 실패로 둔다
      examTypes: link ? [{ id: link.examTypeId, name: link.examTypeName, modality: link.modality }] : [],
      equipments: [equipment],
    });
    if (!built.ok) return { ok: false, reason: "INVALID_RESPONSE", message: built.message };
    const mapped = mapApiSlots([detail], built.metadata);
    if (!mapped.ok) return { ok: false, reason: "INVALID_RESPONSE", message: mapped.message };
    return { ok: true, slot: mapped.slots[0] };
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status === 404) return { ok: false, reason: "INVALID", message: "슬롯을 찾을 수 없습니다. 삭제되었을 수 있습니다." };
    return toLoadFailure(error, "슬롯 상세 조회");
  }
}
