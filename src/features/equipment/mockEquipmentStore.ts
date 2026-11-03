import type { ExamSlot, ExamType } from "@/features/slots/types";
import { getMockOnlyError } from "@/lib/api/config";
import { addDays, getSeoulNow } from "@/lib/date/seoulDate";
import { createMockChangeStore } from "@/lib/dev/mockChangeStore";
import { MOCK_REFERRAL_SUMMARIES } from "@/lib/dev/mockReferrals";
import {
  getMockEquipmentsByOrganization,
  getMockOperatingHours,
  getMockSlots,
  MOCK_PARTNER_ORGANIZATIONS,
  MOCK_RANGE_DAYS,
  MOCK_SLOT_MINUTES,
} from "@/lib/dev/mockSlots";

import {
  hasErrors,
  hasOpenDay,
  normalizeEquipmentName,
  previewSlotGeneration,
  validateEquipmentInput,
  toOperatingHours,
  validateOperatingDay,
  type EquipmentInput,
  type OperatingDayInput,
  type SlotGenerationInput,
  type SlotGenerationPreview,
} from "./rules";
import { normalizeSupportedExamTypeIds, splitByModality } from "./supportedExamTypes";
import type { DailyOperatingHours } from "./types";

/**
 * ⚠️ 개발용 Mock 장비·슬롯 변경 저장소 (실제 서버 저장 아님)
 *
 * 장비·운영 시간·슬롯은 "원본 Mock(mockSlots.ts) + 이 브라우저에서 바꾼 내용"으로 계산한다.
 * 원본 Mock은 수정하지 않고, 바꾼 내용만 localStorage에 둔다 (환자 정보는 저장하지 않는다).
 * - 장비 등록·수정, 운영 시간 수정, 슬롯 생성, (생성한) 슬롯 운영 중단·재개
 * - 장비 상태(장애 여부)는 여기서 관리하지 않는다 → 장애 이력(features/incidents/mockIncidentStore.ts) 기준
 * - 서버에서는 원본 Mock만 보이며, 화면은 useMockEquipment.ts의 훅으로 hydration 후 변경분을 반영한다
 *
 * 원본 슬롯의 '예약 불가'는 예약 완료·HOLD·마감을 구분할 수 없으므로 운영 중단·재개는 이 저장소에서
 * 생성한 슬롯에만 허용한다 (원본 슬롯 상태는 추측해서 바꾸지 않는다).
 *
 * TODO(api): 장비 등록·수정, 운영 시간 조회·수정, 슬롯 생성, 슬롯 운영 중단·재개 API가 확정되면
 * 아래 함수의 시그니처를 유지하고 내부만 Gateway 호출로 바꾼 뒤 이 파일을 제거한다.
 */

/* ───────────── 저장 형태 ───────────── */

interface CreatedEquipment {
  id: string;
  organizationId: string;
  name: string;
  examType: ExamType;
  slotMinutes: number;
  /** 지원 검사 유형 (이전 버전 저장값에는 없다) */
  supportedExamTypeIds?: string[];
}

interface EquipmentEdit {
  name?: string;
  examType?: ExamType;
  slotMinutes?: number;
  supportedExamTypeIds?: string[];
}

/** 생성한 슬롯 (장비명·기관명은 저장하지 않고 장비 ID로 찾는다) */
interface CreatedSlot {
  id: string;
  organizationId: string;
  equipmentId: string;
  /** `YYYY-MM-DDTHH:mm` (한국 시간) */
  startAt: string;
}

export interface EquipmentChanges {
  equipments: CreatedEquipment[];
  /** 장비 ID → 수정한 값 (원본 장비·등록 장비 공통) */
  edits: Record<string, EquipmentEdit>;
  /** 장비 ID → 운영 시간 (원본 운영 시간 대신 사용) */
  operatingHours: Record<string, DailyOperatingHours[]>;
  slots: CreatedSlot[];
  /** 운영 중단한 슬롯 ID (생성한 슬롯만) */
  suspendedSlotIds: string[];
}

