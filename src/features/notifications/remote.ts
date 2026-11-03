import { apiRequestData, type ApiRequestOptions } from "@/lib/api/client";
import { requireApiFeature, type ApiFeature } from "@/lib/api/config";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { PagedResponseDto } from "@/lib/api/types";

/**
 * 알림 실제 API (referral-service, Gateway 경유). 의뢰기관·검사기관이 같은 API를 쓴다.
 *
 * 백엔드 NotificationController·NotificationResponse·NotificationReadResponse·UnreadCountResponse·
 * NotificationPageRequest를 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * - Gateway 권한: REQUESTER·EXAMINER (ADMIN은 403 ACCESS_DENIED)
 * - 백엔드는 Gateway가 만든 X-User-Id로 요청자 본인의 알림만 조회·처리한다. 프론트는 사용자·기관 ID를 보내지 않는다
 * - 인증 헤더는 서버 전용 모듈(server.ts·actions.ts)이 `headers`로 넘긴다
 *
 * Mock 구현으로 대신하지 않는다: 기능이 API 대상이 아니거나 입력이 계약과 다르면 요청 없이 설정 오류,
 * 호출 실패는 ApiError 그대로, 응답 형태가 계약과 다르면 PARSE 오류로 던진다 (화면 문구는 getNotificationErrorMessage).
 * ⚠️ 백엔드에는 아직 알림을 만드는 코드가 없어 실제 목록은 비어 있을 수 있다.
 */

/** 알림 API를 쓰는 기능 (의뢰기관 / 검사기관). 각자의 NEXT_PUBLIC_API_FEATURES 값으로 켠다 */
export type NotificationApiFeature = Extract<ApiFeature, "notifications" | "examining-notifications">;

export const NOTIFICATION_API_FEATURES: readonly NotificationApiFeature[] = ["notifications", "examining-notifications"];

/** 알림 한 건 (백엔드 NotificationResponse, ID는 UUID 문자열) */
export interface NotificationDto {
  notificationId: string;
  /** 관련 의뢰 ID (백엔드에서 필수) */
  referralId: string;
  /** 알림 유형. 백엔드도 값 목록이 확정되지 않아 문자열로 둔다 */
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  /** Java LocalDateTime 직렬화 문자열 (시간대 표기 없음) */
  createdAt: string;
  /** 읽기 전에는 null */
  readAt: string | null;
}

/** 읽지 않은 알림 수 (백엔드 UnreadCountResponse) */
export interface UnreadCountDto {
  unreadCount: number;
}

/** 읽음 처리 결과 (백엔드 NotificationReadResponse). 이미 읽은 알림이면 처음 읽은 시각 그대로 (멱등) */
export interface NotificationReadDto {
  notificationId: string;
  isRead: boolean;
  readAt: string;
}

/** 백엔드가 받는 페이지 크기 (그 밖의 값은 서버가 조용히 10으로 바꾸므로 보내기 전에 막는다) */
export const NOTIFICATION_PAGE_SIZES = [10, 30, 50] as const;
export type NotificationPageSize = (typeof NOTIFICATION_PAGE_SIZES)[number];

