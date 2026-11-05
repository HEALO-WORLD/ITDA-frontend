import { getEffectiveEquipmentsFrom, type EquipmentChanges } from "@/features/equipment/mockEquipmentStore";
import { MOCK_EXAM_TYPES, type MockExamType } from "@/lib/dev/mockExamTypes";

import { collectExamTypeOptions, type SlotExamTypeOption } from "./examTypeFilter";
import type { ExamSlot, PartnerOrganization } from "./types";

/**
 * ⚠️ Mock 모드 세부 검사 항목 (개발용). API 모드에서는 쓰지 않는다 (실제 항목은 서버 ExamType).
 * - 장비의 지원 검사 유형: 장비에 설정한 값(supportedExamTypeIds), 설정 전이면 같은 CT·MRI의 Mock 검사 유형 전체
 * - Mock 슬롯의 검사 항목: 그 장비의 지원 검사 유형 중 하나를 슬롯 ID로 정한다 (같은 슬롯은 항상 같은 항목)
 *   실제 슬롯처럼 한 슬롯 = 한 검사 항목이 되어 항목 필터·재조정 항목 고정을 Mock에서도 확인할 수 있다
 */

function supportedOf(equipment: { examType: MockExamType["modality"]; supportedExamTypeIds?: readonly string[] | null }): MockExamType[] {
  const sameModality = MOCK_EXAM_TYPES.filter((type) => type.modality === equipment.examType);
  if (!equipment.supportedExamTypeIds) return sameModality;
  return sameModality.filter((type) => equipment.supportedExamTypeIds!.includes(type.id));
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result;
}

/** 협력 기관의 Mock 세부 검사 항목 (검색 조건 선택지) */
export function getMockExamTypeOptions(changes: EquipmentChanges, organizations: readonly PartnerOrganization[]): SlotExamTypeOption[] {
  return collectExamTypeOptions(
    organizations.flatMap((organization) =>
      getEffectiveEquipmentsFrom(changes, organization.id).flatMap((equipment) =>
        supportedOf(equipment).map((type) => ({ organizationId: organization.id, examTypeId: type.id, examTypeName: type.name, examType: type.modality })),
      ),
    ),
  );
}

/** Mock 슬롯에 세부 검사 항목을 붙인다 (원본 슬롯은 바꾸지 않는다). 지원 검사 유형이 없는 장비 슬롯은 항목 없이 둔다 */
export function withMockExamTypes(slots: readonly ExamSlot[], changes: EquipmentChanges): ExamSlot[] {
  const supportedByEquipment = new Map<string, MockExamType[]>();
  for (const organizationId of new Set(slots.map((slot) => slot.organizationId))) {
    for (const equipment of getEffectiveEquipmentsFrom(changes, organizationId)) supportedByEquipment.set(equipment.id, supportedOf(equipment));
  }
  return slots.map((slot) => {
    if (slot.examTypeId) return slot;
    const supported = supportedByEquipment.get(slot.equipmentId) ?? [];
    if (supported.length === 0) return slot;
    const type = supported[hash(slot.id) % supported.length];
    return { ...slot, examTypeId: type.id, examTypeName: type.name };
  });
}
