/**
 * 로그인 화면 ↔ 로그인 Route Handler(`POST /auth/login`) 사이의 응답 형식.
 * 토큰은 이 응답에 담지 않는다 (서버가 HttpOnly 쿠키로만 저장한다).
 */

/** 로그인 실패 구분 */
export type LoginFailureReason =
  /** 400: 입력값 누락·형식 오류 */
  | "INVALID_INPUT"
  /** 401 INVALID_CREDENTIALS: 아이디 없음·비밀번호 불일치 (어느 쪽인지 알리지 않는다) */
  | "INVALID_CREDENTIALS"
  /** 403 USER_NOT_APPROVED: 가입했지만 관리자 승인 전 */
  | "NOT_APPROVED"
  /** 5xx·연결 실패·제한 시간 초과·응답 형식 오류 */
  | "SERVER_ERROR"
  /** API 주소 미설정 등 서버 설정 오류 */
  | "CONFIG"
  /** Mock 모드라 실제 로그인을 하지 않음 */
  | "MOCK_MODE"
  /** 다른 출처에서 온 요청 (CSRF 방어) */
  | "FORBIDDEN_ORIGIN"
  /** 로그인은 됐지만 사용자 정보(users/me) 확인 실패 → 쿠키를 저장하지 않는다 */
  | "USER_INFO_FAILED";

/**
 * 로그인 결과. 성공은 사용자 정보(users/me)까지 확인된 경우뿐이다.
 * - redirectTo: 역할별 첫 화면. 화면이 없는 역할(ADMIN)은 null이고 message로 안내한다
 */
export type LoginResult =
  | { ok: true; redirectTo: string | null; message: string | null }
  | { ok: false; reason: LoginFailureReason; message: string };

/** 가입 가능 기관 유형 (백엔드 InstitutionType 중 가입 목록에 나오는 값. 운영사 PLATFORM은 목록에서 빠진다) */
export type SignupInstitutionType = "REQUESTER" | "EXAM";

/** 가입 가능 기관 (백엔드 PublicInstitutionResponse) */
export interface PublicInstitution {
  id: string;
  name: string;
  type: SignupInstitutionType;
}

/** 회원가입 실패 구분 (회원가입 화면 ↔ `POST /auth/signup`) */
export type SignupFailureReason =
  /** 400 VALIDATION_FAILED·INVALID_INPUT: 입력값 누락·형식 오류 */
  | "INVALID_INPUT"
  /** 400 SIGNUP_NOT_ALLOWED_INSTITUTION: 가입할 수 없는 기관 */
  | "INSTITUTION_NOT_ALLOWED"
  /** 404 INSTITUTION_NOT_FOUND: 없거나 삭제된 기관 */
  | "INSTITUTION_NOT_FOUND"
  /** 409 DUPLICATE_LOGIN_ID */
  | "DUPLICATE_LOGIN_ID"
  /** 서버에서 백엔드에 연결하지 못함·제한 시간 초과 */
  | "NETWORK"
  /** 5xx·응답 형식 오류·그 밖의 실패 */
  | "SERVER_ERROR"
  /** API 주소 미설정 등 서버 설정 오류 */
  | "CONFIG"
  /** Mock 모드라 회원가입을 하지 않음 */
  | "MOCK_MODE"
  /** 다른 출처에서 온 요청 (CSRF 방어) */
  | "FORBIDDEN_ORIGIN";

/** 회원가입 결과. 성공하면 서버가 등록한 아이디만 돌려준다 (비밀번호·사용자 ID는 담지 않는다) */
export type SignupResult = { ok: true; loginId: string } | { ok: false; reason: SignupFailureReason; message: string };
