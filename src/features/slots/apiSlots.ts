import type { EquipmentDto } from "@/features/equipment/remote";
import type { MyPartnershipItemDto } from "@/features/partnerships/remote";
import { parseOffsetDateTime, toSeoulLocalDateTime } from "@/features/referrals/offsetDateTime";
import type { ExamTypeDto } from "@/features/referrals/remote";
import { ApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";
import { addDays, type DateKey } from "@/lib/date/seoulDate";

import { matchesSlotFilter, type AvailabilityFilter } from "./availability";
import { SLOT_SEARCH_MAX_RANGE_DAYS, type SliceResponseDto, type SlotDetailDto, type SlotStatusDto } from "./remote";
import type { ExamSlot, PartnerOrganization } from "./types";

/**
 * 슬롯 검색 API 응답 → 화면 데이터 매핑 (순수 함수, 요청 없음).
 *
 * 슬롯 검색 응답(SlotDetailResponse)에는 id·equipmentId·examTypeId·시각·상태만 있다.
 * 기관명·장비명·검사 종류(CT/MRI)는 서버(slots/server.ts)가 따로 조회한 메타데이터로 붙인다:
 * - 협력 검사기관: GET /partnerships/me?status=ACTIVE (검사기관 EXAM만)
 * - 장비: GET /institutions/{협력 기관}/equipments (기관별 목록. 슬롯마다 장비 단건을 조회하지 않는다)
 * - 검사 유형: GET /exam-types (전체 페이지)
 * 메타데이터에 없는 장비·검사 유형이 있으면 오류다 (임의 이름·Mock 값으로 채우지 않고, 그 슬롯만 빼지도 않는다).
 */

/** 검색 API 슬롯 1건. 기존 화면 타입(ExamSlot)에 서버 원본 값을 더한다 */
export interface ApiExamSlot extends ExamSlot {
  /** 슬롯 UUID (서버 원본) */
  id: string;
  /** 검사기관 UUID (장비 응답의 institutionId 원본) */
  organizationId: string;
  /** 장비 UUID (서버 원본) */
  equipmentId: string;
  /** 검사 유형 UUID (서버 원본). 화면의 CT/MRI(examType)와 다르다: 같은 modality에 검사 유형이 여러 개일 수 있다 */
  examTypeId: string;
  /** 검사 유형 이름 (GET /exam-types 응답) */
  examTypeName: string;
  /** 서버 슬롯 상태 원본 (SEARCH 응답은 AVAILABLE만 온다) */
  status: SlotStatusDto;
  /** 서버 OffsetDateTime 원본 */
  startsAt: string;
  endsAt: string;
  /** 서울 기준 종료 시각 `YYYY-MM-DDTHH:mm` (startAt과 같은 형식) */
  endAt: string;
}

/** 매핑에 쓰는 메타데이터 (키는 소문자 UUID) */
export interface SlotSearchMetadata {
  /** ACTIVE 협약 검사기관 (이름순) */
  organizations: PartnerOrganization[];
  /** 전체 검사 유형 (서버 순서: 이름·ID순) */
  examTypes: ExamTypeDto[];
  organizationById: ReadonlyMap<string, PartnerOrganization>;
  equipmentById: ReadonlyMap<string, EquipmentDto>;
  examTypeById: ReadonlyMap<string, ExamTypeDto>;
}

export type SlotMappingFailure = {
  ok: false;
  /** METADATA_MISSING: 장비·검사 유형·기관을 찾을 수 없음. METADATA_MISMATCH: 값끼리 맞지 않음. INVALID_TIME: 시각 변환 실패 */
  reason: "METADATA_MISSING" | "METADATA_MISMATCH" | "INVALID_TIME";
  message: string;
};

const key = (id: string) => id.toLowerCase();

/** 내 기관 협약 → 검색에 쓸 협력 검사기관 (ACTIVE·EXAM만, 중복 제거, 이름순). PENDING·REJECTED·TERMINATED는 뺀다 */
export function toPartnerOrganizations(partnerships: readonly MyPartnershipItemDto[]): PartnerOrganization[] {
  const byId = new Map<string, PartnerOrganization>();
  for (const item of partnerships) {
    if (item.status !== "ACTIVE" || item.partnerInstitutionType !== "EXAM") continue;
    byId.set(key(item.partnerInstitutionId), { id: item.partnerInstitutionId, name: item.partnerInstitutionName });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
}

/**
 * 메타데이터 묶기. 장비는 협력 기관별 목록으로 받은 것만 넣는다.
 * 장비의 institutionId가 협력 기관이 아니면(요청한 기관과 다른 장비가 오면) 계약 위반으로 본다.
 */
export function buildSlotSearchMetadata(input: {
  organizations: readonly PartnerOrganization[];
  examTypes: readonly ExamTypeDto[];
  equipments: readonly EquipmentDto[];
}): { ok: true; metadata: SlotSearchMetadata } | SlotMappingFailure {
  const organizationById = new Map(input.organizations.map((item) => [key(item.id), item]));
  const equipmentById = new Map<string, EquipmentDto>();
  for (const equipment of input.equipments) {
    if (!organizationById.has(key(equipment.institutionId))) {
      return { ok: false, reason: "METADATA_MISMATCH", message: "협력 검사기관이 아닌 기관의 장비 정보가 포함되어 있습니다." };
    }
    equipmentById.set(key(equipment.id), equipment);
  }
  const examTypeById = new Map(input.examTypes.map((item) => [key(item.id), item]));
  return {
    ok: true,
    metadata: { organizations: [...input.organizations], examTypes: [...input.examTypes], organizationById, equipmentById, examTypeById },
  };
}

/** OffsetDateTime → 서울 `YYYY-MM-DDTHH:mm` (변환할 수 없으면 null) */
export function toSeoulMinute(offsetDateTime: string): string | null {
  const parsed = parseOffsetDateTime(offsetDateTime);
  const local = parsed && toSeoulLocalDateTime(parsed);
  return local ? local.slice(0, 16) : null;
}

/**
 * 슬롯 검색 결과 → 화면 슬롯 (서울 시작 시각·ID순).
 * 하나라도 메타데이터가 없거나 맞지 않으면 전체를 실패로 돌려준다 (일부만 보여 주면 결과가 빠진 것을 알 수 없다).
 */
export function mapApiSlots(
  slots: readonly SlotDetailDto[],
  metadata: SlotSearchMetadata,
): { ok: true; slots: ApiExamSlot[] } | SlotMappingFailure {
  const mapped: ApiExamSlot[] = [];
  let missingEquipment = 0;
  let missingExamType = 0;
  let mismatch = 0;
  for (const slot of slots) {
    const equipment = metadata.equipmentById.get(key(slot.equipmentId));
    const examType = metadata.examTypeById.get(key(slot.examTypeId));
    const organization = equipment && metadata.organizationById.get(key(equipment.institutionId));
    if (!equipment || !organization) missingEquipment++;
    if (!examType) missingExamType++;
    if (!equipment || !organization || !examType) continue;
    if (equipment.modality !== examType.modality) {
      mismatch++;
      continue;
    }
    const startAt = toSeoulMinute(slot.startsAt);
    const endAt = toSeoulMinute(slot.endsAt);
    if (startAt === null || endAt === null) {
      return { ok: false, reason: "INVALID_TIME", message: "슬롯 시각을 한국 시간으로 바꾸지 못했습니다." };
    }
    mapped.push({
      id: slot.id,
      organizationId: equipment.institutionId,
      organizationName: organization.name,
      equipmentId: slot.equipmentId,
      equipmentName: equipment.name,
      examType: examType.modality,
      examTypeId: slot.examTypeId,
      examTypeName: examType.name,
      status: slot.status,
      isAvailable: slot.status === "AVAILABLE",
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      startAt,
      endAt,
    });
  }
  if (missingEquipment > 0 || missingExamType > 0) {
    return {
      ok: false,
      reason: "METADATA_MISSING",
      message: `슬롯의 ${[missingEquipment > 0 ? `장비 정보 ${missingEquipment}건` : "", missingExamType > 0 ? `검사 유형 정보 ${missingExamType}건` : ""].filter(Boolean).join(", ")}을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.`,
    };
  }
  if (mismatch > 0) {
    return { ok: false, reason: "METADATA_MISMATCH", message: `장비 종류와 검사 유형이 맞지 않는 슬롯이 ${mismatch}건 있습니다.` };
  }
  return { ok: true, slots: mapped.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)) };
}

