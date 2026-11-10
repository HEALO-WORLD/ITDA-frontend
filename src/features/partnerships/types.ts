/**
 * 기관 협약 (institution-service Partnership) 화면 공통 타입·문구.
 * ACTIVE 협약만 실제 검사 의뢰의 협력 기관이 된다. PENDING(승인 대기)은 아직 의뢰할 수 없다.
 */

export const PARTNERSHIP_STATUSES = ["PENDING", "ACTIVE", "REJECTED", "TERMINATED"] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];

export const isPartnershipStatus = (value: unknown): value is PartnershipStatus =>
  PARTNERSHIP_STATUSES.includes(value as PartnershipStatus);

export const PARTNERSHIP_STATUS_LABELS: Record<PartnershipStatus, string> = {
  PENDING: "승인 대기",
  ACTIVE: "협약 중",
  REJECTED: "거절",
  TERMINATED: "종료",
};

/** 같은 상대와 다시 요청할 수 없는 상태 (진행 중). REJECTED·TERMINATED는 재요청하면 같은 협약이 PENDING으로 바뀐다 */
export const IN_PROGRESS_STATUSES: readonly PartnershipStatus[] = ["PENDING", "ACTIVE"];

/** 목록 필터 (`?status=`). all은 조건 없음 */
export const PARTNERSHIP_FILTERS = ["all", ...PARTNERSHIP_STATUSES] as const;
export type PartnershipFilter = (typeof PARTNERSHIP_FILTERS)[number];

/** 협약 화면 역할 (페이지·Server Function이 정한다. 브라우저가 보낸 역할은 쓰지 않는다) */
export type PartnershipScreenRole = "REFERRING" | "EXAMINING";

export type PartnershipLoadFailure = {
  ok: false;
  reason: "SIGNED_OUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NETWORK" | "ERROR";
  message: string;
};

export type PartnershipActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      /** SESSION_CHANGED: 다른 탭에서 로그인 계정이 바뀌어 요청하지 않음 (FORBIDDEN과 구분) */
      reason: "INVALID" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "SIGNED_OUT" | "SESSION_CHANGED" | "NETWORK" | "ERROR";
      message: string;
    };