const EMPTY_CHANGES: EquipmentChanges = Object.freeze({
  equipments: [],
  edits: {},
  operatingHours: {},
  slots: [],
  suspendedSlotIds: [],
}) as EquipmentChanges;

const isString = (value: unknown): value is string => typeof value === "string";
const isExamType = (value: unknown): value is ExamType => value === "CT" || value === "MRI";
const isTime = (value: unknown): value is string => isString(value) && /^\d{2}:\d{2}$/.test(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function parseHours(value: unknown): DailyOperatingHours[] | null {
  if (!Array.isArray(value)) return null;
  const hours = value.filter(
    (item): item is DailyOperatingHours =>
      Number.isInteger(item?.weekday) &&
      item.weekday >= 0 &&
      item.weekday <= 6 &&
      isTime(item.open) &&
      isTime(item.close) &&
      (item.breakTime === undefined || (isTime(item.breakTime?.start) && isTime(item.breakTime?.end))),
  );
  return hours.length === value.length ? hours : null;
}

/** 저장된 값을 검증한다. 형식이 맞지 않는 항목은 버린다 */
function parseChanges(raw: unknown): EquipmentChanges {
  const data = (raw ?? {}) as Partial<Record<keyof EquipmentChanges, unknown>>;
  const equipments = Array.isArray(data.equipments)
    ? data.equipments.filter(
        (item): item is CreatedEquipment =>
          isString(item?.id) &&
          isString(item.organizationId) &&
          isString(item.name) &&
          isExamType(item.examType) &&
          Number.isInteger(item.slotMinutes) &&
          item.slotMinutes > 0 &&
          (item.supportedExamTypeIds === undefined || isStringArray(item.supportedExamTypeIds)),
      )
    : [];
  const edits: Record<string, EquipmentEdit> = {};
  if (data.edits && typeof data.edits === "object") {
    for (const [id, edit] of Object.entries(data.edits as Record<string, EquipmentEdit>)) {
      edits[id] = {
        ...(isString(edit?.name) ? { name: edit.name } : {}),
        ...(isExamType(edit?.examType) ? { examType: edit.examType } : {}),
        ...(Number.isInteger(edit?.slotMinutes) ? { slotMinutes: edit.slotMinutes } : {}),
        ...(isStringArray(edit?.supportedExamTypeIds) ? { supportedExamTypeIds: edit.supportedExamTypeIds } : {}),
      };
    }
  }
  const operatingHours: Record<string, DailyOperatingHours[]> = {};
  if (data.operatingHours && typeof data.operatingHours === "object") {
    for (const [id, hours] of Object.entries(data.operatingHours)) {
      const parsed = parseHours(hours);
      if (parsed) operatingHours[id] = parsed;
    }
  }
  const slots = Array.isArray(data.slots)
    ? data.slots.filter(
        (item): item is CreatedSlot =>
          isString(item?.id) &&
          isString(item.organizationId) &&
          isString(item.equipmentId) &&
          isString(item.startAt) &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.startAt),
      )
    : [];
  const slotIds = new Set(slots.map(({ id }) => id));
  const suspendedSlotIds = Array.isArray(data.suspendedSlotIds)
    ? data.suspendedSlotIds.filter((id): id is string => isString(id) && slotIds.has(id))
    : [];
  return { equipments, edits, operatingHours, slots, suspendedSlotIds };
}

export const equipmentChangeStore = createMockChangeStore<EquipmentChanges>({
  key: "itda.dev.equipmentChanges.v1",
  empty: EMPTY_CHANGES,
  parse: parseChanges,
  isEmpty: (changes) =>
    changes.equipments.length === 0 &&
    Object.keys(changes.edits).length === 0 &&
    Object.keys(changes.operatingHours).length === 0 &&
    changes.slots.length === 0 &&
    changes.suspendedSlotIds.length === 0,
});

/** 저장된 변경 건수 (개발용 초기화 버튼 표시용) */
export const countEquipmentChanges = (changes: EquipmentChanges) =>
  changes.equipments.length +
  Object.keys(changes.edits).length +
  Object.keys(changes.operatingHours).length +
  changes.slots.length;

