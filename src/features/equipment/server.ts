import "server-only";

import { unstable_rethrow } from "next/navigation";

import type { AdminLoadFailure } from "@/features/admin/server";
import { EXAM_TYPE_MAX_PAGE_SIZE, fetchExamTypePage, type ExamTypeDto } from "@/features/referrals/remote";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import {
  EQUIPMENT_PAGE_MAX_SIZE,
  fetchEquipment,
  fetchEquipmentExamTypePage,
  fetchEquipmentOperatingHours,
  fetchEquipmentPage,
  getEquipmentErrorMessage,
  type EquipmentDto,
  type EquipmentExamTypeDto,
  type EquipmentModalityDto,
  type EquipmentOperatingHoursDto,
} from "./remote";
import { fromBackendWeek } from "./operatingHours";
import type { DailyOperatingHours } from "./types";

/**
 * 검사기관 장비 화면 데이터 (서버 전용, 조회만).
 *
 * 인증: 함수마다 users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 요청한다 (requireRoleAccess("EXAMINING")).
 * 기관 격리: 목록은 users/me의 소속 기관 ID로만 조회한다 (화면에서 받은 기관 ID를 쓰지 않는다).
 * 장비 단건·지원 검사 유형 GET은 Gateway·서비스가 의뢰기관·검사기관 모두에게 허용하므로(기관 확인 없음),
 * 여기서 장비의 institutionId가 우리 기관인지 먼저 확인하고 아니면 보여 주지 않는다 (다른 기관 장비 정보 노출 방지).
 * 실패해도 Mock으로 대체하지 않는다. 로그에는 종류·상태·코드만 남긴다.
 */

export type EquipmentLoadFailure = AdminLoadFailure;

/** 장비 목록은 한 번에 최대 100대를 받는다 (검색·CT/MRI 탭은 받은 목록 안에서 한다: 백엔드에 장비명 검색 조건이 없다) */
export const EQUIPMENT_LIST_PAGE_SIZE = EQUIPMENT_PAGE_MAX_SIZE;

export type EquipmentPageResult =
  | {
      ok: true;
      equipments: EquipmentDto[];
      totalElements: number;
      totalPages: number;
      page: number;
      /** 기관 전체 종류별 장비 수 (한 페이지에 다 오면 받은 목록으로 세고, 넘치면 modality 조건 size=1 요청 2회의 totalElements) */
      counts: { CT: number; MRI: number } | null;
    }
  | EquipmentLoadFailure;

/** 우리 기관 장비 목록 한 페이지 (최대 100대) */
export async function loadEquipmentPage(query: { modality?: EquipmentModalityDto; page: number }): Promise<EquipmentPageResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  const institutionId = access.user.institutionId;
  try {
    const data = await fetchEquipmentPage(institutionId, { modality: query.modality, page: query.page, size: EQUIPMENT_LIST_PAGE_SIZE }, { headers: access.headers });
    // 응답 장비가 모두 우리 기관 것인지 확인한다 (계약과 다르면 보여 주지 않는다)
    if (data.contents.some((item) => item.institutionId.toLowerCase() !== institutionId.toLowerCase())) {
      return toFailure(null, "list", "장비 목록 응답을 확인할 수 없습니다.");
    }
    let counts: { CT: number; MRI: number } | null = null;
    if (!query.modality && data.totalPages <= 1) {
      counts = { CT: data.contents.filter((item) => item.modality === "CT").length, MRI: data.contents.filter((item) => item.modality === "MRI").length };
    } else {
      // 목록이 넘치면 종류별 건수만 따로 묻는다 (실패하면 건수를 비워 두고 안내한다: 0으로 채우지 않는다)
      const [ct, mri] = await Promise.allSettled(
        (["CT", "MRI"] as const).map((modality) => fetchEquipmentPage(institutionId, { modality, page: 0, size: 1 }, { headers: access.headers })),
      );
      if (ct.status === "fulfilled" && mri.status === "fulfilled") counts = { CT: ct.value.totalElements, MRI: mri.value.totalElements };
    }
    return { ok: true, equipments: data.contents, totalElements: data.totalElements, totalPages: data.totalPages, page: data.number, counts };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "list", "장비 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 지원 검사 유형 목록 표시용으로 한 번에 묻는 최대 장비 수 (행마다 요청이 생기므로 제한한다. 백엔드 일괄 조회 API가 생기면 바꾼다) */
export const SUPPORTED_LOOKUP_MAX = 10;
const SUPPORTED_LOOKUP_CONCURRENCY = 4;

/** 목록 한 행의 미리보기. 항목마다 따로 실패할 수 있다 (null = 조회 실패) */
export interface EquipmentRowPreview {
  names: string[] | null;
  hours: DailyOperatingHours[] | null;
}

export type SupportedExamTypesResult = { ok: true; byEquipment: Record<string, EquipmentRowPreview> } | EquipmentLoadFailure;

/**
 * 장비별 지원 검사 유형 이름 + 운영시간 (목록 표시용). 요청: 우리 기관 장비 목록 1회(브라우저가 보낸 ID가 우리 기관 장비인지 확인)
 * + 장비당 `GET /equipments/{id}/exam-types`·`GET /equipments/{id}/operating-hours` 각 1회
 * (장비 단위로 동시에 4대까지, 최대 10대). 다른 기관 장비 ID는 조회하지 않는다.
 */
export async function loadSupportedExamTypes(equipmentIds: string[]): Promise<SupportedExamTypesResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  let ownIds: Set<string>;
  try {
    const list = await fetchEquipmentPage(access.user.institutionId, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, { headers: access.headers });
    ownIds = new Set(
      list.contents.filter((item) => item.institutionId.toLowerCase() === access.user.institutionId.toLowerCase()).map((item) => item.id.toLowerCase()),
    );
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "supported-list", "지원 검사 유형을 불러오지 못했습니다.");
  }
  const ids = [...new Set(equipmentIds.map((id) => id.toLowerCase()))].filter((id) => ownIds.has(id)).slice(0, SUPPORTED_LOOKUP_MAX);
  const byEquipment: Record<string, EquipmentRowPreview> = {};
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const [examTypes, hours] = await Promise.allSettled([
        fetchEquipmentExamTypePage(id, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, { headers: access.headers }),
        fetchEquipmentOperatingHours(id, { headers: access.headers }),
      ]);
      for (const settled of [examTypes, hours]) if (settled.status === "rejected") unstable_rethrow(settled.reason);
      byEquipment[id] = {
        names:
          examTypes.status === "fulfilled"
            ? examTypes.value.contents.filter((item) => item.equipmentId.toLowerCase() === id).map((item) => item.examTypeName)
            : null,
        hours: hours.status === "fulfilled" ? toDailyOperatingHours(hours.value) : null,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(SUPPORTED_LOOKUP_CONCURRENCY, ids.length) }, worker));
  return { ok: true, byEquipment };
}

