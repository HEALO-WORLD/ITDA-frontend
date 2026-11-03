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
  | "FORBIDDEN_ORIGIN";

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailureReason; message: string };