/* ───────────── 읽기 (원본 + 변경분 합치기) ───────────── */

/** 장비 화면용 정보 (상태 제외: 상태는 장애 이력으로 따로 계산한다) */
export interface EffectiveEquipment {
  id: string;
  organizationId: string;
  name: string;
  examType: ExamType;
  slotMinutes: number;
  operatingHours: DailyOperatingHours[];
  /** 지원 검사 유형 ID. 한 번도 설정하지 않은 장비(원본 Mock 등)는 null */
  supportedExamTypeIds?: readonly string[] | null;
  /** 이 브라우저에서 등록한 장비 */
  isCreated: boolean;
}

/** 현재 기관 장비 (원본 + 등록 장비, 수정·운영 시간 반영). 다른 기관 장비는 포함하지 않는다 */
export function getEffectiveEquipmentsFrom(changes: EquipmentChanges, organizationId: string): EffectiveEquipment[] {
  const baseHours = getMockOperatingHours(organizationId);
  const base = getMockEquipmentsByOrganization(organizationId).map((equipment) => ({
    ...equipment,
    slotMinutes: MOCK_SLOT_MINUTES,
    operatingHours: baseHours,
    supportedExamTypeIds: null as string[] | null,
    isCreated: false,
  }));
  const created = changes.equipments
    .filter((equipment) => equipment.organizationId === organizationId)
    .map((equipment) => ({
      ...equipment,
      operatingHours: [] as DailyOperatingHours[],
      supportedExamTypeIds: equipment.supportedExamTypeIds ?? null,
      isCreated: true,
    }));

  return [...base, ...created].map((equipment) => ({
    ...equipment,
    ...changes.edits[equipment.id],
    operatingHours: changes.operatingHours[equipment.id] ?? equipment.operatingHours,
  }));
}

export function getEffectiveEquipments(organizationId: string): EffectiveEquipment[] {
  return getEffectiveEquipmentsFrom(equipmentChangeStore.read(), organizationId);
}

const organizationNameById = new Map(MOCK_PARTNER_ORGANIZATIONS.map(({ id, name }) => [id, name]));

/**
 * 전체 슬롯 (원본 Mock + 생성한 슬롯). 장비 장애 차단은 적용하지 않은 값이다.
 * - 원본 슬롯은 예약 가능 여부를 그대로 두고, 장비명만 수정한 이름으로 바꾼다
 * - 생성한 슬롯은 예약 데이터와 연결되지 않으므로 운영 중단만 예약 불가로 본다
 */
export function getAllMockSlotsFrom(changes: EquipmentChanges): ExamSlot[] {
  const baseSlots = getMockSlots(getSeoulNow().dateKey);
  const renamed = Object.entries(changes.edits).filter(([, edit]) => edit.name !== undefined);
  const nameById = new Map(renamed.map(([id, edit]) => [id, edit.name as string]));
  const slots: ExamSlot[] = nameById.size
    ? baseSlots.map((slot) =>
        nameById.has(slot.equipmentId) ? { ...slot, equipmentName: nameById.get(slot.equipmentId) as string } : slot,
      )
    : [...baseSlots];

  if (changes.slots.length === 0) return slots;
  const suspended = new Set(changes.suspendedSlotIds);
  const equipmentById = new Map<string, EffectiveEquipment>();
  for (const organizationId of new Set(changes.slots.map((slot) => slot.organizationId))) {
    for (const equipment of getEffectiveEquipmentsFrom(changes, organizationId)) equipmentById.set(equipment.id, equipment);
  }
  for (const slot of changes.slots) {
    const equipment = equipmentById.get(slot.equipmentId);
    if (!equipment) continue;
    const isSuspended = suspended.has(slot.id);
    slots.push({
      id: slot.id,
      organizationId: slot.organizationId,
      organizationName: organizationNameById.get(slot.organizationId) ?? slot.organizationId,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      examType: equipment.examType,
      startAt: slot.startAt,
      isAvailable: !isSuspended,
      ...(isSuspended ? { blockedReason: "OPERATOR_SUSPENDED" as const } : {}),
    });
  }
  return slots;
}

