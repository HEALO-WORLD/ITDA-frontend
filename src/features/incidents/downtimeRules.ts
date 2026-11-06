import { parseDateKey, toDateKey } from "@/lib/date/seoulDate";

/**
 * 장비 장애(중단) 등록 입력 규칙 (API 모드 전용, 브라우저·서버 공통 순수 함수).
 * Mock 장애 등록(rules.ts의 occurredAt 모델)과 섞지 않는다: API는 시작(startedAt)·종료 예정(endedAt) 구간을 받는다.
 *
 * 백엔드 계약 (slot-service EquipmentDowntimeCreateRequest·EquipmentDowntimeService, 로컬 feat/equipment-downtime 기준):
 * - equipmentId(UUID)·startedAt·endedAt(OffsetDateTime)·reason 모두 필수
 * - reason: @NotBlank, @Size(max = 500) — Java String.length(UTF-16 단위)로 센다. 서버가 strip해서 저장한다
 * - 시작 < 종료 (아니면 400 DOWNTIME_INVALID_TIME_RANGE), 종료 > 현재 (아니면 400 DOWNTIME_END_NOT_FUTURE). 시작은 과거 허용
 * 화면 입력은 한국 시간 `YYYY-MM-DDTHH:mm`이고, 요청 직전에 `:00+09:00`을 붙인다 (브라우저·서버 시간대를 쓰지 않는다).
 */

/** 장애 사유 최대 길이 (백엔드 EquipmentDowntime.REASON_MAX_LENGTH) */
export const DOWNTIME_REASON_MAX_LENGTH = 500;

/** 화면 입력값 (한국 시간 `YYYY-MM-DDTHH:mm`) */
export interface DowntimeFormInput {
  equipmentId: string;
  startedAt: string;
  endedAt: string;
  reason: string;
}

export type DowntimeField = keyof DowntimeFormInput;
export type DowntimeFormErrors = Partial<Record<DowntimeField, string>>;

const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** 실제로 있는 한국 시간 `YYYY-MM-DDTHH:mm`인지 (2월 30일·25시 등은 거절) */
export function isSeoulLocalMinute(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = LOCAL_MINUTE.exec(value);
  if (!match) return false;
  const [, , , , hour, minute] = match;
  if (Number(hour) > 23 || Number(minute) > 59) return false;
  const dateKey = value.slice(0, 10);
  const { year, month, day } = parseDateKey(dateKey);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && toDateKey(year, month, day) === dateKey && new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

/** 한국 시간 `YYYY-MM-DDTHH:mm` → OffsetDateTime 문자열 (`YYYY-MM-DDTHH:mm:00+09:00`). 형식이 틀리면 null */
export function toSeoulOffsetDateTime(local: string): string | null {
  return isSeoulLocalMinute(local) ? `${local}:00+09:00` : null;
}

/** 사유 길이 (백엔드 @Size와 같은 UTF-16 단위, 앞뒤 공백 제외) */
export const downtimeReasonLength = (reason: string) => reason.trim().length;

/**
 * 입력 검증. 문제가 있는 항목만 담는다.
 * @param equipmentIds 서버에서 조회한 우리 기관 장비 ID (소문자). 이 안의 장비만 선택할 수 있다
 * @param nowDateTime 현재 한국 시간 `YYYY-MM-DDTHH:mm`
 */
export function validateDowntimeForm(
  { equipmentId, startedAt, endedAt, reason }: DowntimeFormInput,
  { equipmentIds, nowDateTime }: { equipmentIds: ReadonlySet<string>; nowDateTime: string },
): DowntimeFormErrors {
  const errors: DowntimeFormErrors = {};

  if (!equipmentId) errors.equipmentId = "장애 장비를 선택해 주세요.";
  else if (!equipmentIds.has(equipmentId.toLowerCase())) errors.equipmentId = "우리 기관 장비 목록에 없는 장비입니다. 목록에서 다시 선택해 주세요.";

  const startValid = isSeoulLocalMinute(startedAt);
  if (!startValid) errors.startedAt = "장애 시작 날짜와 시각을 입력해 주세요.";

  if (!endedAt || endedAt.length < 16) errors.endedAt = "장애 종료 예정 날짜와 시각을 입력해 주세요.";
  else if (!isSeoulLocalMinute(endedAt)) errors.endedAt = "장애 종료 예정 일시가 올바르지 않습니다.";
  else if (startValid && endedAt <= startedAt) errors.endedAt = "종료 예정 일시는 장애 시작 일시 이후여야 합니다.";
  else if (endedAt <= nowDateTime) errors.endedAt = "종료 예정 일시는 현재 시각 이후여야 합니다.";

  const length = downtimeReasonLength(reason);
  if (length === 0) errors.reason = "장애 사유를 입력해 주세요.";
  else if (length > DOWNTIME_REASON_MAX_LENGTH) errors.reason = `장애 사유는 ${DOWNTIME_REASON_MAX_LENGTH}자 이하로 입력해 주세요.`;

  return errors;
}

export const hasDowntimeErrors = (errors: DowntimeFormErrors) => Object.values(errors).some(Boolean);
