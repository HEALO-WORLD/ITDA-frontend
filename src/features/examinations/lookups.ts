import "server-only";

import { unstable_rethrow } from "next/navigation";

import { EQUIPMENT_PAGE_MAX_SIZE, fetchEquipmentPage } from "@/features/equipment/remote";
import { EXAM_TYPE_MAX_PAGE_SIZE, fetchExamTypePage } from "@/features/referrals/remote";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import { fetchExaminationResult, getExaminationResultReadErrorMessage, type ExaminationResultDto } from "./remote";

/**
 * 검사 목록 화면의 표시용 이름·결과 조회 (서버 전용, 조회만).
 *
 * 인증: users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 요청한다 (requireRoleAccess("EXAMINING"), 한 요청 안에서는 users/me 1회).
 * - 검사 유형명: `GET /api/v1/exam-types` 1페이지(최대 100개) 1회
 * - 검사 장비명: `GET /api/v1/institutions/{users/me 기관}/equipments` 1페이지(최대 100대) 1회 (화면에서 받은 기관 ID를 쓰지 않는다)
 * 행마다 단건 요청하지 않는다 (페이지당 추가 요청 2회 고정). 이름을 찾지 못하면 UUID를 이름처럼 보여 주지 않고 '확인 불가'로 둔다.
 * 실패해도 목록은 그대로 보여 준다 (Mock 값으로 채우지 않는다).
 */

export interface ExaminationLookups {
  /** 소문자 UUID → 이름 */
  examTypeNames: Record<string, string>;
  equipmentNames: Record<string, string>;
  examTypesFailed: boolean;
  equipmentsFailed: boolean;
}

export async function loadExaminationLookups(): Promise<ExaminationLookups> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { examTypeNames: {}, equipmentNames: {}, examTypesFailed: true, equipmentsFailed: true };
  const [examTypes, equipments] = await Promise.allSettled([
    fetchExamTypePage({ page: 0, size: EXAM_TYPE_MAX_PAGE_SIZE }, { headers: access.headers }),
    fetchEquipmentPage(access.user.institutionId, { page: 0, size: EQUIPMENT_PAGE_MAX_SIZE }, { headers: access.headers }),
  ]);
  for (const [label, result] of [["exam-types", examTypes], ["equipments", equipments]] as const) {
    if (result.status === "rejected") {
      unstable_rethrow(result.reason);
      const error = result.reason;
      console.error(`[examinations] ${label} 이름 조회 실패:`, isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
    }
  }
  const own = access.user.institutionId.toLowerCase();
  return {
    examTypeNames: examTypes.status === "fulfilled" ? Object.fromEntries(examTypes.value.contents.map((item) => [item.id.toLowerCase(), item.name])) : {},
    // 우리 기관 장비만 이름으로 쓴다
    equipmentNames:
      equipments.status === "fulfilled"
        ? Object.fromEntries(equipments.value.contents.filter((item) => item.institutionId.toLowerCase() === own).map((item) => [item.id.toLowerCase(), item.name]))
        : {},
    examTypesFailed: examTypes.status === "rejected",
    equipmentsFailed: equipments.status === "rejected",
  };
}

export type ExaminationResultLoadResult =
  | { ok: true; result: ExaminationResultDto }
  | { ok: false; reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NETWORK" | "ERROR"; message: string; code: string | null };

/** 검사 결과 1건 (상세 대화상자를 열 때만, 결과가 등록된 검사만) */
export async function loadExaminationResult(examinationId: string): Promise<ExaminationResultLoadResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    return { ok: true, result: await fetchExaminationResult(examinationId, { headers: access.headers }) };
  } catch (error) {
    unstable_rethrow(error);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    const code = isApiError(error) ? error.code : null;
    const isNetwork = isApiError(error) && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
    if (status !== 401) console.error("[examinations] 검사 결과 조회 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : "unknown");
    return {
      ok: false,
      reason: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : isNetwork ? "NETWORK" : "ERROR",
      message:
        status === 401
          ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
          : isNetwork
            ? "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요."
            : getExaminationResultReadErrorMessage(error),
      code,
    };
  }
}