export function getAllMockSlots(): ExamSlot[] {
  return getAllMockSlotsFrom(equipmentChangeStore.read());
}

/** 이 브라우저에서 생성한 슬롯인지 (운영 중단·재개 가능 대상) */
export function isCreatedSlot(changes: EquipmentChanges, slotId: string): boolean {
  return changes.slots.some(({ id }) => id === slotId);
}

/** 슬롯 데이터 조회 가능 마지막 날 (원본 Mock 생성 범위와 같다) */
export const getSlotRangeEnd = (today = getSeoulNow().dateKey) => addDays(today, MOCK_RANGE_DAYS - 1);

/* ───────────── 수정 가능 여부 ───────────── */

export interface EquipmentEditLocks {
  name: string | null;
  examType: string | null;
  slotMinutes: string | null;
}

/**
 * 장비 정보 중 바꿀 수 없는 항목과 이유.
 * - 원본 장비: 원본 슬롯이 연결되어 있어 검사 유형·소요 시간을 바꾸지 않는다.
 *   예약 데이터가 장비 ID 없이 장비명으로 연결되어 있어, 예약이 있는 장비는 이름도 바꾸지 않는다
 * - 등록 장비: 생성한 슬롯이 있으면 검사 유형·소요 시간을 바꾸지 않는다
 */
export function getEquipmentEditLocksFrom(changes: EquipmentChanges, equipment: EffectiveEquipment): EquipmentEditLocks {
  const hasCreatedSlots = changes.slots.some((slot) => slot.equipmentId === equipment.id);
  const slotLock = !equipment.isCreated
    ? "기존 슬롯이 연결된 장비라 변경할 수 없습니다."
    : hasCreatedSlots
      ? "생성한 슬롯이 있어 변경할 수 없습니다. (슬롯 정리 정책은 API 연동 후 확정)"
      : null;
  const hasReservations =
    !equipment.isCreated &&
    MOCK_REFERRAL_SUMMARIES.some(
      (referral) => referral.organizationId === equipment.organizationId && referral.equipmentName === equipment.name,
    );
  return {
    name: hasReservations ? "예약 데이터가 장비명으로 연결되어 있어 변경할 수 없습니다." : null,
    examType: slotLock,
    slotMinutes: slotLock,
  };
}

/* ───────────── 쓰기 (Mock) ───────────── */

/** Mock 처리 지연(ms). 처리 중 상태·중복 클릭 방지를 확인하기 위한 값 */
const MOCK_DELAY_MS = 400;
const wait = () => new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

export type MutationResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const isKnownOrganization = (organizationId: string) => organizationNameById.has(organizationId);

const firstError = (errors: object) => Object.values(errors).find(Boolean) as string | undefined;

/** 장비 등록 (Mock). 장비 상태는 정상으로 시작하며(진행 중 장애가 없으므로) 운영 시간은 등록 후 설정한다 */
export async function registerMockEquipment(
  organizationId: string,
  input: EquipmentInput,
  /** 지원 검사 유형 (생략하면 미설정) */
  supportedExamTypeIds?: readonly string[],
): Promise<MutationResult<EffectiveEquipment>> {
  const mockOnlyError = getMockOnlyError("equipment.registerEquipment");
  if (mockOnlyError) return { ok: false, message: mockOnlyError.message };
  await wait();
  if (!isKnownOrganization(organizationId)) return { ok: false, message: "장비를 등록할 수 없는 기관입니다." };
  const changes = equipmentChangeStore.read();
  const current = getEffectiveEquipmentsFrom(changes, organizationId);
  const errors = validateEquipmentInput(input, current.map(({ name }) => name));
  if (hasErrors(errors)) return { ok: false, message: firstError(errors) ?? "입력값을 확인해 주세요." };
  const supported = supportedExamTypeIds && normalizeSupportedExamTypeIds(supportedExamTypeIds, input.examType as ExamType);
  if (supported && !supported.ok) return { ok: false, message: supported.message };

  const sequence =
    Math.max(0, ...changes.equipments.map(({ id }) => Number(id.split("-").pop()) || 0)) + 1;
  const equipment: CreatedEquipment = {
    id: `local-eq-${organizationId}-${sequence}`,
    organizationId,
    name: input.name.trim(),
    examType: input.examType as ExamType,
    slotMinutes: Number(input.slotMinutes),
    ...(supported ? { supportedExamTypeIds: supported.ids } : {}),
  };
  const next = { ...changes, equipments: [...changes.equipments, equipment] };
  equipmentChangeStore.write(next);
  return { ok: true, value: getEffectiveEquipmentsFrom(next, organizationId).find(({ id }) => id === equipment.id)! };
}

