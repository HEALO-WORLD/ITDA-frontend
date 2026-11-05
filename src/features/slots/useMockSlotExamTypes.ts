"use client";

import { useMemo } from "react";

import { useEquipmentChanges } from "@/features/equipment/useLiveEquipments";

import type { SlotExamTypeOption } from "./examTypeFilter";
import { getMockExamTypeOptions } from "./mockSlotExamTypes";
import type { PartnerOrganization } from "./types";

/**
 * Mock 모드 세부 검사 항목 선택지: 협력 기관 장비(원본 Mock + 이 브라우저에서 등록·수정한 장비)의 지원 검사 유형.
 * Mock 슬롯도 같은 규칙(mockSlotExamTypes)으로 항목을 받으므로 필터가 검색·달력에 그대로 맞는다. API 모드에서는 쓰지 않는다.
 */
export function useMockSlotExamTypes(organizations: readonly PartnerOrganization[], enabled: boolean): SlotExamTypeOption[] {
  const changes = useEquipmentChanges();
  return useMemo(() => (enabled ? getMockExamTypeOptions(changes, organizations) : []), [changes, organizations, enabled]);
}
