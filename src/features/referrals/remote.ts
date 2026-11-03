import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature } from "@/lib/api/config";
import type { PagedResponseDto } from "@/lib/api/types";

import type { ReferralDisplayStatus } from "./types";

/**
 * 의뢰 실제 API (referral-service, Gateway 경유).
 *
 * 백엔드 ReferralController·ReferralSearchCondition·ReferralResponse를 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * 의뢰 목록 조회는 API 연결 함수다 (`referrals` 기능을 API 대상으로 골랐을 때만 호출할 수 있다).
 * 화면(api.ts의 getRecentReferrals)은 아직 이 함수를 쓰지 않는다: 목록 응답에 화면 표가 쓰는
 * 의뢰번호·검사기관·검사 유형명·검사 일시가 없어 기관 API 완성 후 연결한다.
 *
 * 인증: Gateway가 `Authorization: Bearer <JWT>`를 검증하고 X-User-Id·X-Institution-Id·X-Role을 붙인다.
 * 프론트는 이 X- 헤더들을 만들지 않는다 (Gateway가 바깥에서 온 값을 지운다).
 * 토큰 전달은 로그인 연동 후 서버 전용 모듈에서 `headers`로 넘긴다. 그 전에는 호출하면 401이다.
 */

/** 백엔드 ReferralStatus. 표기를 바꾸지 않는다 (CANCELED는 L 하나) */
export type ReferralStatusDto = "PENDING" | "CONFIRMED" | "FAILED" | "CANCELED" | "NEEDS_RESCHEDULE";

/** 백엔드 ReferralResponse (ID는 UUID 문자열) */
export interface ReferralResponseDto {
  id: string;
  referringInstitutionId: string;
  referrerId: string;
  examTypeId: string;
  /** 현재 예약 시도 ID. 예약 전이면 null */
  currentReservationId: string | null;
  referralStatus: ReferralStatusDto;
  patientName: string;
}

/**
 * 의뢰 목록 조회 조건 (백엔드 ReferralSearchCondition).
 * 조회 범위는 서버가 정한다: 관리자가 아니면 요청자 소속 기관(X-Institution-Id)의 의뢰만 온다.
 */
export interface ReferralListParams {
  status?: ReferralStatusDto;
  /** 관리자 전용 필터 */
  referringInstitutionId?: string;
  /** 본인 ID를 넣으면 내가 작성한 의뢰만 */
  referrerId?: string;
  examTypeId?: string;
  /** 부분 일치 */
  patientName?: string;
  /** 0부터. 음수·누락이면 서버가 0으로 본다 */
  page?: number;
  /** 10·30·50만 허용. 그 외 값은 서버가 10으로 바꾼다 */
  size?: 10 | 30 | 50;
  /** 누락·허용 외 값이면 서버 기본값 createdAt,desc */
  sort?: `${"createdAt" | "updatedAt"},${"asc" | "desc"}`;
}

/**
 * 의뢰 목록 조회 `GET /api/v1/referrals`.
 * Gateway 권한(origin/dev 기준): REQUESTER·ADMIN만 허용, 그 외 역할은 403.
 * Mock 구현이 없으므로 referrals가 API 대상이 아니면 설정 오류이고, 호출 실패는 그대로 ApiError로 던진다.
 */
export async function fetchReferralPage(
  params: ReferralListParams = {},
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<PagedResponseDto<ReferralResponseDto>> {
  requireApiFeature("referrals");
  return apiRequestData<PagedResponseDto<ReferralResponseDto>>("/api/v1/referrals", {
    ...options,
    query: { ...params },
  });
}

/**
 * 백엔드 의뢰 상태 → 화면 표시 상태.
 * FAILED(예약 실패)는 화면에 대응하는 상태가 없어 null을 돌려준다 (표시 방식은 화면 기획 확인 후 정한다).
 */
export function toReferralDisplayStatus(status: ReferralStatusDto): ReferralDisplayStatus | null {
  switch (status) {
    case "PENDING":
      return "PROCESSING";
    case "CONFIRMED":
      return "CONFIRMED";
    case "NEEDS_RESCHEDULE":
      return "RESCHEDULE_REQUIRED";
    case "CANCELED":
      return "CANCELLED";
    case "FAILED":
      return null;
  }
}