export type RegisterWithHoursResult =
  | { ok: true; equipment: EffectiveEquipment }
  /** 아무것도 저장하지 않음 (입력 검증 실패 또는 장비 등록 실패) */
  | { ok: false; savedStage: "NONE"; message: string }
  /** 장비는 저장됐지만 운영 시간은 저장하지 못함 → 같은 장비 ID로 운영 시간만 다시 저장해야 한다 */
  | { ok: false; savedStage: "EQUIPMENT_ONLY"; message: string; equipment: EffectiveEquipment };

/**
 * 장비 등록 + 운영 시간 설정 (장비 등록 2단계의 최종 저장, Mock).
 * 실제 API 연동 시 같은 순서로 교체한다: 1) 장비 등록 API → 2) 반환된 equipmentId로 운영 시간 설정 API.
 * 저장 전에 운영 시간(하루 이상 운영, 형식)을 먼저 검증해 검증 오류로 장비만 저장되는 일이 없게 한다.
 * 그래도 2단계에서 실패하면 장비만 저장된 상태(EQUIPMENT_ONLY)를 돌려줘 화면이 구분해 안내한다.
 * TODO(api): 두 API의 요청·응답 DTO와 실패 코드가 확정되면 메시지·재시도 정책을 맞춘다.
 */
export async function registerMockEquipmentWithOperatingHours(
  organizationId: string,
  input: EquipmentInput,
  days: readonly OperatingDayInput[],
  supportedExamTypeIds?: readonly string[],
): Promise<RegisterWithHoursResult> {
  const mockOnlyError = getMockOnlyError("equipment.registerEquipmentWithOperatingHours");
  if (mockOnlyError) return { ok: false, savedStage: "NONE", message: mockOnlyError.message };
  if (!hasOpenDay(days)) return { ok: false, savedStage: "NONE", message: "운영하는 요일을 하루 이상 설정해 주세요." };
  const invalidDay = days.map(validateOperatingDay).find(hasErrors);
  if (invalidDay) return { ok: false, savedStage: "NONE", message: firstError(invalidDay) ?? "운영 시간을 확인해 주세요." };

  const registered = await registerMockEquipment(organizationId, input, supportedExamTypeIds);
  if (!registered.ok) return { ok: false, savedStage: "NONE", message: registered.message };

  const hours = await updateMockOperatingHours(organizationId, registered.value.id, days);
  if (!hours.ok) {
    return { ok: false, savedStage: "EQUIPMENT_ONLY", message: hours.message, equipment: registered.value };
  }
  const equipment = getEffectiveEquipments(organizationId).find(({ id }) => id === registered.value.id) ?? registered.value;
  return { ok: true, equipment };
}

