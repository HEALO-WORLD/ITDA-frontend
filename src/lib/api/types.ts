/**
 * 백엔드 공통 응답 형식 (referral·institution·slot 서비스 공통).
 *
 * 백엔드 `global/dto`의 ApiResponse·PagedResponse·ErrorResponse를 그대로 옮긴 타입이다 (ITDA 저장소 origin/dev 기준 확인).
 * 화면 타입이 아니므로 컴포넌트에서 직접 쓰지 않고, 기능별 매핑에서 화면 타입으로 바꾼다.
 */

/** 성공 응답. 데이터는 `data`에 감싸져 온다 */
export interface ApiResponseDto<T> {
  success: boolean;
  message: string;
  data: T;
  /** 응답 시각 (Java LocalDateTime 직렬화 문자열. 시간대 표기 없음) */
  timestamp: string;
}

/** 페이지 응답 (Spring Page를 옮긴 형태) */
export interface PagedResponseDto<T> {
  /** 현재 페이지 항목. Spring 기본 `content`가 아니라 `contents`다 */
  contents: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  /** 현재 페이지 번호 (0부터) */
  number: number;
}

/** 오류 응답 본문 (`code`는 백엔드 ErrorCode 이름) */
export interface ErrorResponseDto {
  code: string;
  message: string;
}
