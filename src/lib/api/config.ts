import { ApiError } from "./errors";

/**
 * API 설정 (서버·브라우저 공통).
 *
 * ⚠️ 이 파일은 브라우저 번들에도 들어간다. 토큰·테스트 헤더·내부 비밀값을 두지 않는다.
 * 인증 정보 주입이 필요해지면 `import "server-only"`를 건 별도 서버 전용 모듈에서 client.ts의 `headers`로 넘긴다.
 *
 * 환경변수 (NEXT_PUBLIC_* 값은 빌드할 때 번들에 들어가므로 바꾸면 다시 빌드·배포해야 한다)
 * - NEXT_PUBLIC_API_MODE: "mock"(기본) | "api"
 * - NEXT_PUBLIC_API_FEATURES: API 모드에서 실제 API를 쓸 기능 목록 (쉼표 구분, 예: "referrals,notifications").
 *   비어 있으면 모든 기능이 API 대상이다. 목록에 없는 기능은 Mock을 명시적으로 고른 것으로 본다 (API_FEATURES 참고)
 *
 * 함수별 API 연결 여부는 각 데이터 접근 함수가 첫 줄에서 직접 밝힌다.
 * - API 연결: `requireApiFeature("기능")` (API 대상 기능이 아니면 설정 오류). 호출 실패는 Mock으로 대체하지 않는다
 * - API 미연결: `mockOnly("기능.함수")` (기능을 선택했어도 Mock을 쓴다)
 * - NEXT_PUBLIC_API_BASE_URL: 브라우저가 호출할 Gateway 주소 (공개 값. 예: https://gateway.example.com 또는 /api 경유 경로)
 * - API_BASE_URL: 서버에서만 쓰는 Gateway 주소 (선택. 컨테이너 내부 주소 등). 없으면 NEXT_PUBLIC_API_BASE_URL을 쓴다
 */

export type ApiMode = "mock" | "api";

/** 요청 제한 시간 기본값(ms) */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

/**
 * 현재 데이터 모드. 값이 없으면 Mock이고, 알 수 없는 값이면 Mock으로 바꾸지 않고 설정 오류를 낸다
 * (오타로 실제 연동이 꺼진 것을 모르고 지나가지 않도록).
 */
export function getApiMode(): ApiMode {
  // NEXT_PUBLIC_ 값은 이렇게 직접 참조해야 빌드 시 브라우저 번들에 들어간다
  const raw = process.env.NEXT_PUBLIC_API_MODE?.trim();
  if (!raw || raw === "mock") return "mock";
  if (raw === "api") return "api";
  throw new ApiError("CONFIG", `NEXT_PUBLIC_API_MODE 값이 올바르지 않습니다: "${raw}" ("mock" 또는 "api")`);
}

/**
 * 기능 단위 전환 키. 데이터 접근 함수의 기능 이름(`referrals.getRecentReferrals`)에서 `.` 앞부분과 같다.
 * ⚠️ equipment·slots·incidents는 서로의 Mock(장애 → 슬롯 차단 등)을 계산에 쓰므로 함께 전환해야 한다.
 */
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

/**
 * API 모드에서 실제 API를 쓸 기능. null = 전체.
 * 알 수 없는 이름이 있으면 설정 오류를 낸다 (오타로 Mock이 쓰이는 것을 모르고 지나가지 않도록).
 */
function getEnabledApiFeatures(): ReadonlySet<ApiFeature> | null {
  const raw = process.env.NEXT_PUBLIC_API_FEATURES?.trim();
  if (!raw) return null;
  const names = raw.split(",").map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !(API_FEATURES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new ApiError(
      "CONFIG",
      `NEXT_PUBLIC_API_FEATURES에 알 수 없는 기능이 있습니다: ${unknown.join(", ")} (사용 가능: ${API_FEATURES.join(", ")})`,
    );
  }
  return new Set(names as ApiFeature[]);
}

