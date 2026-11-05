import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import { ApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

/**
 * 검사기관 확정 예약 화면의 보조 실제 API (institution-service, Gateway 경유). 예약 자체는 features/referrals/remote.ts를 쓴다.
 *
 * 장비 목록 `GET /api/v1/institutions/{institutionId}/equipments?page&size` (origin/dev 898b449 기준)
 * - Gateway: REQUESTER·EXAMINER. 서비스: 검사기관 사용자는 자기 기관 장비만 (그 밖은 403)
 * - 기관 ID는 서버가 users/me로 확인한 로그인 사용자 소속 기관만 넣는다 (브라우저 값으로 정하지 않는다)
 * - 응답 EquipmentDetailResponse 중 화면에 쓰는 필드만 둔다 (장비 이름은 예약 목록·필터 표시용)
 */

type RequestOptions = Pick<ApiRequestOptions, "headers" | "signal">;

/** 장비 상태 (institution-service EquipmentStatus) */
export type EquipmentStatusDto = "OPERATIONAL" | "MAINTENANCE" | "FAILED";
const EQUIPMENT_STATUSES: readonly EquipmentStatusDto[] = ["OPERATIONAL", "MAINTENANCE", "FAILED"];

export interface InstitutionEquipmentDto {
  id: string;
  institutionId: string;
  name: string;
  modality: "CT" | "MRI";
  status: EquipmentStatusDto;
}

/** 장비 목록 한 페이지 최대 크기 (백엔드 1~100) */
export const EQUIPMENT_MAX_PAGE_SIZE = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchInstitutionEquipments(
  institutionId: string,
  { page = 0, size = EQUIPMENT_MAX_PAGE_SIZE }: { page?: number; size?: number } = {},
  options: RequestOptions = {},
): Promise<PagedResponseDto<InstitutionEquipmentDto>> {
  requireApiFeature("reservations");
  if (!UUID_PATTERN.test(institutionId)) throw new ApiError("CONFIG", "기관 ID 형식이 올바르지 않습니다.");
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > EQUIPMENT_MAX_PAGE_SIZE) {
    throw new ApiError("CONFIG", "페이지 조건이 올바르지 않습니다.");
  }
  const data = await apiRequestData<unknown>(`/api/v1/institutions/${encodeURIComponent(institutionId)}/equipments`, { ...options, query: { page, size } });
  if (!isPage(data)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  return data;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isEquipment(value: unknown): value is InstitutionEquipmentDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.institutionId === "string" &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    (value.modality === "CT" || value.modality === "MRI") &&
    EQUIPMENT_STATUSES.includes(value.status as EquipmentStatusDto)
  );
}

function isPage(value: unknown): value is PagedResponseDto<InstitutionEquipmentDto> {
  return (
    isRecord(value) &&
    Array.isArray(value.contents) &&
    value.contents.every(isEquipment) &&
    [value.totalElements, value.totalPages, value.size, value.number].every((n) => Number.isSafeInteger(n) && (n as number) >= 0)
  );
}