// ── 검색 기간 ──

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** 서울 기준 그날 00:00 OffsetDateTime (`YYYY-MM-DDT00:00:00+09:00`) */
export const toSeoulDayStart = (date: DateKey) => `${date}T00:00:00+09:00`;

export interface SlotSearchWindow {
  /** 서울 날짜 (포함) */
  startDate: DateKey;
  /** 서울 날짜 (제외) */
  endDateExclusive: DateKey;
  from: string;
  to: string;
}

/**
 * 서울 날짜 범위 [startDate, endDateExclusive) → 31일 이하 검색 구간 목록 (앞에서부터 31일씩).
 * 달력(기존 Mock 120일)처럼 긴 범위는 한 번에 요청하지 않고 구간마다 따로 요청해야 한다. 날짜가 잘못되면 null.
 */
export function splitSearchRange(startDate: DateKey, endDateExclusive: DateKey): SlotSearchWindow[] | null {
  if (!isDateKey(startDate) || !isDateKey(endDateExclusive) || !(startDate < endDateExclusive)) return null;
  const windows: SlotSearchWindow[] = [];
  let cursor = startDate;
  while (cursor < endDateExclusive) {
    const limit = addDays(cursor, SLOT_SEARCH_MAX_RANGE_DAYS);
    const end = limit < endDateExclusive ? limit : endDateExclusive;
    windows.push({ startDate: cursor, endDateExclusive: end, from: toSeoulDayStart(cursor), to: toSeoulDayStart(end) });
    cursor = end;
  }
  return windows;
}

