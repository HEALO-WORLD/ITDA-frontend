import { getFailedEquipmentIds } from "@/features/incidents/mockIncidentStore";
import { mockOnly } from "@/lib/api/config";
import { getSeoulNow } from "@/lib/date/seoulDate";
import { equipmentChangeStore, getAllMockSlots } from "@/features/equipment/mockEquipmentStore";
import { MOCK_PARTNER_ORGANIZATIONS } from "@/lib/dev/mockSlots";

import {
  applyEquipmentFailures,
  buildDateAvailability,
  isBookableSlot,
  isUpcomingSlot,
  matchesSlotFilter,
  type AvailabilityFilter,
  type DateAvailability,
} from "./availability";
import { withMockExamTypes } from "./mockSlotExamTypes";
import type { ExamSlot, PartnerOrganization, SlotSearchCriteria } from "./types";

/**
 * 슬롯 검색 데이터 접근 함수.
 *
 * TODO(api): 현재는 Mock 데이터를 사용한다. 슬롯 조회 API가 확정되면 함수 시그니처는 유지하고
 * 내부만 Gateway 호출(`/api/...`)로 교체한다. 검색 파라미터·응답 필드는 백엔드 계약 확인 필요.
 */

/** Mock 데이터 사용 여부. 화면에 '개발용 예시 데이터' 표시를 띄우는 데 쓰며, API 연동 시 제거한다 */
export const IS_MOCK_DATA = true;

/** Mock 환경에서 검색 중 상태를 확인하기 위한 지연(ms) */
const MOCK_DELAY_MS = 400;

/** 조회 옵션. 재조정 모드에서만 사용한다 */
export interface SlotQueryOptions {
  /**
   * 결과에서 제외할 장비 ID (재조정 대상 예약의 장애 장비).
   * TODO(api): 프론트 제외는 표시용이다. 서버가 장애 장비 슬롯을 내려주지 않거나
   * 예약 변경 요청 시 예약 가능 여부를 재검증해야 한다.
   */
  excludedEquipmentIds?: readonly string[];
}

/** 장애 장비 미래 슬롯을 예약 불가로 계산한 Mock 슬롯 (검색·달력·단건 조회 공통) */
function getMockSlotsWithFailures(): ExamSlot[] {
  // 원본 Mock + 검사기관에서 생성한 슬롯(개발용 Mock 저장소)
  const { dateTime } = getSeoulNow();
  // 세부 검사 항목: 장비의 지원 검사 유형 중 하나 (mockSlotExamTypes, 같은 슬롯은 항상 같은 항목)
  return withMockExamTypes(applyEquipmentFailures(getAllMockSlots(), getFailedEquipmentIds(), dateTime), equipmentChangeStore.read());
}

/** 제외 장비를 뺀 Mock 슬롯 */
function getQueryableSlots({ excludedEquipmentIds = [] }: SlotQueryOptions): ExamSlot[] {
  const slots = getMockSlotsWithFailures();
  if (excludedEquipmentIds.length === 0) return slots;
  return slots.filter((slot) => !excludedEquipmentIds.includes(slot.equipmentId));
}

export async function getPartnerOrganizations(): Promise<PartnerOrganization[]> {
  mockOnly("slots.getPartnerOrganizations");
  return MOCK_PARTNER_ORGANIZATIONS;
}

/**
 * 이미 지난 시간의 슬롯은 검색 결과에서 제외한다 (서버도 미래 슬롯만 반환한다고 가정 · 확인 필요).
 * 시간대·예약 가능 조건은 달력(getDateAvailability)과 같은 판정 함수를 쓴다.
 * TODO(api): 시간대·예약 가능 여부를 서버 검색 파라미터로 보낼 수 있으면 그쪽으로 옮긴다.
 */
export async function searchSlots(
  criteria: SlotSearchCriteria,
  options: SlotQueryOptions = {},
): Promise<ExamSlot[]> {
  mockOnly("slots.searchSlots");
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  const { dateTime } = getSeoulNow();

  return getQueryableSlots(options).filter(
    (slot) =>
      matchesSlotFilter(slot, criteria) &&
      (!criteria.date || slot.startAt.startsWith(criteria.date)) &&
      isUpcomingSlot(slot, dateTime) &&
      (!criteria.availableOnly || isBookableSlot(slot, dateTime)),
  ).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * 슬롯 ID로 슬롯 1건 조회. 검색 화면과 같은 Mock 생성기를 사용하므로 같은 ID면 같은 슬롯 정보를 반환한다.
 * 지난 시간·마감 여부는 걸러내지 않는다 (호출하는 쪽에서 판단).
 */
export async function getSlotById(slotId: string): Promise<ExamSlot | null> {
  mockOnly("slots.getSlotById");
  // 예약 요청 직전 재검증에 쓰이므로 장애 장비 차단도 함께 반영한다
  return getMockSlotsWithFailures().find((slot) => slot.id === slotId) ?? null;
}

/** 달력에 표시할 날짜별 예약 가능 여부 (검사 유형·기관·시간대 기준) */
export async function getDateAvailability(
  filter: AvailabilityFilter,
  options: SlotQueryOptions = {},
): Promise<DateAvailability> {
  mockOnly("slots.getDateAvailability");
  return buildDateAvailability(getQueryableSlots(options), filter, getSeoulNow().dateTime);
}
