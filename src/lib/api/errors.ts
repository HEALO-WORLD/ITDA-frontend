/**
 * API 오류 정규화.
 *
 * HTTP 오류·네트워크 오류·타임아웃·응답 해석 실패·설정 오류를 모두 ApiError 하나로 다룬다.
 * 화면은 `message`(사용자 안내 문구)를 그대로 보여 주고, 분기는 `kind`·`status`로 한다.
 * 서버 오류 응답 본문의 형식은 백엔드 계약이 확정되지 않았으므로 해석하지 않고 `body`에 원본 그대로 둔다.
 */

export type ApiErrorKind =
  /** 서버가 2xx가 아닌 상태 코드로 응답 */
  | "HTTP"
  /** 서버에 연결하지 못함 (DNS·CORS·오프라인 등) */
  | "NETWORK"
  /** 제한 시간 안에 응답이 끝나지 않음 */
  | "TIMEOUT"
  /** 호출한 쪽이 요청을 취소함 (화면 이동 등). 보통 사용자에게 알리지 않는다 */
  | "ABORTED"
  /** 응답이 JSON이 아니거나 해석할 수 없음 */
  | "PARSE"
  /** API 모드·주소 등 환경 설정이 잘못됨, 또는 API 대상이 아닌 기능의 실제 API 호출 */
  | "CONFIG";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP 상태 코드. HTTP 오류가 아니면 null */
  readonly status: number | null;
  /**
   * 서버 오류 코드 (백엔드 ErrorResponse.code, 예: REFERRAL_NOT_FOUND, Gateway의 TOKEN_EXPIRED). 없으면 null.
   * 분기는 status를 우선하고, 같은 status 안에서 원인을 구분할 때만 쓴다.
   */
  readonly code: string | null;
  /** 서버 오류 응답 본문 (JSON이면 해석한 값, 아니면 문자열). 원본 그대로 보관한다 */
  readonly body: unknown;
  /** 원인 오류 (네트워크 오류 등). 디버깅용 */
  readonly cause: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    {
      status = null,
      code = null,
      body = null,
      cause,
    }: { status?: number | null; code?: string | null; body?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.body = body;
    this.cause = cause;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** 인증 실패(토큰 없음·만료·위조). 다시 로그인해야 한다 */
export const isUnauthorizedError = (error: unknown): error is ApiError =>
  isApiError(error) && error.kind === "HTTP" && error.status === 401;

/** 권한 부족(로그인은 됐지만 역할·소속 기관이 맞지 않음). 다시 로그인해도 해결되지 않는다 */
export const isForbiddenError = (error: unknown): error is ApiError =>
  isApiError(error) && error.kind === "HTTP" && error.status === 403;

/**
 * 오류 본문의 code 필드 (백엔드 ErrorResponse `{ code, message }`).
 * Gateway 401 응답도 code는 같은 위치에 있다 (message 키는 공백이 섞여 있어 읽지 않는다).
 */
export function getErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("code" in body)) return null;
  const { code } = body as { code: unknown };
  return typeof code === "string" && code !== "" ? code : null;
}

/** HTTP 상태 코드별 사용자 안내 문구 (서버 메시지 필드는 계약 확정 후 반영한다) */
export function getHttpErrorMessage(status: number): string {
  if (status === 400 || status === 422) return "요청 내용을 확인해 주세요.";
  if (status === 401) return "로그인이 필요합니다. 다시 로그인해 주세요.";
  if (status === 403) return "이 작업을 할 권한이 없습니다.";
  if (status === 404) return "요청한 정보를 찾을 수 없습니다.";
  if (status === 409) return "다른 요청과 충돌했습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.";
  if (status === 429) return "요청이 많아 잠시 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  if (status >= 500) return "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
