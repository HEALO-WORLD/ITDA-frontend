/**
 * 기관 유형(역할).
 * 실제 Spring Security 역할명은 백엔드 계약 확인 후 매핑한다. (screen-spec 9-1)
 */
export type OrganizationRole = "REFERRING" | "EXAMINING";

/** 백엔드 Role (users/me 응답). REQUESTER = 의뢰기관, EXAMINER = 검사기관, ADMIN = 플랫폼 관리자 */
export type UserRoleCode = "REQUESTER" | "EXAMINER" | "ADMIN";

/** 헤더에 표시할 로그인 사용자 정보 */
export interface SessionUser {
  role: OrganizationRole;
  /** 소속 기관명 (예: 서울바른정형외과) */
  organizationName: string;
  /** 담당자 역할 표시명 (예: 의뢰기관 담당자) */
  roleLabel: string;
  /** 읽지 않은 알림 존재 여부. 실제 값은 알림 API 연동 후 결정 */
  hasUnreadNotifications: boolean;
}