/** 장비 정보 수정 (Mock). 잠긴 항목은 바꾸지 않는다 */
export async function updateMockEquipment(
  organizationId: string,
  equipmentId: string,
  input: EquipmentInput,
  /** 지원 검사 유형 (생략하면 기존 값을 두되, 장비 종류와 맞지 않는 값은 지운다) */
  supportedExamTypeIds?: readonly string[],
): Promise<MutationResult> {
  const mockOnlyError = getMockOnlyError("equipment.updateEquipment");
  if (mockOnlyError) return { ok: false, message: mockOnlyError.message };
  await wait();
  const changes = equipmentChangeStore.read();
  const current = getEffectiveEquipmentsFrom(changes, organizationId);
  const equipment = current.find(({ id }) => id === equipmentId);
  if (!equipment) return { ok: false, message: "우리 기관 장비가 아닙니다." };
  const errors = validateEquipmentInput(
    input,
    current.filter(({ id }) => id !== equipmentId).map(({ name }) => name),
  );
  if (hasErrors(errors)) return { ok: false, message: firstError(errors) ?? "입력값을 확인해 주세요." };

  const locks = getEquipmentEditLocksFrom(changes, equipment);
  const name = input.name.trim();
  const examType = input.examType as ExamType;
  const slotMinutes = Number(input.slotMinutes);
  if (locks.name && normalizeEquipmentName(name) !== normalizeEquipmentName(equipment.name)) {
    return { ok: false, message: locks.name };
  }
  if (locks.examType && examType !== equipment.examType) return { ok: false, message: locks.examType };
  if (locks.slotMinutes && slotMinutes !== equipment.slotMinutes) return { ok: false, message: locks.slotMinutes };
  const supported = normalizeSupportedExamTypeIds(
    supportedExamTypeIds ?? splitByModality(equipment.supportedExamTypeIds ?? [], examType).kept,
    examType,
  );
  if (!supported.ok) return { ok: false, message: supported.message };
  const keepUnset = supportedExamTypeIds === undefined && equipment.supportedExamTypeIds == null;

  equipmentChangeStore.write({
    ...changes,
    edits: {
      ...changes.edits,
      [equipmentId]: {
        ...changes.edits[equipmentId],
        name,
        examType,
        slotMinutes,
        ...(keepUnset ? {} : { supportedExamTypeIds: supported.ids }),
      },
    },
  });
  return { ok: true, value: undefined };
}

/**
 * 운영 시간 수정 (Mock).
 * 이미 만들어진 슬롯·예약은 지우거나 바꾸지 않는다 (새 운영 시간은 이후 슬롯 생성에만 쓰인다).
 * TODO(api): 운영 시간 변경 시 기존 슬롯 처리 정책은 백엔드 확정 필요
 */
export async function updateMockOperatingHours(
  organizationId: string,
  equipmentId: string,
  days: readonly OperatingDayInput[],
): Promise<MutationResult> {
  const mockOnlyError = getMockOnlyError("equipment.updateOperatingHours");
  if (mockOnlyError) return { ok: false, message: mockOnlyError.message };
  await wait();
  const changes = equipmentChangeStore.read();
  if (!getEffectiveEquipmentsFrom(changes, organizationId).some(({ id }) => id === equipmentId)) {
    return { ok: false, message: "우리 기관 장비가 아닙니다." };
  }
  const invalid = days.map(validateOperatingDay).find(hasErrors);
  if (invalid) return { ok: false, message: firstError(invalid) ?? "운영 시간을 확인해 주세요." };
  equipmentChangeStore.write({
    ...changes,
    operatingHours: { ...changes.operatingHours, [equipmentId]: toOperatingHours(days) },
  });
  return { ok: true, value: undefined };
}

/** 슬롯 생성 미리보기에 쓰는 같은 장비 기존 슬롯 시작 일시 */
export function getEquipmentSlotStartAts(changes: EquipmentChanges, equipmentId: string): string[] {
  return getAllMockSlotsFrom(changes)
    .filter((slot) => slot.equipmentId === equipmentId)
    .map(({ startAt }) => startAt);
}

/**
 * 슬롯 생성 (Mock).
 * 저장 직전에 미리보기를 다시 계산해, 그사이 다른 탭에서 만든 슬롯이 있어도 겹치지 않게 한다.
 * 장애 진행 중 여부는 호출하는 쪽에서 장애 이력 기준으로 넘긴다 (이 저장소는 장애 상태를 관리하지 않는다).
 */
