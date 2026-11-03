import type { ExamType } from "@/features/slots/types";
import { isApiFeature } from "@/lib/api/config";
import { MOCK_EXAM_TYPES } from "@/lib/dev/mockExamTypes";

/**
 * 장비별 지원 검사 유형 (프론트·Mock 내부 모델).
 *
 * `supportedExamTypeIds`는 임시 내부 필드 이름이다. 백엔드 장비 DTO·저장 API가 확정되지 않았으므로
 * API 응답·요청과 이 모델 사이의 변환은 이 파일에서만 하도록 경계를 둔다 (확정되면 여기에 매핑만 추가한다).
 * - 후보: Mock 모드는 Mock 검사 유형 목록. TODO(api): `GET /api/v1/exam-types`(referrals/remote.ts fetchExamTypePage)로 교체
 * - 장비 종류(CT·MRI)와 같은 modality의 검사 유형만 고를 수 있다
 * - API 모드(equipment)에서는 저장 계약이 없어 이 항목을 편집할 수 없다 (저장된 것처럼 보이지 않게 한다)
 */

export interface ExamTypeOption {
  id: string;
  name: string;
  modality: ExamType;
}

/** 지원 검사 유형 저장 API가 확정되지 않았다 (확정되면 API 모드에서도 편집을 연다) */
const SUPPORTED_EXAM_TYPES_API_CONNECTED = false;

/** 지원 검사 유형을 편집·저장할 수 있는지 (Mock 모드에서만) */
export function canEditSupportedExamTypes(): boolean {
  return SUPPORTED_EXAM_TYPES_API_CONNECTED || !isApiFeature("equipment");
}

export function getExamTypeOptions(): readonly ExamTypeOption[] {
  return MOCK_EXAM_TYPES;
}

export function getCompatibleExamTypeOptions(modality: ExamType | ""): ExamTypeOption[] {
  return modality ? getExamTypeOptions().filter((option) => option.modality === modality) : [];
}

/**
 * 저장 전 정리·검증: 중복 제거, 알려진 검사 유형인지, 장비 종류와 맞는지.
 * 알 수 없는 ID나 다른 종류의 검사 유형이 있으면 저장하지 않는다 (조용히 버리지 않는다).
 */
export function normalizeSupportedExamTypeIds(
  ids: readonly unknown[],
  modality: ExamType,
): { ok: true; ids: string[] } | { ok: false; message: string } {
  const known = new Map(getExamTypeOptions().map((option) => [option.id, option]));
  const unique: string[] = [];
  for (const id of ids) {
    const option = typeof id === "string" ? known.get(id) : undefined;
    if (!option) return { ok: false, message: "알 수 없는 검사 유형이 포함되어 있습니다." };
    if (option.modality !== modality) return { ok: false, message: `${modality} 장비에는 ${modality} 검사 유형만 선택할 수 있습니다.` };
    if (!unique.includes(option.id)) unique.push(option.id);
  }
  return { ok: true, ids: unique };
}

/** 장비 종류가 바뀌었을 때 남길 수 있는 선택과 해제할 선택 */
export function splitByModality(ids: readonly string[], modality: ExamType | ""): { kept: string[]; removed: string[] } {
  const compatible = new Set(getCompatibleExamTypeOptions(modality).map(({ id }) => id));
  return { kept: ids.filter((id) => compatible.has(id)), removed: ids.filter((id) => !compatible.has(id)) };
}

/** 표시용 이름 목록. 값이 없거나 비어 있으면 null (= 미설정). 목록에 없는 ID는 그대로 보이지 않고 건너뛴다 */
export function getSupportedExamTypeNames(ids: readonly string[] | null | undefined): string[] | null {
  if (!ids || ids.length === 0) return null;
  const names = new Map(getExamTypeOptions().map((option) => [option.id, option.name]));
  const result = ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
  return result.length > 0 ? result : null;
}
