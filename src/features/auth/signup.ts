import "server-only";

import { apiRequestData } from "@/lib/api/client";
import { ApiError, isApiError } from "@/lib/api/errors";

import { isInstitutionId } from "./signupRules";
import type { PublicInstitution, SignupFailureReason, SignupInstitutionType } from "./types";

/**
 * 회원가입 실제 API (institution-service, Gateway 경유. 둘 다 Gateway 공개 규칙이라 토큰 없이 호출한다).
 *
 * 백엔드 InstitutionController·AuthController·SignupRequest/Response·PublicInstitutionResponse·ErrorCode를 기준으로 옮겼다
 * (ITDA 저장소 origin/dev b315532 기준 확인).
 * 서버 전용: 회원가입 화면(서버 컴포넌트)과 회원가입 Route Handler(`app/auth/signup/route.ts`)에서만 부른다.
 * Mock 모드에서는 공통 API Client가 요청을 보내지 않고 설정 오류를 낸다 (Mock 기관 목록·Mock 가입을 만들지 않는다).
 * 가입 성공 시 계정은 승인 대기(active=false)이고 토큰을 발급하지 않는다 (자동 로그인 없음).
 */

const SIGNUP_INSTITUTION_TYPES: readonly SignupInstitutionType[] = ["REQUESTER", "EXAM"];

export type PublicInstitutionLoadResult =
  | { ok: true; institutions: PublicInstitution[] }
  | { ok: false; reason: "NETWORK" | "SERVER_ERROR" | "CONFIG"; message: string };

/**
 * 가입 가능 기관 조회 `GET /api/v1/institutions/public` (활성·미삭제·운영사 제외, 페이지 없음).
 * 실패해도 Mock 목록으로 대체하지 않고 실패 결과를 돌려준다.
 * 가입 목록에 나오지 않아야 할 유형(PLATFORM 등 알 수 없는 값)은 표시하지 않는다 (가입하면 400이라 고를 수 없게 한다).
 */
export async function loadPublicInstitutions(): Promise<PublicInstitutionLoadResult> {
  try {
    const data = await apiRequestData<unknown>("/api/v1/institutions/public");
    if (!Array.isArray(data) || !data.every(isPublicInstitutionShape)) {
      throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.");
    }
    const institutions = data.filter((item): item is PublicInstitution =>
      SIGNUP_INSTITUTION_TYPES.includes(item.type as SignupInstitutionType),
    );
    if (institutions.length !== data.length) {
      console.warn(`[auth] 가입 목록에 알 수 없는 기관 유형 ${data.length - institutions.length}건을 표시하지 않았습니다.`);
    }
    return { ok: true, institutions: institutions.map(({ id, name, type }) => ({ id, name, type })) };
  } catch (error) {
    const reason = toFailureReason(error);
    console.error("[auth] 가입 가능 기관 조회 실패:", describeError(error));
    return {
      ok: false,
      reason: reason === "NETWORK" || reason === "CONFIG" ? reason : "SERVER_ERROR",
      message:
        reason === "NETWORK"
          ? "기관 목록 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
          : reason === "CONFIG"
            ? "기관 목록을 불러올 수 없는 환경입니다. (API 모드·주소 설정 확인)"
            : "기관 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

function isPublicInstitutionShape(value: unknown): value is { id: string; name: string; type: string } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return isInstitutionId(item.id) && typeof item.name === "string" && item.name.trim() !== "" && typeof item.type === "string";
}

/** 회원가입 요청 본문 (백엔드 SignupRequest) */
export interface SignupRequestDto {
  loginId: string;
  password: string;
  institutionId: string;
}

/** 회원가입 응답 (백엔드 SignupResponse). role은 기관 유형으로 서버가 정하고, active는 승인 전이라 false */
export interface SignupResponseDto {
  userId: string;
  loginId: string;
  role: string;
  active: boolean;
}

/**
 * 회원가입 `POST /api/v1/auth/signup` (201). 인증 헤더를 붙이지 않는다.
 * 응답이 계약과 다르면 PARSE 오류로 본다. 요청 본문(비밀번호)은 오류에 담지 않는다.
 */
export async function requestSignup(body: SignupRequestDto): Promise<SignupResponseDto> {
  const data = await apiRequestData<unknown>("/api/v1/auth/signup", { method: "POST", body });
  if (!isSignupResponse(data)) throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.");
  return data;
}

function isSignupResponse(value: unknown): value is SignupResponseDto {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    isInstitutionId(data.userId) &&
    typeof data.loginId === "string" &&
    data.loginId !== "" &&
    typeof data.role === "string" &&
    typeof data.active === "boolean"
  );
}

type RemoteSignupFailureReason = Exclude<SignupFailureReason, "MOCK_MODE" | "FORBIDDEN_ORIGIN">;

/** 회원가입 실패 원인. 상태 코드를 우선하고, 같은 상태 코드 안에서는 백엔드 오류 코드로 확인한다 */
export function getSignupFailureReason(error: unknown): RemoteSignupFailureReason {
  return toFailureReason(error);
}

function toFailureReason(error: unknown): RemoteSignupFailureReason {
  if (!isApiError(error)) return "SERVER_ERROR";
  if (error.kind === "CONFIG") return "CONFIG";
  if (error.kind === "NETWORK" || error.kind === "TIMEOUT") return "NETWORK";
  if (error.kind !== "HTTP") return "SERVER_ERROR";
  if (error.status === 400) return error.code === "SIGNUP_NOT_ALLOWED_INSTITUTION" ? "INSTITUTION_NOT_ALLOWED" : "INVALID_INPUT";
  // 404·409는 백엔드 오류 코드까지 맞을 때만 구분한다 (Gateway 경로 없음 등 다른 404는 서버 오류)
  if (error.status === 404 && error.code === "INSTITUTION_NOT_FOUND") return "INSTITUTION_NOT_FOUND";
  if (error.status === 409 && error.code === "DUPLICATE_LOGIN_ID") return "DUPLICATE_LOGIN_ID";
  return "SERVER_ERROR";
}

/** 로그용 오류 요약 (종류·상태·코드만. 요청 본문·응답 본문은 남기지 않는다) */
export function describeError(error: unknown): string {
  if (!isApiError(error)) return error instanceof Error ? error.name : "unknown";
  return `${error.kind} ${error.status ?? ""} ${error.code ?? ""}`.trim();
}

export const SIGNUP_FAILURE_MESSAGES: Record<SignupFailureReason, string> = {
  INVALID_INPUT: "입력값을 확인해 주세요.",
  INSTITUTION_NOT_ALLOWED: "선택한 기관으로는 가입할 수 없습니다. 다른 기관을 선택해 주세요.",
  INSTITUTION_NOT_FOUND: "선택한 기관을 찾을 수 없습니다. 페이지를 새로고침해 기관 목록을 다시 불러와 주세요.",
  DUPLICATE_LOGIN_ID: "이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.",
  NETWORK: "회원가입 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  SERVER_ERROR: "회원가입 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
  CONFIG: "회원가입 기능을 사용할 수 없는 환경입니다. (API 모드·주소 설정 확인)",
  MOCK_MODE: "회원가입은 실제 서버 연동(API 모드)에서만 이용할 수 있습니다.",
  FORBIDDEN_ORIGIN: "허용되지 않은 요청입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
};