/** 이 기능이 실제 API 대상인지. Mock 모드면 항상 false */
export function isApiFeature(feature: ApiFeature): boolean {
  if (getApiMode() === "mock") return false;
  return getEnabledApiFeatures()?.has(feature) ?? true;
}

/**
 * API 연결 함수용: 이 기능이 API 대상이 아니면 설정 오류를 던진다.
 * Mock 구현이 따로 없는 실제 API 호출 함수가 Mock 모드에서 불리는 것을 막는다.
 */
export function requireApiFeature(feature: ApiFeature): void {
  if (isApiFeature(feature)) return;
  throw new ApiError(
    "CONFIG",
    `${feature} 기능이 실제 API 대상이 아닙니다. (NEXT_PUBLIC_API_MODE=api, NEXT_PUBLIC_API_FEATURES에 ${feature} 포함)`,
  );
}

/** 개발 중 같은 안내를 한 번만 띄우기 위한 기록 */
const warnedMockOnlyNames = new Set<string>();

/**
 * API 미연결 함수용: 이 함수는 Mock을 쓴다고 밝힌다. `name`은 `기능.함수` 형식이다.
 * 기능을 API 대상으로 골랐어도 이 함수는 Mock을 쓴다 (API 호출 실패를 대신하는 것이 아니라 아직 연결하지 않은 함수다).
 * 설정이 잘못됐거나(모드·기능 이름 오타) 기능 이름을 알 수 없으면 설정 오류를 던진다.
 */
export function mockOnly(name: string): void {
  const feature = name.split(".")[0];
  if (!(API_FEATURES as readonly string[]).includes(feature)) {
    throw new ApiError("CONFIG", `알 수 없는 기능 이름입니다: "${name}"`);
  }
  if (getApiMode() === "mock") return;
  // API 모드에서는 화면이 getScreenDataSource로 Mock 경로를 막는다. 그래도 불렸다면 Mock이 새는 경로이므로
  // 함수마다 한 번 오류 로그를 남긴다 (배포 환경 포함). 화면이 깨지지 않도록 예외는 던지지 않는다
  if (!warnedMockOnlyNames.has(name)) {
    warnedMockOnlyNames.add(name);
    console.error(`[API 모드] Mock 함수 호출: ${name} (화면에서 Mock 경로를 막아야 합니다)`);
  }
}

/**
 * 화면 데이터 출처.
 * - mock: Mock 모드 (기존 Mock 데모)
 * - api: API 모드이고 실제 API에 연결된 기능이 켜져 있음
 * - not-ready: API 모드인데 연결된 API가 없거나 기능이 꺼져 있음 → Mock으로 채우지 않고 '준비 중'으로 안내한다
 * @param feature 실제 API에 연결된 화면의 기능 키. 아직 연결된 API가 없는 화면은 null
 */
export type ScreenDataSource = "mock" | "api" | "not-ready";

export function getScreenDataSource(feature: ApiFeature | null): ScreenDataSource {
  if (getApiMode() === "mock") return "mock";
  return feature !== null && isApiFeature(feature) ? "api" : "not-ready";
}

/**
 * 변경 함수용 mockOnly: 설정 오류를 던지지 않고 돌려준다 (Mock으로 처리하면 null).
 * 결과 객체({ ok: false, message })를 돌려주는 함수에서 쓴다.
 */
export function getMockOnlyError(name: string): ApiError | null {
  try {
    mockOnly(name);
    return null;
  } catch (error) {
    return error instanceof ApiError ? error : new ApiError("CONFIG", "API 설정을 확인해 주세요.", { cause: error });
  }
}

/**
 * 요청 기준 주소 (끝의 `/` 제거).
 * 서버: API_BASE_URL → NEXT_PUBLIC_API_BASE_URL 순 (서버 fetch는 절대 주소만 가능)
 * 브라우저: NEXT_PUBLIC_API_BASE_URL (절대 주소 또는 같은 출처 경로 `/...`)
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