function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// ── 날짜별 가용 여부 ──

/**
 * 날짜별 예약 가능 슬롯 수 (서울 날짜 → 개수). 조건(검사 종류·기관·시간대)은 Mock 화면과 같은 matchesSlotFilter를 쓴다.
 * SEARCH 응답은 미래 AVAILABLE 슬롯만 오므로 '마감(FULL)'과 '슬롯 없음'을 구분할 수 없다: 맵에 없는 날짜 = 예약 가능한 슬롯 없음.
 */
export function buildApiDateAvailability(slots: readonly ApiExamSlot[], filter: AvailabilityFilter): Record<DateKey, number> {
  const counts: Record<DateKey, number> = {};
  for (const slot of slots) {
    if (!slot.isAvailable || !matchesSlotFilter(slot, filter)) continue;
    const date = slot.startAt.slice(0, 10);
    counts[date] = (counts[date] ?? 0) + 1;
  }
  return counts;
}

// ── 페이지 모으기 ──

const parseError = (message: string, body?: unknown) => new ApiError("PARSE", message, { body });

/**
 * Page 응답(PagedResponse) 전체 모으기: 0페이지부터 totalPages까지 차례로 요청한다.
 * 페이지 번호가 다르거나, 도중에 totalElements·totalPages가 바뀌거나, 모은 개수가 totalElements와 다르면 PARSE 오류
 * (중간에 목록이 바뀌어 빠지거나 겹친 항목이 있을 수 있다). maxPages를 넘으면 일부만 쓰지 않고 오류.
 */
export async function collectAllPages<T>(fetchPage: (page: number) => Promise<PagedResponseDto<T>>, maxPages: number): Promise<T[]> {
  const first = await fetchPage(0);
  if (first.number !== 0) throw parseError("서버 응답 형식을 확인할 수 없습니다.", first);
  if (first.totalPages > maxPages) throw parseError("목록이 너무 많아 모두 불러오지 못했습니다.");
  const items = [...first.contents];
  for (let page = 1; page < first.totalPages; page++) {
    const next = await fetchPage(page);
    if (next.number !== page || next.totalPages !== first.totalPages || next.totalElements !== first.totalElements) {
      throw parseError("목록을 불러오는 중 내용이 바뀌었습니다. 다시 시도해 주세요.");
    }
    items.push(...next.contents);
  }
  if (items.length !== first.totalElements) throw parseError("목록을 불러오는 중 내용이 바뀌었습니다. 다시 시도해 주세요.");
  return items;
}

export type SliceCollectResult<T> = { ok: true; items: T[]; pages: number } | { ok: false; reason: "TOO_MANY_RESULTS"; pages: number };

/**
 * Slice 응답(hasNext) 전체 모으기: hasNext가 false가 될 때까지 다음 페이지를 요청한다.
 * maxPages에서 hasNext가 아직 true면 일부를 전체처럼 돌려주지 않고 TOO_MANY_RESULTS.
 * 페이지 사이에 같은 슬롯이 다시 오면(목록 변경) 한 번만 넣는다.
 */
export async function collectSlicePages<T extends { id: string }>(
  fetchPage: (page: number) => Promise<SliceResponseDto<T>>,
  maxPages: number,
): Promise<SliceCollectResult<T>> {
  const byId = new Map<string, T>();
  for (let page = 0; page < maxPages; page++) {
    const slice = await fetchPage(page);
    for (const item of slice.items) if (!byId.has(key(item.id))) byId.set(key(item.id), item);
    if (!slice.hasNext) return { ok: true, items: [...byId.values()], pages: page + 1 };
  }
  return { ok: false, reason: "TOO_MANY_RESULTS", pages: maxPages };
}

/** 동시 요청 수를 제한해 차례로 처리 (결과는 입력 순서) */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