export type EquipmentDetailResult =
  | { ok: true; equipment: EquipmentDto; examTypes: EquipmentExamTypeDto[]; examTypesTruncated: boolean }
  | EquipmentLoadFailure;

/** 장비 상세 + 지원 검사 유형 (요청 2회: 장비 확인 후 검사 유형). 우리 기관 장비가 아니면 검사 유형을 요청하지 않는다 */
export async function loadEquipmentDetail(equipmentId: string): Promise<EquipmentDetailResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const equipment = await fetchEquipment(equipmentId, { headers: access.headers });
    if (equipment.institutionId.toLowerCase() !== access.user.institutionId.toLowerCase()) {
      return { ok: false, reason: "FORBIDDEN", message: "우리 기관 장비만 볼 수 있습니다.", code: null };
    }
    const examTypes = await fetchEquipmentExamTypePage(equipmentId, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, { headers: access.headers });
    return { ok: true, equipment, examTypes: examTypes.contents, examTypesTruncated: examTypes.totalPages > 1 };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "detail", "장비 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export type ExamTypeOptionsResult = { ok: true; examTypes: ExamTypeDto[]; truncated: boolean } | EquipmentLoadFailure;

/** 장비에 연결할 수 있는 검사 유형 (전체 목록 1페이지 최대 100개 중 같은 장비 종류만). 검사 유형 등록 기능은 두지 않는다 */
export async function loadExamTypeOptions(modality: EquipmentModalityDto): Promise<ExamTypeOptionsResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const data = await fetchExamTypePage({ page: 0, size: EXAM_TYPE_MAX_PAGE_SIZE }, { headers: access.headers });
    return { ok: true, examTypes: data.contents.filter((item) => item.modality === modality), truncated: data.totalPages > 1 };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "exam-types", "검사 유형 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** 운영시간 조회 오류 문구 (UNSUPPORTED_REQUEST: 서버에 운영시간 API가 아직 배포되지 않았을 때 Gateway·서비스가 주는 404) */
const OPERATING_HOURS_LOAD_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: "장비를 찾을 수 없습니다. 삭제되었을 수 있습니다.",
  UNSUPPORTED_REQUEST: "서버에서 운영 시간 조회를 처리하지 못했습니다. 서버에 운영 시간 기능이 배포되었는지 확인해 주세요.",
};

export type EquipmentOperatingHoursResult = { ok: true; equipment: EquipmentDto; hours: DailyOperatingHours[] } | EquipmentLoadFailure;

/** 운영시간 응답 → 화면 요일 모양 (week 7=일 → 0). 휴게 시간은 백엔드에 없어 넣지 않는다 */
export const toDailyOperatingHours = (list: EquipmentOperatingHoursDto[]): DailyOperatingHours[] =>
  list.map(({ week, startTime, endTime }) => ({ weekday: fromBackendWeek(week), open: startTime, close: endTime }));

/**
 * 장비 운영시간 (요청 2회: 장비 확인 후 운영시간). 운영시간 GET은 의뢰기관에도 열려 있어
 * 장비가 우리 기관 것인지 먼저 확인하고, 아니면 운영시간을 요청하지 않는다.
 */
export async function loadEquipmentOperatingHours(equipmentId: string): Promise<EquipmentOperatingHoursResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const equipment = await fetchEquipment(equipmentId, { headers: access.headers });
    if (equipment.institutionId.toLowerCase() !== access.user.institutionId.toLowerCase()) {
      return { ok: false, reason: "FORBIDDEN", message: "우리 기관 장비만 볼 수 있습니다.", code: null };
    }
    const hours = await fetchEquipmentOperatingHours(equipmentId, { headers: access.headers });
    return { ok: true, equipment, hours: toDailyOperatingHours(hours) };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, "operating-hours", "운영 시간을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", OPERATING_HOURS_LOAD_MESSAGES);
  }
}

/** 조회·변경 실패 → 화면 안내 (토큰·응답 본문은 담지 않는다) */
export function toFailure(error: unknown, action: string, fallback: string, overrides?: Record<string, string>): EquipmentLoadFailure {
  const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
  const code = isApiError(error) ? error.code : null;
  const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
  if (status !== 401) {
    console.error(`[equipment] ${action} 실패:`, isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : "unknown");
  }
  const message =
    status === 401
      ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
      : isNetwork
        ? "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요."
        : getEquipmentErrorMessage(error, fallback, overrides);
  return { ok: false, reason: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : isNetwork ? "NETWORK" : "ERROR", message, code };
}
