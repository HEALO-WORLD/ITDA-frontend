"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isApiError } from "@/lib/api/errors";
import { isSameOriginHeaders } from "@/lib/auth/csrf";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";

import {
  createEquipment,
  createEquipmentExamType,
  isEquipmentEntityId,
  isEquipmentModality,
  updateEquipment,
  validateEquipmentName,
} from "./remote";
import {
  loadEquipmentDetail,
  loadExamTypeOptions,
  loadSupportedExamTypes,
  SUPPORTED_LOOKUP_MAX,
  toFailure,
  type EquipmentDetailResult,
  type ExamTypeOptionsResult,
  type SupportedExamTypesResult,
} from "./server";

/**
 * 검사기관 장비 Server Function (장비 상세·검사 유형 선택지 조회, 장비 등록·수정, 지원 검사 유형 연결).
 *
 * 인자는 브라우저에서 오므로 믿지 않고 다시 검증한다.
 * - CSRF: Next가 Server Function의 Origin·Host를 비교하고, 여기서도 같은 출처인지 한 번 더 확인한다
 * - 인증: users/me로 검사기관(EXAMINER) 역할을 확인한 뒤에만 토큰을 넘긴다 (requireRoleAccess("EXAMINING"))
 * - 기관: 장비 등록 기관 ID는 users/me 소속 기관만 쓴다 (인자로 받지 않는다). 수정·검사 유형 연결은 서비스가 장비 기관과 요청자 기관을 비교해 403으로 막는다
 * - 결과에는 토큰·서버 오류 본문을 담지 않는다 (알려진 오류 코드만 정해 둔 문구로 안내)
 * 성공·404·409는 화면을 다시 불러와(refresh) 서버 값으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 */

export type EquipmentActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      reason: "INVALID" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "SIGNED_OUT" | "NETWORK" | "ERROR";
      message: string;
      fieldErrors?: Partial<Record<"name" | "modality" | "examTypeId", string | null>>;
    };

const FORBIDDEN_ORIGIN = { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null } as const;

export async function loadEquipmentDetailAction(equipmentId: unknown): Promise<EquipmentDetailResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!isEquipmentEntityId(equipmentId)) return { ok: false, reason: "ERROR", message: "장비 정보가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null };
  return loadEquipmentDetail(equipmentId);
}

export async function loadExamTypeOptionsAction(modality: unknown): Promise<ExamTypeOptionsResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!isEquipmentModality(modality)) return { ok: false, reason: "ERROR", message: "장비 종류가 올바르지 않습니다.", code: null };
  return loadExamTypeOptions(modality);
}

export async function createEquipmentAction(input: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  // 기관 ID는 받지 않는다 (users/me 소속 기관으로 등록)
  const { name, modality } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fieldErrors = { name: validateEquipmentName(name), modality: isEquipmentModality(modality) ? null : "장비 종류를 선택해 주세요." };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors };
  return run(
    "create",
    "장비를 등록했습니다.",
    (requestHeaders, institutionId) =>
      createEquipment(institutionId, { name: name as string, modality: modality as "CT" | "MRI" }, { headers: requestHeaders }),
    "장비 등록에 실패했습니다.",
  );
}

export async function updateEquipmentAction(equipmentId: unknown, input: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isEquipmentEntityId(equipmentId)) return invalid("장비 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
  // 장비명만 받는다 (백엔드 수정 대상은 이름뿐. 종류·상태 변경 API는 없다)
  const { name } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const nameError = validateEquipmentName(name);
  if (nameError) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors: { name: nameError } };
  return run("update", "장비 정보를 수정했습니다.", (requestHeaders) => updateEquipment(equipmentId, { name: name as string }, { headers: requestHeaders }), "장비 수정에 실패했습니다.");
}

export async function addEquipmentExamTypeAction(equipmentId: unknown, examTypeId: unknown): Promise<EquipmentActionResult> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  if (!isEquipmentEntityId(equipmentId)) return invalid("장비 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
  if (!isEquipmentEntityId(examTypeId)) return { ok: false, reason: "INVALID", message: "검사 유형을 선택해 주세요.", fieldErrors: { examTypeId: "검사 유형을 선택해 주세요." } };
  return run(
    "exam-type-add",
    "지원 검사 유형을 추가했습니다.",
    (requestHeaders) => createEquipmentExamType(equipmentId, examTypeId, { headers: requestHeaders }),
    "지원 검사 유형 추가에 실패했습니다.",
  );
}

async function checkOrigin(): Promise<EquipmentActionResult | null> {
  if (!isSameOriginHeaders(await headers())) return { ok: false, reason: "FORBIDDEN", message: FORBIDDEN_ORIGIN.message };
  return null;
}

const invalid = (message: string): EquipmentActionResult => ({ ok: false, reason: "INVALID", message });