/** 알림 목록 조회 조건. 조회 범위(본인 알림)는 서버가 정한다. 정렬은 서버 기본값(createdAt 최신순)을 쓴다 */
export interface NotificationListParams {
  /** 0부터. 기본 0 */
  page?: number;
  /** 기본 10 */
  size?: NotificationPageSize;
  /** 생략하면 전체 */
  isRead?: boolean;
  /** 해당 의뢰의 알림만 */
  referralId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isNotificationId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

type RequestOptions = Pick<ApiRequestOptions, "headers" | "signal">;

/** 알림 목록 `GET /api/v1/notifications?page&size&isRead&referralId` */
export async function fetchNotificationPage(
  feature: NotificationApiFeature,
  { page = 0, size = 10, isRead, referralId }: NotificationListParams = {},
  options: RequestOptions = {},
): Promise<PagedResponseDto<NotificationDto>> {
  requireApiFeature(feature);
  // 서버는 잘못된 page·size를 오류 없이 기본값으로 바꾸므로 보내기 전에 막는다
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new ApiError("CONFIG", `알림 목록 페이지 번호가 올바르지 않습니다: ${page}`);
  }
  if (!NOTIFICATION_PAGE_SIZES.includes(size)) {
    throw new ApiError("CONFIG", `알림 목록 페이지 크기는 ${NOTIFICATION_PAGE_SIZES.join("·")} 중 하나여야 합니다: ${size}`);
  }
  if (referralId !== undefined && !UUID_PATTERN.test(referralId)) {
    throw new ApiError("CONFIG", `의뢰 ID 형식이 올바르지 않습니다: "${referralId}"`);
  }
  const data = await apiRequestData<unknown>("/api/v1/notifications", {
    ...options,
    query: { page, size, isRead, referralId },
  });
  if (!isNotificationPage(data)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

/** 읽지 않은 알림 수 `GET /api/v1/notifications/unread-count` */
export async function fetchUnreadNotificationCount(
  feature: NotificationApiFeature,
  options: RequestOptions = {},
): Promise<number> {
  requireApiFeature(feature);
  const data = await apiRequestData<unknown>("/api/v1/notifications/unread-count", options);
  if (!isUnreadCount(data)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data.unreadCount;
}

/** 알림 읽음 처리 `PATCH /api/v1/notifications/{notificationId}/read` (멱등) */
export async function markNotificationAsRead(
  feature: NotificationApiFeature,
  notificationId: string,
  options: RequestOptions = {},
): Promise<NotificationReadDto> {
  requireApiFeature(feature);
  // Mock 알림 ID(mock-…)나 형식이 다른 값이 서버로 가지 않게 막는다
  if (!isNotificationId(notificationId)) {
    throw new ApiError("CONFIG", `알림 ID 형식이 올바르지 않습니다: "${notificationId}"`);
  }
  const data = await apiRequestData<unknown>(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
    ...options,
    method: "PATCH",
  });
  if (!isNotificationRead(data, notificationId)) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body: data });
  }
  return data;
}

// ── 응답 형식 검증 (모르는 형태를 추측해 바꾸지 않는다) ──

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";

function isNotificationItem(value: unknown): value is NotificationDto {
  if (!isRecord(value)) return false;
  return (
    isNotificationId(value.notificationId) &&
    isNotificationId(value.referralId) &&
    isNonEmptyString(value.type) &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    typeof value.isRead === "boolean" &&
    isNonEmptyString(value.createdAt) &&
    (value.readAt === null || isNonEmptyString(value.readAt))
  );
}

function isNotificationPage(value: unknown): value is PagedResponseDto<NotificationDto> {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.contents) &&
    value.contents.every(isNotificationItem) &&
    [value.totalElements, value.totalPages, value.size, value.number].every(
      (n) => Number.isSafeInteger(n) && (n as number) >= 0,
    )
  );
}

function isUnreadCount(value: unknown): value is UnreadCountDto {
  return isRecord(value) && Number.isSafeInteger(value.unreadCount) && (value.unreadCount as number) >= 0;
}

/** 요청한 알림의 결과이고 읽음 상태여야 한다 */
function isNotificationRead(value: unknown, notificationId: string): value is NotificationReadDto {
  return (
    isRecord(value) &&
    typeof value.notificationId === "string" &&
    value.notificationId.toLowerCase() === notificationId.toLowerCase() &&
    value.isRead === true &&
    isNonEmptyString(value.readAt)
  );
}

// ── 오류 안내 ──

/** 백엔드·Gateway 오류 코드별 안내 (origin/dev 기준) */
const ERROR_MESSAGES: Record<string, string> = {
  MISSING_HEADER: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  INVALID_INPUT: "알림 요청 내용이 올바르지 않습니다.",
  ACCESS_DENIED: "알림은 의뢰기관·검사기관 담당자만 확인할 수 있습니다.",
  NOTIFICATION_ACCESS_DENIED: "본인에게 온 알림만 읽음 처리할 수 있습니다.",
  NOTIFICATION_NOT_FOUND: "알림을 찾을 수 없습니다. 목록을 새로고침해 주세요.",
};

const FALLBACK_MESSAGES = {
  list: "알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  count: "읽지 않은 알림 수를 불러오지 못했습니다.",
  read: "알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/**
 * 알림 API 실패 안내 문구.
 * 401(토큰 없음·만료)은 공통 문구(ApiError.message)를 쓰고, 400·403·404는 오류 코드로 원인을 구분한다.
 * 설정·응답 형식 오류는 내부 내용을 보여 주지 않고 기능별 문구를 쓴다.
 */
export function getNotificationErrorMessage(error: unknown, action: keyof typeof FALLBACK_MESSAGES): string {
  if (!isApiError(error) || error.kind === "CONFIG" || error.kind === "PARSE") return FALLBACK_MESSAGES[action];
  if (error.kind === "HTTP" && error.status !== 401 && error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  return error.message;
}
