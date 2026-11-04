import "server-only";

import { apiRequestData } from "@/lib/api/client";
import { ApiError, isApiError } from "@/lib/api/errors";

import type { LoginFailureReason } from "./types";

/**
 * 인증 실제 API (institution-service, Gateway 경유. 공개 API라 토큰 없이 호출한다).
 *
 * 백엔드 AuthController·LoginRequest·TokenResponse·ErrorCode를 기준으로 옮겼다 (ITDA 저장소 origin/dev 기준 확인).
 * 내 정보 조회(fetchMyInfo)는 토큰이 필요하다 (lib/auth/session.ts의 getAuthState·로그인 Route Handler에서만 부른다).
 * 서버 전용: 로그인 Route Handler(`app/auth/login/route.ts`)에서만 부른다. 발급받은 토큰은 브라우저로 돌려주지 않고
 * HttpOnly 쿠키(lib/auth/session.ts)에만 저장한다.
 * Mock 모드에서는 공통 API Client가 요청을 보내지 않고 설정 오류를 낸다 (Mock 로그인을 만들지 않는다).
 */

/** 로그인 요청 본문 (백엔드 LoginRequest: 둘 다 @NotBlank) */
export interface LoginRequestDto {
  loginId: string;
  password: string;
}

/** 로그인 응답 (백엔드 TokenResponse). 역할·기관 정보는 들어 있지 않다 */
export interface TokenResponseDto {
  accessToken: string;
  /** 항상 "Bearer" */
  tokenType: string;
  /** 토큰 유효 시간(초). 백엔드 jwt.access-token-expiration (현재 1h) */
  expiresIn: number;
}

/** 백엔드 호출 실패에서 나올 수 있는 구분 (MOCK_MODE·FORBIDDEN_ORIGIN은 Route Handler가 직접 정한다) */
type RemoteLoginFailureReason = Exclude<LoginFailureReason, "MOCK_MODE" | "FORBIDDEN_ORIGIN" | "USER_INFO_FAILED">;

/**
 * 로그인 `POST /api/v1/auth/login`.
 * 응답이 계약과 다르면(토큰 없음, Bearer가 아님, 만료 시간이 양의 정수가 아님) PARSE 오류로 본다.
 */
export async function requestLogin(body: LoginRequestDto): Promise<TokenResponseDto> {
  const data = await apiRequestData<unknown>("/api/v1/auth/login", { method: "POST", body });
  if (!isTokenResponse(data)) {
    // 응답 본문에 토큰이 있을 수 있으므로 오류에 원본을 담지 않는다
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.");
  }
  return data;
}

function isTokenResponse(value: unknown): value is TokenResponseDto {
  if (typeof value !== "object" || value === null) return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.accessToken === "string" &&
    token.accessToken.trim() !== "" &&
    token.tokenType === "Bearer" &&
    typeof token.expiresIn === "number" &&
    Number.isInteger(token.expiresIn) &&
    token.expiresIn > 0
  );
}

/** 백엔드 Role */
export type UserRoleDto = "REQUESTER" | "EXAMINER" | "ADMIN";
/** 백엔드 InstitutionType (EXAM = 검사기관, PLATFORM = 운영사) */
export type InstitutionTypeDto = "REQUESTER" | "EXAM" | "PLATFORM";

/** 내 정보 (백엔드 MyInfoResponse) */
export interface MyInfoDto {
  userId: string;
  loginId: string;
  role: UserRoleDto;
  institutionId: string;
  institutionName: string;
  institutionType: InstitutionTypeDto;
}

const USER_ROLES: readonly UserRoleDto[] = ["REQUESTER", "EXAMINER", "ADMIN"];
const INSTITUTION_TYPES: readonly InstitutionTypeDto[] = ["REQUESTER", "EXAM", "PLATFORM"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 내 정보 조회 `GET /api/v1/users/me` (Gateway: 로그인 사용자 전체, 백엔드가 Gateway의 X-User-Id로 본인을 찾는다).
 * 토큰은 호출하는 쪽이 `Authorization: Bearer`로 넘긴다. 없는 사용자는 404 USER_NOT_FOUND.
 * 응답이 계약과 다르면(모르는 역할·기관 유형, UUID가 아닌 ID, 빈 이름) PARSE 오류로 던진다. 토큰 내용은 해석하지 않는다.
 */
export async function fetchMyInfo(headers: HeadersInit): Promise<MyInfoDto> {
  const data = await apiRequestData<unknown>("/api/v1/users/me", { headers });
  if (!isMyInfo(data)) throw new ApiError("PARSE", "사용자 정보 응답 형식을 확인할 수 없습니다.");
  return data;
}

function isMyInfo(value: unknown): value is MyInfoDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.userId === "string" &&
    UUID_PATTERN.test(data.userId) &&
    typeof data.loginId === "string" &&
    data.loginId.trim() !== "" &&
    USER_ROLES.includes(data.role as UserRoleDto) &&
    typeof data.institutionId === "string" &&
    UUID_PATTERN.test(data.institutionId) &&
    typeof data.institutionName === "string" &&
    data.institutionName.trim() !== "" &&
    INSTITUTION_TYPES.includes(data.institutionType as InstitutionTypeDto)
  );
}

/** 로그인 실패 원인 분류. 상태 코드를 우선하고, 같은 상태 코드 안에서는 백엔드 오류 코드로 확인한다 */
export function getLoginFailureReason(error: unknown): RemoteLoginFailureReason {
  if (!isApiError(error)) return "SERVER_ERROR";
  if (error.kind === "CONFIG") return "CONFIG";
  if (error.kind !== "HTTP") return "SERVER_ERROR";
  if (error.status === 400) return "INVALID_INPUT";
  if (error.status === 401) return "INVALID_CREDENTIALS";
  if (error.status === 403 && error.code === "USER_NOT_APPROVED") return "NOT_APPROVED";
  return "SERVER_ERROR";
}

export const LOGIN_FAILURE_MESSAGES: Record<LoginFailureReason, string> = {
  INVALID_INPUT: "로그인 ID와 비밀번호를 확인해 주세요.",
  INVALID_CREDENTIALS: "로그인 ID 또는 비밀번호가 올바르지 않습니다.",
  NOT_APPROVED: "관리자 승인 전인 계정입니다. 승인 후 다시 로그인해 주세요.",
  SERVER_ERROR: "로그인 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
  CONFIG: "로그인 기능을 사용할 수 없는 환경입니다. (API 모드·주소 설정 확인)",
  MOCK_MODE: "Mock 모드에서는 실제 로그인을 하지 않습니다. 데모 체험 바로가기를 이용해 주세요.",
  FORBIDDEN_ORIGIN: "허용되지 않은 요청입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  USER_INFO_FAILED: "사용자 정보를 확인하지 못해 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