/** 검사기관 확인 → 요청 → 결과. 성공·404·409는 화면을 다시 불러온다 */
async function run(
  action: string,
  successMessage: string,
  request: (requestHeaders: HeadersInit, institutionId: string) => Promise<unknown>,
  fallback: string,
): Promise<EquipmentActionResult> {
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) {
    const failure = toRoleAccessFailure(access);
    return { ok: false, reason: failure.reason, message: failure.reason === "SIGNED_OUT" ? "로그인이 필요합니다. 다시 로그인해 주세요." : failure.message };
  }
  try {
    await request(access.headers, access.user.institutionId);
  } catch (error) {
    const failure = toFailure(error, action, fallback);
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status === 409 || status === 404) refresh();
    return {
      ok: false,
      reason: status === 409 ? "CONFLICT" : status === 404 ? "NOT_FOUND" : status === 400 ? "INVALID" : failure.reason,
      message: failure.message,
    };
  }
  refresh();
  return { ok: true, message: successMessage };
}

/** 장비 목록의 지원 검사 유형 표시용 (조회만). ID는 최대 10개, 서버가 우리 기관 장비인지 다시 확인한다 */
export async function loadSupportedExamTypesAction(equipmentIds: unknown): Promise<SupportedExamTypesResult> {
  if (!isSameOriginHeaders(await headers())) return FORBIDDEN_ORIGIN;
  if (!Array.isArray(equipmentIds) || equipmentIds.length > SUPPORTED_LOOKUP_MAX || !equipmentIds.every(isEquipmentEntityId)) {
    return { ok: false, reason: "ERROR", message: "장비 정보가 올바르지 않습니다.", code: null };
  }
  return loadSupportedExamTypes(equipmentIds);
}

/** 장비 등록 시 함께 연결할 수 있는 지원 검사 유형 최대 수 */
const CREATE_EXAM_TYPE_MAX = 20;

/**
 * 장비 등록 + 선택한 지원 검사 유형 연결 (2단계 등록 대화상자).
 * 백엔드 장비 등록 DTO는 장비명·종류만 받으므로 그 둘만 보내고(슬롯 소요 시간·운영 시간은 보내지 않는다),
 * 등록에 성공하면 고른 검사 유형을 `POST /equipments/{id}/exam-types`로 하나씩 연결한다.
 * 연결이 일부 실패하면 장비 등록은 성공으로 두고, 몇 개가 연결되지 않았는지 알린다 (상세에서 다시 추가할 수 있다).
 */
export async function createEquipmentWithExamTypesAction(input: unknown): Promise<EquipmentActionResult & { linkFailed?: number }> {
  const blocked = await checkOrigin();
  if (blocked) return blocked;
  const { name, modality, examTypeIds } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fieldErrors = { name: validateEquipmentName(name), modality: isEquipmentModality(modality) ? null : "검사 유형(CT·MRI)을 선택해 주세요." };
  if (Object.values(fieldErrors).some(Boolean)) return { ok: false, reason: "INVALID", message: "입력값을 확인해 주세요.", fieldErrors };
  const ids = examTypeIds === undefined ? [] : examTypeIds;
  if (!Array.isArray(ids) || ids.length > CREATE_EXAM_TYPE_MAX || !ids.every(isEquipmentEntityId)) {
    return { ok: false, reason: "INVALID", message: "지원 검사 유형 선택이 올바르지 않습니다.", fieldErrors: { examTypeId: "지원 검사 유형을 다시 선택해 주세요." } };
  }
  const access = await requireRoleAccess("EXAMINING");
  if (!access.ok) {
    const failure = toRoleAccessFailure(access);
    return { ok: false, reason: failure.reason, message: failure.reason === "SIGNED_OUT" ? "로그인이 필요합니다. 다시 로그인해 주세요." : failure.message };
  }
  let equipmentId: string;
  try {
    const created = await createEquipment(access.user.institutionId, { name: name as string, modality: modality as "CT" | "MRI" }, { headers: access.headers });
    equipmentId = created.id;
  } catch (error) {
    const failure = toFailure(error, "create", "장비 등록에 실패했습니다.");
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    if (status === 409) refresh();
    return { ok: false, reason: status === 409 ? "CONFLICT" : status === 400 ? "INVALID" : failure.reason, message: failure.message };
  }
  let linkFailed = 0;
  for (const examTypeId of [...new Set(ids as string[])]) {
    try {
      await createEquipmentExamType(equipmentId, examTypeId, { headers: access.headers });
    } catch (error) {
      toFailure(error, "create-exam-type", "지원 검사 유형 연결에 실패했습니다.");
      linkFailed++;
    }
  }
  refresh();
  return linkFailed > 0
    ? { ok: true, linkFailed, message: `장비를 등록했지만 지원 검사 유형 ${linkFailed}개를 연결하지 못했습니다. 장비 상세에서 다시 추가해 주세요.` }
    : { ok: true, message: ids.length > 0 ? `장비를 등록하고 지원 검사 유형 ${ids.length}개를 연결했습니다.` : "장비를 등록했습니다." };
}
