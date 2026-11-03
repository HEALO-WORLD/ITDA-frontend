import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";

/**
 * 슬롯 실제 API (slot-service, Gateway 경유).
 *
 * 백엔드 SlotController·SlotService·SlotDetailResponse를 기준으로 옮겼다 (ITDA 저장소 origin/dev f6a0ad5 기준 확인).
 * 화면(api.ts의 Mock 함수)은 아직 이 함수를 쓰지 않는다. 재예약 전에 서버에서 슬롯을 다시 확인하는 데 쓸 예정이다.
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증한다. X-User-Id·X-Institution-Id·X-Role은 만들지 않는다.
 */

/** 백엔드 SlotStatus */
export type SlotStatusDto = "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE";

const SLOT_STATUSES: readonly SlotStatusDto[] = ["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Java OffsetDateTime 직렬화 문자열 (오프셋 필수: `Z` 또는 `±HH:mm`, 초·소수 초는 생략될 수 있다) */
const OFFSET_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 백엔드 SlotDetailResponse (ID는 UUID).
 * startsAt·endsAt은 서버가 Asia/Seoul 기준으로 만든 OffsetDateTime 문자열 원본이다 (예: `2026-11-05T10:00:00+09:00`).
 * 재예약 요청(CreateReservationRequest)은 시간대 없는 LocalDateTime을 쓰지만, 여기서는 변환하지 않는다.
 * 검사기관 ID는 응답에 없다 (재예약 요청에 필요한 examInstitutionId는 다른 경로로 확인해야 한다).
 */
export interface SlotDetailDto {
  id: string;
  equipmentId: string;
  examTypeId: string;
  startsAt: string;
  endsAt: string;
  status: SlotStatusDto;
}

export const isSlotApiId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/**
 * 슬롯 단건 조회 `GET /api/v1/slots/{slotId}`.
 * Gateway 권한(origin/dev 기준): REQUESTER·EXAMINER·ADMIN. 서비스는 기관·협약을 확인하지 않는다 (로그인하면 모든 슬롯 조회 가능).
 * 없는 슬롯은 404 RESOURCE_NOT_FOUND. UUID가 아니면 요청하지 않고 설정 오류,
 * 응답이 계약과 다르거나(필드 누락·모르는 상태·시각 형식) 다른 슬롯이면 PARSE 오류로 던진다.
 */
export async function fetchSlotDetail(
  slotId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<SlotDetailDto> {
  requireApiFeature("slots");
  if (!isSlotApiId(slotId)) {
    throw new ApiError("CONFIG", "슬롯 ID 형식이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/slots/${slotId}`, options);
  if (!isSlotDetail(data) || data.id.toLowerCase() !== slotId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

function isSlotDetail(value: unknown): value is SlotDetailDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    isSlotApiId(data.id) &&
    isSlotApiId(data.equipmentId) &&
    isSlotApiId(data.examTypeId) &&
    isOffsetDateTime(data.startsAt) &&
    isOffsetDateTime(data.endsAt) &&
    SLOT_STATUSES.includes(data.status as SlotStatusDto)
  );
}

/** OffsetDateTime 형식이고 실제 있는 날짜·시각·오프셋인지 (시간대 변환 없이 숫자만 확인) */
function isOffsetDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !OFFSET_DATE_TIME_PATTERN.test(value)) return false;
  const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/).map(Number);
  const second = value.length > 16 && value[16] === ":" ? Number(value.slice(17, 19)) : 0;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
  const offsetOk = !offset || (Number(offset[2]) <= 18 && Number(offset[3]) <= 59 && (Number(offset[2]) < 18 || offset[3] === "00"));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 && offsetOk;
}

/** 슬롯 조회 오류 코드별 안내 (백엔드 ErrorCode·Gateway 코드 기준) */
const SLOT_DETAIL_ERROR_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: "슬롯을 찾을 수 없습니다. 다른 슬롯을 선택해 주세요.",
  INVALID_INPUT: "슬롯 ID가 올바르지 않습니다.",
  ACCESS_DENIED: "슬롯 정보를 조회할 권한이 없습니다.",
};

export function getSlotDetailErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "슬롯 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && SLOT_DETAIL_ERROR_MESSAGES[error.code]) {
    return SLOT_DETAIL_ERROR_MESSAGES[error.code];
  }
  return error.message;
}
