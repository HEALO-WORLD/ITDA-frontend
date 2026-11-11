import { ApiError } from "./errors";

/** 클라이언트와 서버 모두 실제 Gateway API를 사용한다. */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

/** 기존 서비스별 API 호출자의 타입을 유지하기 위한 기능 식별자. */
export const API_FEATURES = [
  "referrals",
  "reservations",
  "slots",
  "equipment",
  "incidents",
  "examinations",
  "notifications",
  "examining-notifications",
  "partnerships",
] as const;
export type ApiFeature = (typeof API_FEATURES)[number];

/** 모든 기능은 API 연결을 전제로 실행한다. */
export function isApiFeature(_feature: ApiFeature): boolean {
  void _feature;
  return true;
}

/** 기존 API 호출 함수와의 호환을 유지한다. */
export function requireApiFeature(_feature: ApiFeature): void {
  void _feature;
}

/**
 * Gateway 주소. 서버는 내부 API_BASE_URL을 우선하고 브라우저는 공개 주소를 사용한다.
 * NEXT_PUBLIC_ 환경변수는 빌드 시 번들에 고정되므로 배포할 때 다시 빌드해야 한다.
 */
export function getApiBaseUrl(): string {
  const isServer = typeof window === "undefined";
  const raw = (isServer ? process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL : process.env.NEXT_PUBLIC_API_BASE_URL)?.trim();
  if (!raw) {
    throw new ApiError(
      "CONFIG",
      isServer ? "API 주소가 설정되지 않았습니다. (API_BASE_URL 또는 NEXT_PUBLIC_API_BASE_URL)" : "API 주소가 설정되지 않았습니다. (NEXT_PUBLIC_API_BASE_URL)",
    );
  }
  const isAbsolute = /^https?:\/\//i.test(raw);
  if (!isAbsolute && !(raw.startsWith("/") && !isServer)) {
    throw new ApiError(
      "CONFIG",
      isServer
        ? `서버 API 주소는 http(s)로 시작하는 절대 주소여야 합니다: "${raw}"`
        : `API 주소는 http(s) 절대 주소 또는 /로 시작하는 경로여야 합니다: "${raw}"`,
    );
  }
  return raw.replace(/\/+$/, "");
}