export async function generateMockSlots(
  organizationId: string,
  input: SlotGenerationInput,
  isEquipmentFailed: (equipmentId: string) => boolean,
): Promise<MutationResult<SlotGenerationPreview>> {
  const mockOnlyError = getMockOnlyError("equipment.generateSlots");
  if (mockOnlyError) return { ok: false, message: mockOnlyError.message };
  await wait();
  const changes = equipmentChangeStore.read();
  const equipment = getEffectiveEquipmentsFrom(changes, organizationId).find(({ id }) => id === input.equipmentId) ?? null;
  const { dateKey: today, dateTime: nowDateTime } = getSeoulNow();
  const preview = previewSlotGeneration(input, {
    equipment,
    isEquipmentFailed: equipment ? isEquipmentFailed(equipment.id) : false,
    existingStartAts: equipment ? getEquipmentSlotStartAts(changes, equipment.id) : [],
    existingSlotMinutes: equipment?.slotMinutes ?? MOCK_SLOT_MINUTES,
    today,
    nowDateTime,
    rangeEnd: getSlotRangeEnd(today),
  });
  if (preview.errors.length > 0 || !equipment) return { ok: false, message: preview.errors[0] ?? "생성할 수 없습니다." };

  const created: CreatedSlot[] = preview.startAts.map((startAt) => ({
    id: `local-slot-${equipment.id}-${startAt.replace(/[-:T]/g, "")}`,
    organizationId,
    equipmentId: equipment.id,
    startAt,
  }));
  equipmentChangeStore.write({ ...changes, slots: [...changes.slots, ...created] });
  return { ok: true, value: preview };
}

/** 슬롯 운영 중단·재개 가능 여부. 가능하면 null */
export function getSlotSuspendBlockReason(
  changes: EquipmentChanges,
  slot: ExamSlot,
  action: "SUSPEND" | "RESUME",
  nowDateTime: string,
): string | null {
  if (!isCreatedSlot(changes, slot.id)) {
    return "기존 슬롯은 예약 완료·HOLD 여부를 확인할 수 없어 운영 중단·재개할 수 없습니다.";
  }
  if (slot.startAt <= nowDateTime) return "이미 지난 슬롯입니다.";
  const isSuspended = changes.suspendedSlotIds.includes(slot.id);
  if (action === "SUSPEND" && isSuspended) return "이미 운영 중단한 슬롯입니다.";
  if (action === "RESUME" && !isSuspended) return "운영 중단한 슬롯만 재개할 수 있습니다.";
  return null;
}

/** 슬롯 운영 중단·재개 (Mock, 생성한 미래 슬롯만) */
export async function setMockSlotSuspended(
  organizationId: string,
  slot: ExamSlot,
  action: "SUSPEND" | "RESUME",
): Promise<MutationResult> {
  const mockOnlyError = getMockOnlyError("equipment.setSlotSuspended");
  if (mockOnlyError) return { ok: false, message: mockOnlyError.message };
  await wait();
  const changes = equipmentChangeStore.read();
  if (slot.organizationId !== organizationId) return { ok: false, message: "우리 기관 슬롯이 아닙니다." };
  const blockReason = getSlotSuspendBlockReason(changes, slot, action, getSeoulNow().dateTime);
  if (blockReason) return { ok: false, message: blockReason };
  equipmentChangeStore.write({
    ...changes,
    suspendedSlotIds:
      action === "SUSPEND"
        ? [...changes.suspendedSlotIds, slot.id]
        : changes.suspendedSlotIds.filter((id) => id !== slot.id),
  });
  return { ok: true, value: undefined };
}

/** 이 브라우저에서 등록한 장비 ID (초기화 시 관련 장애 기록 정리용) */
export const getCreatedEquipmentIds = () => equipmentChangeStore.read().equipments.map(({ id }) => id);

/** 개발용: 장비·운영 시간·슬롯 변경 내역을 지우고 원본 Mock 상태로 되돌린다 */
export function resetMockEquipmentChanges() {
  equipmentChangeStore.write(EMPTY_CHANGES);
}
