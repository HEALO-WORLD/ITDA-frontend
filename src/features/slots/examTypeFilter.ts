import type { ExamType, PartnerOrganization } from "./types";

/**
 * 슬롯 검색의 '세부 검사 항목'(ExamType: 뇌 CT·흉부 CT·뇌 MRI…) 선택지 (일반 검색·재조정 검색 공통, 순수 함수).
 * 물리 장비(CT 1호기 등)가 아니다. 장비 이름으로 검사 항목을 만들지 않는다.
 * - 선택지 원본은 협력 기관의 장비가 실제 지원하는 검사 유형이다 (API: GET /equipments/{id}/exam-types, Mock: 장비의 지원 검사 유형)
 * - 같은 examTypeId는 장비·기관이 여러 곳이어도 한 번만 보인다 (지원 기관 목록에 모은다)
 * - 검사 유형(CT/MRI)·협력 검사기관 조건에 맞는 항목만 보인다
 * - 상위 조건이 바뀌어 고른 항목이 빠지면 '전체 검사 항목'("")으로 되돌린다 (없는 항목 ID로 검색하지 않는다)
 */

export interface SlotExamTypeOption {
  /** ExamType UUID (Mock은 mock- ID) */
  id: string;
  /** 검사 유형 목록의 이름 (예: 뇌 MRI) */
  name: string;
  /** CT·MRI */
  examType: ExamType;
  /** 이 항목을 지원하는 장비가 있는 협력 기관 ID */
  organizationIds: string[];
}

export interface ExamTypeChoice {
  value: string;
  label: string;
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** 장비별 지원 검사 유형 → 항목별 지원 기관 (examTypeId로 중복 제거) */
export function collectExamTypeOptions(
  rows: readonly { organizationId: string; examTypeId: string; examTypeName: string; examType: ExamType }[],
): SlotExamTypeOption[] {
  const byId = new Map<string, SlotExamTypeOption>();
  for (const row of rows) {
    const key = row.examTypeId.toLowerCase();
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { id: row.examTypeId, name: row.examTypeName, examType: row.examType, organizationIds: [row.organizationId] });
    } else if (!existing.organizationIds.some((id) => sameId(id, row.organizationId))) {
      existing.organizationIds.push(row.organizationId);
    }
  }
  return [...byId.values()];
}

export function getExamTypeChoices(
  options: readonly SlotExamTypeOption[],
  organizations: readonly PartnerOrganization[],
  { examType, organizationId }: { examType: ExamType | ""; organizationId: string },
): ExamTypeChoice[] {
  const partnerIds = new Set(organizations.map((org) => org.id.toLowerCase()));
  const visible = options.filter(
    (option) =>
      (!examType || option.examType === examType) &&
      option.organizationIds.some((id) => partnerIds.has(id.toLowerCase()) && (!organizationId || sameId(id, organizationId))),
  );
  // 이름이 같은 서로 다른 검사 유형(ID가 다름)은 구분할 수 있게 CT/MRI를 붙인다 (그래도 같으면 ID 앞자리)
  const nameCount = new Map<string, number>();
  for (const option of visible) nameCount.set(option.name, (nameCount.get(option.name) ?? 0) + 1);
  return visible
    .sort((a, b) => a.examType.localeCompare(b.examType) || a.name.localeCompare(b.name, "ko", { numeric: true }))
    .map((option) => ({
      value: option.id,
      label: (nameCount.get(option.name) ?? 0) > 1 ? `${option.name} (${option.id.slice(0, 8)})` : option.name,
    }));
}

/** 바뀐 선택지에 고른 항목이 없으면 전체 검사 항목("")으로 */
export function reconcileExamTypeId(examTypeId: string | undefined, choices: readonly ExamTypeChoice[]): string {
  if (!examTypeId) return "";
  return choices.some((choice) => sameId(choice.value, examTypeId)) ? examTypeId : "";
}
