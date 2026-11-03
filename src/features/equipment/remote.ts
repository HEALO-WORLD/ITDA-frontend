import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";

/**
 * 장비 실제 API (institution-service, Gateway 경유).
 *
 * 백엔드 EquipmentController·EquipmentService·EquipmentDetailResponse를 기준으로 옮겼다 (ITDA 저장소 origin/dev bef664c 기준 확인).
 * 화면(api.ts의 Mock 함수, types.ts의 NORMAL·FAILURE 상태)은 아직 이 함수를 쓰지 않는다.
 * 재예약 전에 서버에서 슬롯의 장비가 속한 검사기관(institutionId)을 확인하는 데 쓸 예정이다.
 * 조회 성공은 그 장비로 재예약할 수 있다거나 슬롯을 확보했다는 뜻이 아니다.
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-User-Id·X-Institution-Id·X-Role을 붙인다 (프론트는 만들지 않는다).
 */

/** 백엔드 Modality */
export type EquipmentModalityDto = "CT" | "MRI";
/** 백엔드 EquipmentStatus (화면 Mock의 NORMAL·FAILURE와 다르다) */
export type EquipmentStatusDto = "OPERATIONAL" | "MAINTENANCE" | "FAILED";

const MODALITIES: readonly EquipmentModalityDto[] = ["CT", "MRI"];
const EQUIPMENT_STATUSES: readonly EquipmentStatusDto[] = ["OPERATIONAL", "MAINTENANCE", "FAILED"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 백엔드 EquipmentDetailResponse (ID는 UUID). institutionId는 장비를 가진 검사기관이다 */
export interface EquipmentDetailDto {
  id: string;
  institutionId: string;
  name: string;
  modality: EquipmentModalityDto;
  status: EquipmentStatusDto;
}

export const isEquipmentApiId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/**
 * 장비 단건 조회 `GET /api/v1/equipments/{equipmentId}`.
 * Gateway 권한(origin/dev 기준): REQUESTER·EXAMINER (ADMIN은 403 ACCESS_DENIED).
 * 서비스 권한: EXAMINER는 자기 기관 장비, REQUESTER는 ACTIVE 협약이 있는 검사기관의 장비만. 그 밖은 403 FORBIDDEN (정상적인 접근 거부).
 * 없는(삭제된) 장비는 404 RESOURCE_NOT_FOUND. UUID가 아니면 요청하지 않고 설정 오류,
 * 응답이 계약과 다르거나(필드 누락·모르는 값) 다른 장비면 PARSE 오류로 던진다.
 */
export async function fetchEquipmentDetail(
  equipmentId: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<EquipmentDetailDto> {
  requireApiFeature("equipment");
  if (!isEquipmentApiId(equipmentId)) {
    throw new ApiError("CONFIG", "장비 ID 형식이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/equipments/${equipmentId}`, options);
  if (!isEquipmentDetail(data) || data.id.toLowerCase() !== equipmentId.toLowerCase()) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

function isEquipmentDetail(value: unknown): value is EquipmentDetailDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    isEquipmentApiId(data.id) &&
    isEquipmentApiId(data.institutionId) &&
    typeof data.name === "string" &&
    MODALITIES.includes(data.modality as EquipmentModalityDto) &&
    EQUIPMENT_STATUSES.includes(data.status as EquipmentStatusDto)
  );
}

/** 장비 조회 오류 코드별 안내 (백엔드 ErrorCode·Gateway 코드 기준) */
const EQUIPMENT_DETAIL_ERROR_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: "장비를 찾을 수 없습니다.",
  INVALID_INPUT: "장비 ID가 올바르지 않습니다.",
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  // 협약 없음(REQUESTER)·다른 기관 장비(EXAMINER)·비활성 기관을 서버가 구분하지 않는다
  FORBIDDEN: "이 장비를 조회할 권한이 없습니다. 협약된 검사기관의 장비인지 확인해 주세요.",
  ACCESS_DENIED: "장비 정보를 조회할 권한이 없습니다.",
};

export function getEquipmentDetailErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "장비 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "HTTP" && error.status !== 401 && error.code && EQUIPMENT_DETAIL_ERROR_MESSAGES[error.code]) {
    return EQUIPMENT_DETAIL_ERROR_MESSAGES[error.code];
  }
  return error.message;
}
